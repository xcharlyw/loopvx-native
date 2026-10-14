import { SUGGESTED_PRESET, applyPreset, presetById } from '../audio/presets';
import { sampleLengthBars } from '../audio/timing';
import type { AutoPoint, Clip, Note, Project, Sample, Track } from '../types';
import { joinPoints, ramp, setLane, throwAt } from './automation';
import { keysFit } from './libraryFilter';
import { withMarkers } from './markers';
import { generatePattern, seededRandom, type PatternStyle } from './patterns';
import { createMidiClip, createTrack, projectHarmony, trackKind, trackSynth, uid } from './project';

// The arranger: from the tracks and the library it lays out a whole hard techno track (intro, build, drop, break,
// second build and drop, outro) with clips, MIDI grooves and automation. Rule based and seeded: the same seed gives
// the same arrangement, "Neu würfeln" a different one. Pure, so it is tested; the panel only calls `arrange`.

export type SectionId = 'intro' | 'build' | 'drop' | 'break' | 'build2' | 'drop2' | 'outro';

export interface Section {
  id: SectionId;
  label: string;
  /** Bar where it starts (0-based) and its length in bars. */
  start: number;
  bars: number;
  /** Roles that stay silent in this section (from an AI plan: "no bass in the break"). */
  mute?: Role[];
}

export type ArrangeLength = 64 | 128;

const LABELS: Record<SectionId, string> = { intro: 'Intro', build: 'Build-up', drop: 'Drop', break: 'Break', build2: 'Build-up 2', drop2: 'Drop 2', outro: 'Outro' };
const SHAPE: Record<ArrangeLength, [SectionId, number][]> = {
  128: [['intro', 16], ['build', 16], ['drop', 32], ['break', 16], ['drop2', 32], ['outro', 16]],
  64: [['intro', 8], ['build', 8], ['drop', 16], ['break', 8], ['drop2', 16], ['outro', 8]],
};
// The second build is the last quarter of the break: the section list above keeps break whole, build2 is derived.

/** The sections of the arrangement, in order, with their positions. */
export function sectionsFor(length: ArrangeLength): Section[] {
  const out: Section[] = [];
  let at = 0;
  for (const [id, bars] of SHAPE[length]) {
    if (id === 'break') {
      const tail = Math.max(4, bars / 4);
      out.push({ id: 'break', label: LABELS.break, start: at, bars: bars - tail }, { id: 'build2', label: LABELS.build2, start: at + bars - tail, bars: tail });
    } else {
      out.push({ id, label: LABELS[id], start: at, bars });
    }
    at += bars;
  }
  return out;
}

export type Role = 'drums' | 'bass' | 'lead' | 'pad' | 'kickLoop' | 'topLoop' | 'synthLoop' | 'vocal';

/** What a track does in the arrangement, judged from its kind, instrument and category; undefined for a track the arranger leaves alone. */
export function roleOf(track: Track): Role | undefined {
  if (trackKind(track) === 'audio') {
    return track.category === 'kick' ? 'kickLoop' : track.category === 'top' ? 'topLoop' : track.category === 'synth' ? 'synthLoop' : track.category === 'vocal' ? 'vocal' : undefined;
  }
  const synth = trackSynth(track);
  if (synth.wave === 'kit909') return 'drums';
  if (synth.wave === 'kick' || synth.wave === 'noise' || synth.wave === 'sample') return undefined; // single drum sounds: not ours
  const category = presetById(synth.preset)?.category;
  if (category === 'Bass' || /bass|rumble|reese/i.test(track.name)) return 'bass';
  if (category === 'Pad' || /pad|chord/i.test(track.name)) return 'pad';
  return 'lead';
}

/** Which spans (bar offsets inside the section) a role plays in, as fractions [from, to] of the section; missing = silent. */
const SPANS: Record<Role, Partial<Record<SectionId, [number, number]>>> = {
  drums: { intro: [0, 1], build: [0, 1], drop: [0, 1], build2: [0, 1], drop2: [0, 1], outro: [0, 0.75] },
  kickLoop: { intro: [0, 1], build: [0, 1], drop: [0, 1], build2: [0, 1], drop2: [0, 1], outro: [0, 0.75] },
  bass: { build: [0.5, 1], drop: [0, 1], build2: [0.5, 1], drop2: [0, 1], outro: [0, 0.5] },
  topLoop: { intro: [0.5, 1], build: [0, 1], drop: [0, 1], build2: [0, 1], drop2: [0, 1], outro: [0, 0.5] },
  synthLoop: { build: [0.5, 1], drop: [0, 1], break: [0, 1], build2: [0, 1], drop2: [0, 1], outro: [0, 0.5] },
  lead: { build: [0.5, 1], drop: [0, 1], break: [0, 1], build2: [0, 1], drop2: [0, 1] },
  pad: { build: [0.5, 1], break: [0, 1], build2: [0, 1], outro: [0, 0.5] },
  vocal: { drop: [0.25, 0.75], drop2: [0, 0.5] },
};

