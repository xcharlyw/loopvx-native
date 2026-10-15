import { engine } from '../audio/engine';
import { presetById, applyPreset } from '../audio/presets';
import { encodeWav } from '../audio/wav';
import { DRUM_PARTS, DRUM_PART_LABEL, makeDrumSplitter, monoForAnalysis, transcribeDrums } from './drumSplit';
import { createMidiClip, createTrack, uid } from './project';
import { storeSampleAudio } from './samples';
import type { Sample } from '../types';
import { arrange, type ArrangeResult, type Role } from './arranger';
import { planSections, type PlanSection } from './arrangePlan';
import { barLevels, drumPartLabel, stemClipRanges, stemKindOf, structureFromStems, type StemKind } from './referenceArrange';
import { withMarkers } from './markers';
import { CATEGORY_COLORS } from './project';
import { STEMS_ROOT } from './stemNames';
import { getState, removeSamples, setSamples, updateProject, upsertSamples } from './store';
import { deleteSample } from './samples';

/**
 * Tempo and bar 1 of a tune, measured on its drums stem (the kicks): the grid's exact tempo and where the first bar starts, so a
 * pickup or silence at the start does not shift the bars. Without a drums stem: the given tempo from the start of the file.
 */
async function tuneGrid(folder: string, bpm: number): Promise<{ bpm: number; offsetSec: number }> {
  const drums = getState().samples.find((s) => s.folder === folder && stemKindOf(s.name) === 'drums' && /- Drums\./.test(s.name));
  if (!drums) return { bpm, offsetSec: 0 };
  const buffer = await engine.loadBuffer(drums.id);
  const mono = monoForAnalysis(channelsOf(buffer), buffer.sampleRate);
  const t = transcribeDrums(mono.data, mono.sampleRate, bpm);
  if (!t.notes.length) return { bpm, offsetSec: 0 };
  // Keep the named tempo when the measurement only differs in the last digit.
  return { bpm: Math.abs(t.bpm - bpm) < 0.015 ? bpm : t.bpm, offsetSec: t.downbeatMs / 1000 };
}

/** Tunes whose stems are in the library ("Stems Export/<tune>"), with their stem samples. */
export function stemTunes(samples = getState().samples): { tune: string; folder: string; count: number }[] {
  const by = new Map<string, number>();
  for (const s of samples) {
    if (!s.folder?.startsWith(`${STEMS_ROOT}/`) || !stemKindOf(s.name)) continue;
    by.set(s.folder, (by.get(s.folder) ?? 0) + 1);
  }
  return [...by].map(([folder, count]) => ({ folder, count, tune: folder.slice(STEMS_ROOT.length + 1) })).sort((a, b) => a.tune.localeCompare(b.tune));
}

/**
 * Measures the stems of one tune, turns them into its structure and lays the project out on it (the project's own tracks and
 * library, never the tune's stems; one undo step). Returns the structure and the arranger's result.
 */
export async function rebuildFromStems(folder: string, seed = Math.floor(Math.random() * 2 ** 31)): Promise<{ sections: PlanSection[]; result: ArrangeResult; bpm: number }> {
  const stems = getState().samples.filter((s) => s.folder === folder && stemKindOf(s.name));
  if (!stems.length) throw new Error('Keine Stems in diesem Ordner gefunden.');
  const bpm = stems.find((s) => s.bpm)?.bpm;
  if (!bpm) throw new Error('Das Tempo des Tunes ist unbekannt: trag bei einem Stem in der Library das BPM ein und versuch es nochmal.');
  const grid = await tuneGrid(folder, bpm);
  const levels: Partial<Record<StemKind, number[]>> = {};
  for (const s of stems) {
    const kind = stemKindOf(s.name)!;
    const buffer = await engine.loadBuffer(s.id);
    const lv = barLevels(buffer.getChannelData(0), buffer.sampleRate, grid.bpm, grid.offsetSec);
    // Keys and guitar add to the synth stem.
    levels[kind] = levels[kind] ? levels[kind]!.map((v, i) => Math.max(v, lv[i] ?? 0)) : lv;
  }
  const sections = structureFromStems(levels);
  if (!sections.some((s) => s.type === 'drop')) throw new Error('In diesem Tune wurde kein Drop gefunden (Drums und Bass zusammen).');
  // New tracks only for what the tune really has.
  const plays = (roles: Role[]) => sections.some((s) => !roles.some((r) => s.mute?.includes(r)));
  const addRoles: Role[] = [...(plays(['drums']) ? (['drums'] as Role[]) : []), ...(plays(['bass']) ? (['bass'] as Role[]) : []), ...(plays(['lead']) ? (['lead'] as Role[]) : [])];
  const own = getState().samples.filter((s) => !s.folder?.startsWith(`${STEMS_ROOT}/`));
  const result = arrange(getState().project, own, { seed, addMissingTracks: true, automation: true, sections: planSections({ sections }), addRoles });
  updateProject(() => result.project);
  return { sections, result, bpm };
}

