import { engine } from '../audio/engine';
import { presetById, applyPreset } from '../audio/presets';
import { encodeWav } from '../audio/wav';
import { DRUM_PARTS, DRUM_PART_LABEL, bandOf, monoForAnalysis, transcribeDrums } from './drumSplit';
import { createMidiClip, createTrack, uid } from './project';
import { storeSampleAudio } from './samples';
import type { Sample } from '../types';
import { arrange, type ArrangeResult, type Role } from './arranger';
import { planSections, type PlanSection } from './arrangePlan';
import { barLevels, stemKindOf, structureFromStems, type StemKind } from './referenceArrange';
import { STEMS_ROOT } from './stemNames';
import { getState, setSamples, updateProject } from './store';

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
  const levels: Partial<Record<StemKind, number[]>> = {};
  for (const s of stems) {
    const kind = stemKindOf(s.name)!;
    const buffer = await engine.loadBuffer(s.id);
    const lv = barLevels(buffer.getChannelData(0), buffer.sampleRate, bpm);
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
  const out: Sample[] = [];
  for (const part of DRUM_PARTS) {
    const wav = encodeWav({ sampleRate: buffer.sampleRate, channels: channels.map((ch) => bandOf(ch, buffer.sampleRate, part)) });
    const id = `split:${uid()}`;
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