/** The generator style for a MIDI role in a section (kit grooves for the drums). */
function styleFor(role: Role, section: SectionId, track: Track, styles: ArrangeStyles = {}): PatternStyle | undefined {
  const drop = section === 'drop' || section === 'drop2';
  if (role === 'drums' && drop && styles.drums) return styles.drums;
  if (role === 'bass' && styles.bass) return styles.bass;
  if (role === 'lead' && styles.lead && section !== 'break') return styles.lead;
  if (role === 'drums') return section === 'intro' || section === 'outro' ? 'kit-minimal' : section === 'build' || section === 'build2' ? 'kit-rolling' : 'kit-techno';
  const wanted = (Object.entries(SUGGESTED_PRESET).find(([, id]) => id === trackSynth(track).preset)?.[0] ?? undefined) as PatternStyle | undefined;
  if (role === 'bass') return section === 'drop2' ? 'reese' : wanted && ['rumble', 'offbeat', 'reese', 'acid'].includes(wanted) ? wanted : 'rumble';
  if (role === 'pad') return 'pad';
  if (role === 'lead') {
    if (section === 'break') return 'trance';
    if (section === 'build' || section === 'build2') return 'arp';
    return section === 'drop' ? 'hypnotic' : 'trance';
  }
  return undefined;
}

/** A snare roll for the last bar before a drop: 16ths getting louder. */
function snareRoll(): Note[] {
  return Array.from({ length: 16 }, (_, i) => ({ pitch: 38, start: i / 16, length: 1 / 16, velocity: Math.round((0.3 + (i / 15) * 0.7) * 100) / 100 }));
}

/** Library samples that fit a role: right category, tempo within ±8 BPM of the project (or unknown), key that mixes. */
export function candidates(samples: Sample[], category: Sample['category'], project: Pick<Project, 'bpm' | 'key'>): Sample[] {
  const fits = samples.filter((s) => s.category === category && (!s.bpm || Math.abs(s.bpm - project.bpm) <= 8) && (category === 'kick' || category === 'top' || keysFit(s.key, project.key)));
  return fits.sort((a, b) => Math.abs((a.bpm ?? project.bpm) - project.bpm) - Math.abs((b.bpm ?? project.bpm) - project.bpm) || a.name.localeCompare(b.name));
}

/** Pattern styles a plan may pick: bass and lead everywhere they play, drums for the drops. */
export interface ArrangeStyles {
  bass?: 'rumble' | 'offbeat' | 'reese' | 'acid';
  lead?: 'trance' | 'hypnotic' | 'arp' | 'prog' | 'stabs' | 'rave';
  drums?: 'kit-techno' | 'kit-rolling' | 'kit-minimal';
}

/** A one-off sound (impact, riser ...) from the library on its own audio track, placed at one bar. */
export type FxKind = 'impact' | 'riser' | 'downlifter' | 'crash' | 'other';
export interface FxHit {
  kind: FxKind;
  /** 0-based bar where the sound starts. */
  bar: number;
  /** Clip length in bars; default: the sample's own length. */
  length?: number;
  /** Name of the audio track it goes on (an existing track of that name is reused); default by kind. */
  track?: string;
  /** Words to look for in the library sample names, best first. */
  search?: string[];
  /** A library sample the user (or the AI) named; matched loosely against the sample names. */
  sample?: string;
}