function drumsStem(folder: string): Sample {
  const drums = getState().samples.find((s) => s.folder === folder && stemKindOf(s.name) === 'drums' && /- Drums\./.test(s.name));
  if (!drums) throw new Error('In diesem Ordner gibt es keinen Drums-Stem.');
  return drums;
}

const channelsOf = (buffer: { numberOfChannels: number; getChannelData: (i: number) => Float32Array }) => Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));

/**
 * The drums stem as a MIDI groove on a new 909 track ("<tune> Drums"), one clip over the whole tune from bar 1 (one undo step).
 * Kick, clap and closed hat are found per 16th step; the grid follows the tune's kicks.
 */
export async function drumsToMidi(folder: string): Promise<{ track: string; notes: number; bars: number; bpm: number }> {
  const drums = drumsStem(folder);
  const tempo = drums.bpm ?? getState().samples.find((s) => s.folder === folder && s.bpm)?.bpm;
  if (!tempo) throw new Error('Das Tempo des Tunes ist unbekannt: trag beim Drums-Stem das BPM ein.');
  const buffer = await engine.loadBuffer(drums.id);
  const mono = monoForAnalysis(channelsOf(buffer), buffer.sampleRate);
  const t = transcribeDrums(mono.data, mono.sampleRate, tempo);
  if (!t.notes.length) throw new Error('Im Drums-Stem wurden keine Schläge gefunden.');
  const preset = presetById('kit-909')!;
  const name = `${folder.split('/').pop()} Drums`.slice(0, 40);
  updateProject((p) => {
    const track = { ...applyPreset(createTrack('kick', p.sceneCount, name, 'midi'), preset), volume: 0.9, clips: [{ ...createMidiClip(0, t.bars), notes: t.notes }] };
    return { ...p, tracks: [...p.tracks, track] };
  });
  return { track: name, notes: t.notes.length, bars: t.bars, bpm: t.bpm };
}

/** The drums stem split into Kick, Clap + Snare and HiHats as WAV samples in the same library folder (band filters, not AI). */
export async function splitDrumsAudio(folder: string): Promise<Sample[]> {
  const drums = drumsStem(folder);
  const buffer = await engine.loadBuffer(drums.id);
  const channels = channelsOf(buffer);
  const base = drums.name.replace(/ - Drums\.[a-z0-9]+$/i, '');
  // An earlier split of this tune (also one made before the kick click was kept with the kick) is replaced, not doubled.
  const old = getState().samples.filter((x) => x.folder === folder && x.id.startsWith('split'));
  if (old.length) await removeSamples(old, deleteSample);
  // The click belongs only to kicks on the beat: the detected onsets are held to the tune's beat grid.
  const tempo = drums.bpm ?? getState().samples.find((x) => x.folder === folder && x.bpm)?.bpm;
  let grid: { bpm: number; downbeatMs: number } | undefined;
  if (tempo) {
    const mono = monoForAnalysis(channels, buffer.sampleRate);
    const t = transcribeDrums(mono.data, mono.sampleRate, tempo);
    if (t.notes.length) grid = { bpm: t.bpm, downbeatMs: t.downbeatMs };
  }
  const splitter = makeDrumSplitter(channels, buffer.sampleRate, grid);
  const out: Sample[] = [];
  for (const part of DRUM_PARTS) {
    const wav = encodeWav({ sampleRate: buffer.sampleRate, channels: splitter.part(part) });
    const id = `${SPLIT_PREFIX}${uid()}`;
    const sample = await storeSampleAudio(
      { id, name: `${base} - ${DRUM_PART_LABEL[part]}.wav`, folder, category: part === 'kick' ? 'kick' : 'top', ...(drums.bpm ? { bpm: drums.bpm } : {}), ...(drums.key ? { key: drums.key } : {}), size: wav.byteLength, addedAt: Date.now() },
      wav,
      'wav',
    );
    setSamples([...getState().samples.filter((x) => x.id !== id), sample]);
    out.push(sample);
  }
  return out;
}

/** Id prefix of the app's own drum split; `split:` (without 2) was the first version without the kick's click. */
const SPLIT_PREFIX = 'split2:';

/**
 * The simple rebuild: the tune's own stems on one audio track each ("Stem Drums", "Stem Bass" …), every stem only in the sections
 * where it plays (clip offset = position, so it is exactly that part of the original), the sections as markers and the project at
 * the tune's tempo. Tracks of an earlier rebuild (same names) get their clips replaced; other tracks stay as they are. One undo step.
 */