export const FX_KINDS: FxKind[] = ['impact', 'riser', 'downlifter', 'crash', 'other'];
export const FX_TRACK: Record<FxKind, string> = { impact: 'Impact FX', riser: 'Riser FX', downlifter: 'Downlifter FX', crash: 'Crash FX', other: 'FX' };
const FX_WORDS: Record<FxKind, string[]> = {
  impact: ['impact', 'hit', 'boom', 'slam', 'downhit', 'drop'],
  riser: ['riser', 'rise', 'uplifter', 'uplift', 'sweep', 'build', 'swell', 'tension'],
  downlifter: ['downlifter', 'downlift', 'fall', 'down', 'reverse'],
  crash: ['crash', 'cymbal'],
  other: ['fx', 'effect', 'noise', 'texture', 'atmos'],
};

const plain = (v: string) => v.toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^a-z0-9äöüß]+/g, ' ').trim();

/**
 * The library sample for an effect: a sample named by the plan (loosely matched), else the best match for the plan's search
 * words and the kind's own words in the name and folder. Short one-shots win for hits; vocals never. One of the best three is
 * picked, so rolling again changes the sound.
 */
export function findFxSample(samples: Sample[], hit: Pick<FxHit, 'kind' | 'search' | 'sample'>, rand: () => number = () => 0): Sample | undefined {
  const usable = samples.filter((x) => x.category !== 'vocal');
  const named = hit.sample ? plain(hit.sample) : '';
  if (named.length >= 3) {
    const exact = usable.find((x) => plain(x.name) === named);
    if (exact) return exact;
    const loose = usable.filter((x) => plain(x.name).includes(named) || named.includes(plain(x.name))).sort((a, b) => a.name.length - b.name.length);
    if (loose.length) return loose[0];
  }
  const wanted = (hit.search ?? []).map(plain).filter(Boolean);
  const own = FX_WORDS[hit.kind];
  const oneShot = hit.kind === 'impact' || hit.kind === 'crash';
  const scored = usable
    .map((x) => {
      const hay = ` ${plain(`${x.name} ${x.folder ?? ''}`)} `;
      const has = (w: string) => hay.includes(` ${w} `) || hay.includes(w);
      const score = wanted.filter(has).length * 2 + own.filter(has).length;
      return { x, score: score + (oneShot && !x.bpm ? 0.5 : 0) - (x.duration && x.duration > 12 ? 1 : 0) };
    })
    .filter((e) => e.score >= 1)
    .sort((a, b) => b.score - a.score || (a.x.duration ?? 99) - (b.x.duration ?? 99) || a.x.name.localeCompare(b.x.name));
  if (!scored.length) return undefined;
  const top = scored.filter((e) => e.score >= scored[0].score - 0.25).slice(0, 3);
  return top[Math.floor(rand() * top.length)].x;
}

export interface ArrangeOptions {
  /** The fixed shape to use when no `sections` are given (default 128 bars). */
  length?: ArrangeLength;
  /** A custom structure (an AI plan) instead of the fixed shape of `length`. */
  sections?: Section[];
  styles?: ArrangeStyles;
  /** Which missing roles to add (default: all of drums, bass, lead and pad). */
  addRoles?: Role[];
  seed: number;
  /** Add 909 drums, bass and lead tracks where the project has none. */
  addMissingTracks: boolean;
  /** Filter sweeps, reverb throws, drive build-ups and the fade-out. */
  automation: boolean;
  /** One-off effect sounds from the library, each on an audio track of its own. */
  fx?: FxHit[];
}

export interface ArrangeResult {
  project: Project;
  sections: Section[];
  /** Tracks that were added, and audio roles that had no sample in the library. */
  added: string[];
  missingSamples: string[];
  /** The effects that were placed (bar is 1-based, as shown) and those without a matching library sample. */
  fx: { track: string; bar: number; sample: string }[];
  fxMissing: string[];
}

/** The tracks the arranger adds where a role is missing, with fader levels that sit together (the bass carries the track). */
const MISSING: { role: Role; name: string; preset: string; category: Track['category']; volume: number }[] = [
  { role: 'drums', name: 'Drums 909', preset: 'kit-909', category: 'kick', volume: 0.9 },
  { role: 'bass', name: 'Rumble Bass', preset: 'rumble-saw', category: 'synth', volume: 1.2 },
  { role: 'lead', name: 'Lead', preset: 'supersaw', category: 'synth', volume: 0.75 },
  { role: 'pad', name: 'Pad', preset: 'warm-pad', category: 'synth', volume: 0.6 },
];

/** The clips of one track: a span per section it plays in. */
function clipsFor(role: Role, track: Track, sections: Section[], project: Project, samples: Sample[], rand: () => number, seed: number, kickLoop: boolean, styles?: ArrangeStyles): { clips: Clip[]; missing: boolean } {
  const clips: Clip[] = [];
  const { root, scale, progression } = projectHarmony(project);
  let sample: Sample | undefined;
  if (trackKind(track) === 'audio') {
    const pool = candidates(samples, track.category, project);
    // The nearest few, so "Neu würfeln" changes the pick without leaving the tempo.
    sample = pool.length ? pool[Math.floor(rand() * Math.min(3, pool.length))] : undefined;
    if (!sample) return { clips, missing: true };
  }
  for (const sec of sections) {
    const span = SPANS[role][sec.id];
    if (!span || sec.mute?.includes(role)) continue;
    const start = sec.start + Math.round(span[0] * sec.bars);
    const length = Math.round((span[1] - span[0]) * sec.bars);
    if (length < 1) continue;
    if (sample) {
      clips.push({ id: uid(), sampleId: sample.id, start, length, offset: 0 }); // the sample loops over the clip's whole length
      continue;
    }
    const style = styleFor(role, sec.id, track, styles);
    if (!style) continue;
    // Before a drop the drums get a snare roll in the last bar; the drop opens with a crash.
    const rollBar = role === 'drums' && (sec.id === 'build' || sec.id === 'build2') && length >= 2;
    const mainLength = rollBar ? length - 1 : length;
    let notes = generatePattern(style, { root, bars: mainLength, seed: seed + sec.start * 31 + clips.length, scale, progression });
    if (role === 'drums' && kickLoop) notes = notes.filter((n) => n.pitch !== 36); // a kick loop already carries the kick
    if (role === 'drums' && (sec.id === 'drop' || sec.id === 'drop2') && span[0] === 0) notes.push({ pitch: 49, start: 0, length: 1 / 16, velocity: 0.85 });
    clips.push({ ...createMidiClip(start, mainLength), notes });
    if (rollBar) clips.push({ ...createMidiClip(start + mainLength, 1), notes: snareRoll() });
  }
  return { clips, missing: false };
}

/** Curves per role: what makes the sections feel different. Points are absolute bars. */
function automationFor(role: Role, track: Track, sections: Section[], end: number): Partial<Record<'filter' | 'drive' | 'reverb' | 'volume', AutoPoint[]>> {
  const by = (id: SectionId) => sections.filter((s) => s.id === id);
  const lanes: Partial<Record<'filter' | 'drive' | 'reverb' | 'volume', AutoPoint[]>> = {};
  const open = (a: number, b: number, from: number) => ramp('filter', a, b, from, 0);
  if (role === 'lead' || role === 'pad' || role === 'synthLoop' || role === 'topLoop') {
    const parts: AutoPoint[][] = [];
    for (const s of by('build')) parts.push(open(s.start, s.start + s.bars, -0.85));
    for (const s of by('build2')) parts.push(open(s.start, s.start + s.bars, -0.85));
    for (const s of by('break')) parts.push(open(s.start, s.start + s.bars, -0.6));
    for (const s of by('outro')) parts.push(ramp('filter', s.start + s.bars / 2, s.start + s.bars, 0, -0.85));
    lanes.filter = joinPoints(...parts);
  }
  if (role === 'lead' || role === 'pad') {
    const parts: AutoPoint[][] = [];
    for (const s of by('break')) parts.push([{ bar: s.start, value: 0.5 }]);
    for (const d of [...by('drop'), ...by('drop2')]) parts.push(throwAt('reverb', d.start, 4, 0.7, 0.12));
    lanes.reverb = joinPoints(...parts);
  }
  if (role === 'bass') {
    const parts: AutoPoint[][] = [];
    for (const s of [...by('build'), ...by('build2')]) parts.push(ramp('drive', s.start, s.start + s.bars, 0.05, 0.5));
    for (const s of [...by('drop'), ...by('drop2')]) parts.push([{ bar: s.start, value: 0.5 }, { bar: s.start + s.bars, value: 0.5 }]);
    for (const s of by('outro')) parts.push(ramp('drive', s.start, s.start + s.bars, 0.5, 0.1));
    lanes.drive = joinPoints(...parts);
  }
  if (role !== 'vocal') {
    const fade = Math.min(8, by('outro')[0]?.bars ?? 0);
    if (fade > 0) lanes.volume = ramp('volume', end - fade, end, 1, 0);
  }
  return lanes;
}