export async function rebuildWithOriginalStems(folder: string): Promise<{ sections: PlanSection[]; tracks: string[]; bpm: number; offsetSec: number; split: boolean }> {
  const stems = getState().samples.filter((s) => s.folder === folder && stemKindOf(s.name));
  if (!stems.length) throw new Error('Keine Stems in diesem Ordner gefunden.');
  const bpm = stems.find((s) => s.bpm)?.bpm;
  if (!bpm) throw new Error('Das Tempo des Tunes ist unbekannt: trag bei einem Stem in der Library das BPM ein und versuch es nochmal.');
  const grid = await tuneGrid(folder, bpm);
  // The drums come as separate parts (kick, clap, hats ...) when the library has them in the tune's folder (own split or files from
  // another tool); without parts the drums stem is split first, so the rebuild always has them apart.
  // Parts of the first split version (`split:`, no kick click) count as missing: they are replaced by a new split.
  const partsOf = () => getState().samples.filter((s) => s.folder === folder && drumPartLabel(s.name) && !s.id.startsWith('split:'));
  let parts = partsOf();
  let split = false;
  if (!parts.length && stems.some((s) => stemKindOf(s.name) === 'drums')) {
    await splitDrumsAudio(folder);
    parts = partsOf();
    split = true;
  }
  const perStem: { sample: Sample; kind: StemKind | 'part'; label: string; levels: number[] }[] = [];
  const merged: Partial<Record<StemKind, number[]>> = {};
  const levelsOf = async (s: Sample) => {
    const buffer = await engine.loadBuffer(s.id);
    return barLevels(buffer.getChannelData(0), buffer.sampleRate, grid.bpm, grid.offsetSec);
  };
  const labelOf = (name: string) => / - ([^-]+)\.[a-z0-9]+$/i.exec(name)?.[1] ?? 'Stem';
  for (const s of stems) {
    const kind = stemKindOf(s.name)!;
    const lv = await levelsOf(s);
    // The full drums stem still tells where the drums play (structure), but its own track is left out when the parts are there.
    if (!(kind === 'drums' && parts.length)) perStem.push({ sample: s, kind, label: labelOf(s.name), levels: lv });
    merged[kind] = merged[kind] ? merged[kind]!.map((v, i) => Math.max(v, lv[i] ?? 0)) : lv;
  }
  for (const s of parts) perStem.push({ sample: s, kind: 'part', label: drumPartLabel(s.name)!, levels: await levelsOf(s) });
  const sections = structureFromStems(merged);
  if (!sections.length) throw new Error('Der Tune ist zu kurz für einen Aufbau.');
  const ORDER = ['Drums', 'Kick', 'Clap + Snare', 'Snare', 'Clap', 'HiHats', 'Toms', 'Becken', 'Bass', 'Synth + FX', 'Keys', 'Gitarre', 'Vocal'];
  const rank = (l: string) => (ORDER.indexOf(l) < 0 ? ORDER.length : ORDER.indexOf(l));
  perStem.sort((a, b) => rank(a.label) - rank(b.label));
  const names: string[] = [];
  const marks = planSections({ sections }).map((s) => ({ bar: s.start, name: s.label }));
  const end = sections.reduce((n, s) => n + s.bars, 0);
  const offsetBars = (grid.offsetSec * grid.bpm) / 240;
  // The stems play at their own speed when their tempo and the project's are the measured one.
  if (grid.bpm !== bpm) await upsertSamples([...stems, ...parts].map((x) => ({ ...x, bpm: grid.bpm })));
  updateProject((p) => {
    let tracks = [...p.tracks];
    for (const { sample, levels, label } of perStem) {
      const ranges = stemClipRanges(levels, sections);
      if (!ranges.length) continue; // a stem that is silent all through (keys, guitar in a techno tune)
      const name = `Stem ${label}`;
      // The clip plays the stem from bar 1 of the tune on (the pickup before it is cut): offset in bars of the stem.
      const clips = ranges.map((r) => ({ id: uid(), sampleId: sample.id, start: r.start, length: r.length, offset: r.start + offsetBars }));
      const at = tracks.findIndex((t) => t.name === name && (t.kind ?? 'audio') === 'audio');
      if (at >= 0) tracks[at] = { ...tracks[at], clips };
      else tracks = [...tracks, { ...createTrack(sample.category, p.sceneCount, name, 'audio'), color: CATEGORY_COLORS[sample.category], clips }];
      names.push(name);
    }
    return withMarkers({ ...p, bpm: grid.bpm, tracks, loop: { enabled: false, start: 0, end } }, marks);
  });
  return { sections, tracks: names, bpm: grid.bpm, offsetSec: grid.offsetSec, split };
}