/**
 * Lays out the arrangement on `project`. Existing clips are replaced; tracks keep their instruments and effects (a
 * pump is added to bass, lead and pad when they have none). Missing roles can be added as new MIDI tracks.
 */
export function arrange(project: Project, samples: Sample[], opts: ArrangeOptions): ArrangeResult {
  const rand = seededRandom(opts.seed);
  const sections = opts.sections?.length ? opts.sections : sectionsFor(opts.length ?? 128);
  const end = sections.reduce((e, sec) => Math.max(e, sec.start + sec.bars), 0);
  const added: string[] = [];
  const missingSamples: string[] = [];
  let tracks = project.tracks.map((t) => ({ ...t }));

  if (opts.addMissingTracks) {
    const have = new Set(tracks.map(roleOf));
    for (const m of MISSING) {
      if (have.has(m.role) || (opts.addRoles && !opts.addRoles.includes(m.role))) continue;
      const preset = presetById(m.preset);
      if (!preset) continue;
      tracks.push({ ...applyPreset(createTrack(m.category, project.sceneCount, m.name, 'midi'), preset), volume: m.volume });
      added.push(m.name);
    }
  }

  // A kick loop from the library carries the kick: the 909 then leaves its kick pad out.
  const kickLoop = tracks.some((t) => roleOf(t) === 'kickLoop' && candidates(samples, 'kick', project).length > 0);
  tracks = tracks.map((t) => {
    const role = roleOf(t);
    if (!role) return t;
    const { clips, missing } = clipsFor(role, t, sections, project, samples, rand, opts.seed, kickLoop, opts.styles);
    if (missing) {
      missingSamples.push(t.name);
      return t; // no sample for this track: its clips stay as they were
    }
    let next: Track = { ...t, clips };
    if (['bass', 'lead', 'pad'].includes(role) && !(next.fx?.pump)) next = { ...next, fx: { ...next.fx, pump: role === 'bass' ? 0.6 : 0.45 } };
    if (opts.automation) {
      for (const [param, points] of Object.entries(automationFor(role, next, sections, end))) {
        if (points?.length) next = setLane(next, param as 'filter', points);
      }
    }
    return next;
  });

  const fx: ArrangeResult['fx'] = [];
  const fxMissing: string[] = [];
  for (const hit of opts.fx ?? []) {
    const name = hit.track?.trim() || FX_TRACK[hit.kind];
    const found = findFxSample(samples, hit, rand);
    if (!found) {
      fxMissing.push(`${name} (Takt ${hit.bar + 1})`);
      continue;
    }
    const bars = hit.length ?? (found.duration ? sampleLengthBars(found.duration, project.bpm, found.bpm) : 2);
    const length = Math.max(0.25, Math.min(64, Math.round(bars * 16) / 16));
    const clip: Clip = { id: uid(), sampleId: found.id, start: hit.bar, length, offset: 0 };
    let at = tracks.findIndex((t) => trackKind(t) === 'audio' && t.name.toLowerCase() === name.toLowerCase());
    if (at < 0) {
      tracks.push(createTrack('other', project.sceneCount, name, 'audio'));
      added.push(name);
      at = tracks.length - 1;
    }
    // Rolling again replaces the effect at the same bar and leaves every other clip of the track alone.
    tracks[at] = { ...tracks[at], clips: [...tracks[at].clips.filter((c) => Math.abs(c.start - hit.bar) > 1e-6), clip] };
    fx.push({ track: name, bar: hit.bar + 1, sample: found.name.replace(/\.[a-z0-9]{2,5}$/i, '') });
  }

  // With the 909 playing the kick, bass, lead and pad pump on its real kick hits (a sidechain) instead of on every beat.
  const drums = !kickLoop ? tracks.find((t) => roleOf(t) === 'drums') : undefined;
  if (drums) tracks = tracks.map((t) => (['bass', 'lead', 'pad'].includes(roleOf(t) ?? '') && t.fx?.pump && !t.fx.pumpFrom ? { ...t, fx: { ...t.fx, pumpFrom: drums.id } } : t));
  // The sections become markers in the ruler, so the structure stays visible.
  const marked = withMarkers({ ...project, tracks, loop: { enabled: false, start: 0, end } }, sections.map((s) => ({ bar: s.start, name: s.label })));
  return { project: marked, sections, added, missingSamples, fx, fxMissing };
}

