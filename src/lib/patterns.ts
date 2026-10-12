import type { Note } from '../types';
import { arpLine, hypnoticLine, padChords, progArp, raveStabs, reeseLine, tranceLead, type MelodyOpts, type ScaleName } from './melody';

// Pattern generator for MIDI clips: hard techno building blocks in a minor key.
// Pure and seeded, so "Würfeln" gives a new variation and tests stay deterministic.

export type PatternStyle = 'rumble' | 'offbeat' | 'reese' | 'acid' | 'arp' | 'prog' | 'trance' | 'hypnotic' | 'pad' | 'stabs' | 'rave' | 'kick' | 'hat' | 'clap' | 'hats16' | 'kit-techno' | 'kit-rolling' | 'kit-minimal';

/** For synth tracks, grouped the way the generator sheet shows them. */
export const PATTERN_GROUPS: { label: string; styles: { id: PatternStyle; label: string }[] }[] = [
  {
    label: 'Bass',
    styles: [
      { id: 'rumble', label: 'Rumble' },
      { id: 'offbeat', label: 'Offbeat-Bass' },
      { id: 'reese', label: 'Reese' },
      { id: 'acid', label: 'Acid' },
    ],
  },
  {
    label: 'Melodie',
    styles: [
      { id: 'trance', label: 'Trance-Lead' },
      { id: 'hypnotic', label: 'Hypnotic' },
      { id: 'arp', label: 'Arp' },
      { id: 'prog', label: 'Prog-Arp' },
    ],
  },
  {
    label: 'Akkorde',
    styles: [
      { id: 'pad', label: 'Pad-Akkorde' },
      { id: 'stabs', label: 'Stabs' },
      { id: 'rave', label: 'Rave-Stabs' },
    ],
  },
];

export const PATTERN_STYLES = PATTERN_GROUPS.flatMap((g) => g.styles);

/** Styles that follow the chosen scale and chord progression (the others are fixed minor patterns). */
const MELODIC: Partial<Record<PatternStyle, (o: MelodyOpts) => Note[]>> = { arp: arpLine, reese: reeseLine, trance: tranceLead, hypnotic: hypnoticLine, prog: progArp, pad: padChords, rave: raveStabs };
export const usesScale = (style: PatternStyle) => style in MELODIC;

/** For sample instruments: one drum sound per track, on the sample's own pitch (C3). */
export const DRUM_STYLES: { id: PatternStyle; label: string }[] = [
  { id: 'kick', label: 'Kick 4/4' },
  { id: 'hat', label: 'Offbeat-Hat' },
  { id: 'clap', label: 'Clap 2 & 4' },
  { id: 'hats16', label: '16tel-Hats' },
];

export const isDrumStyle = (style: PatternStyle) => DRUM_STYLES.some((d) => d.id === style);

/** For the 909 kit: whole grooves, every drum on its own pad (notes from C1, see drum909.ts). */
export const KIT_STYLES: { id: PatternStyle; label: string }[] = [
  { id: 'kit-techno', label: 'Hard Techno' },
  { id: 'kit-rolling', label: 'Rolling' },
  { id: 'kit-minimal', label: 'Minimal' },
];

export const isKitStyle = (style: PatternStyle) => KIT_STYLES.some((d) => d.id === style);

export const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const STEP = 1 / 16; // one 16th note in bars
const BASS = 36; // C1
const LEAD = 60; // C3

/** Small fast PRNG (mulberry32): same seed, same pattern. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const note = (pitch: number, step: number, steps: number, velocity: number): Note => ({
  pitch: Math.max(0, Math.min(127, pitch)),
  start: step * STEP,
  length: steps * STEP,
  velocity: Math.round(velocity * 100) / 100,
});

/** Repeats a phrase of `phraseBars` across `bars`, cutting what would run past the end. */
function repeat(phrase: Note[], phraseBars: number, bars: number): Note[] {
  const out: Note[] = [];
  for (let at = 0; at < bars - 1e-9; at += phraseBars) {
    for (const n of phrase) {
      const start = n.start + at;
      if (start >= bars - 1e-9) continue;
      out.push({ ...n, start, length: Math.min(n.length, bars - start) });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** Three 16ths between the kicks: the classic rolling hard techno bass. */
function rumble(root: number, rand: () => number): Note[] {
  const p = BASS + root;
  const notes: Note[] = [];
  for (let beat = 0; beat < 8; beat++) {
    // The last beat of the phrase sometimes climbs to the fifth or octave.
    const turn = beat === 7 && rand() < 0.6 ? (rand() < 0.5 ? 7 : 12) : 0;
    notes.push(note(p, beat * 4 + 1, 1, 0.6), note(p + turn, beat * 4 + 2, 1, 0.85), note(p + turn, beat * 4 + 3, 1, 0.7));
  }
  return notes;
}

/** One bass note on every off-beat, with an occasional octave. */
function offbeat(root: number, rand: () => number): Note[] {
  const p = BASS + root;
  return Array.from({ length: 8 }, (_, beat) => note(beat % 4 === 3 && rand() < 0.5 ? p + 12 : p, beat * 4 + 2, 2, 0.85));
}

/** 16th line over a minor pentatonic with accents and ties, two bars long. */
function acid(root: number, rand: () => number): Note[] {
  const degrees = [0, 0, 0, 3, 5, 7, 10, 12, 15];
  const p = BASS + 12 + root;
  const hits = Array.from({ length: 32 }, (_, i) => i % 4 === 0 || rand() < 0.65);
  const notes: Note[] = [];
  for (let i = 0; i < 32; i++) {
    if (!hits[i]) continue;
    const tie = i < 31 && !hits[i + 1] && rand() < 0.5;
    const accent = rand() < 0.3;
    notes.push(note(p + degrees[Math.floor(rand() * degrees.length)], i, tie ? 2 : 1, accent ? 1 : 0.65));
  }
  return notes;
}

/** Short minor chords on syncopated 16ths, one bar repeated. */
function stabs(root: number, rand: () => number): Note[] {
  const slots = [2, 3, 6, 7, 10, 11, 14, 15];
  const chosen = slots.filter((_, i) => i === 0 || rand() < 0.45);
  const chord = [0, 3, 7].map((d) => LEAD + root + d);
  return chosen.flatMap((step) => chord.map((p) => note(p, step, 1, 0.85)));
}

const DRUM = 60; // C3: a sample instrument's original pitch

/** Four on the floor; now and then a ghost kick before the next bar. */
function kick(_root: number, rand: () => number): Note[] {
  const notes = Array.from({ length: 8 }, (_, beat) => note(DRUM, beat * 4, 1, 1));
  if (rand() < 0.5) notes.push(note(DRUM, 31, 1, 0.55));
  return notes;
}

/** Open hat on every off-beat. */
const hat = (): Note[] => Array.from({ length: 8 }, (_, beat) => note(DRUM, beat * 4 + 2, 1, 0.8));

/** Clap on beats 2 and 4, sometimes a flam into the last one. */
function clap(_root: number, rand: () => number): Note[] {
  const notes = Array.from({ length: 4 }, (_, i) => note(DRUM, i * 8 + 4, 1, 0.9));
  if (rand() < 0.5) notes.push(note(DRUM, 27, 1, 0.5));
  return notes;
}

/** Closed hats in 16ths: accented off-beats, some steps left out. */
function hats16(_root: number, rand: () => number): Note[] {
  const notes: Note[] = [];
  for (let i = 0; i < 32; i++) {
    if (i % 4 === 2) notes.push(note(DRUM, i, 1, 0.95));
    else if (rand() < 0.8) notes.push(note(DRUM, i, 1, i % 2 ? 0.45 + rand() * 0.15 : 0.6));
  }
  return notes;
}

// Pad notes of the 909 kit.
const K = { kick: 36, rim: 37, snare: 38, clap: 39, tomL: 41, hatC: 42, tomM: 45, hatO: 46, tomH: 48, crash: 49, bell: 56 };

/** Last beat of a phrase: a snare roll that gets louder, or a tom run down, or nothing. */
function fill(rand: () => number): Note[] {
  const r = rand();
  if (r < 0.35) return Array.from({ length: 4 }, (_, i) => note(K.snare, 28 + i, 1, 0.55 + i * 0.15));
  if (r < 0.65) return [note(K.tomH, 28, 1, 0.9), note(K.tomH, 29, 1, 0.75), note(K.tomM, 30, 1, 0.9), note(K.tomL, 31, 1, 1)];
  return [];
}

/** Four on the floor, clap on 2 & 4, open hat on every off-beat, ghost 16th hats, a fill every second bar. */
function kitTechno(_root: number, rand: () => number): Note[] {
  const notes: Note[] = [];
  for (let beat = 0; beat < 8; beat++) notes.push(note(K.kick, beat * 4, 1, 1), note(K.hatO, beat * 4 + 2, 1, 0.75));
  for (let i = 0; i < 4; i++) notes.push(note(K.clap, i * 8 + 4, 1, 0.9));
  for (let i = 1; i < 32; i += 2) if (rand() < 0.55) notes.push(note(K.hatC, i, 1, 0.3 + rand() * 0.2));
  if (rand() < 0.5) notes.push(note(K.rim, 23, 1, 0.5));
  if (rand() < 0.3) notes.push(note(K.crash, 0, 1, 0.7));
  const f = fill(rand);
  // The fill replaces everything but the kick in the last beat.
  const inFill = (n: Note) => f.length > 0 && n.start >= 28 * STEP - 1e-9 && n.pitch !== K.kick;
  return [...notes.filter((n) => !inFill(n)), ...f];
}

/** Four on the floor with a rolling 16th hat line, accents on the off-beat and a syncopated rim. */
function kitRolling(_root: number, rand: () => number): Note[] {
  const notes: Note[] = [];
  for (let beat = 0; beat < 8; beat++) notes.push(note(K.kick, beat * 4, 1, 1));
  for (let i = 0; i < 32; i++) {
    if (i % 4 === 2) notes.push(note(K.hatO, i, 1, 0.8));
    else if (i % 4 !== 0 || rand() < 0.4) notes.push(note(K.hatC, i, 1, i % 2 ? 0.35 : 0.55));
  }
  for (const i of [4, 12, 20, 28]) notes.push(note(K.clap, i, 1, 0.85));
  for (const i of [7, 15, 23]) if (rand() < 0.6) notes.push(note(K.rim, i, 1, 0.55));
  if (rand() < 0.4) notes.push(note(K.bell, 30, 1, 0.45));
  return notes;
}

/** Sparse: kick, clap, 8th hats and a ghost snare now and then. */
function kitMinimal(_root: number, rand: () => number): Note[] {
  const notes: Note[] = [];
  for (let beat = 0; beat < 8; beat++) notes.push(note(K.kick, beat * 4, 1, 1));
  for (let i = 0; i < 4; i++) notes.push(note(K.clap, i * 8 + 4, 1, 0.85));
  for (let i = 0; i < 16; i++) notes.push(note(K.hatC, i * 2, 1, i % 2 ? 0.4 : 0.55));
  for (const i of [11, 27]) if (rand() < 0.7) notes.push(note(K.snare, i, 1, 0.3));
  if (rand() < 0.4) notes.push(note(K.bell, 22, 1, 0.4));
  return notes;
}

const PHRASE_BARS: Partial<Record<PatternStyle, number>> = { rumble: 2, offbeat: 2, acid: 2, stabs: 1, kick: 2, hat: 2, clap: 2, hats16: 2, 'kit-techno': 2, 'kit-rolling': 2, 'kit-minimal': 2 };

/**
 * A pattern of `style` on `root` (0 = C … 11 = B), filling `bars` bars. The melodic styles follow `scale`
 * (default minor) and a chord progression of it; the older ones are fixed minor patterns.
 */
export function generatePattern(style: PatternStyle, opts: { root: number; bars: number; seed: number; scale?: ScaleName; progression?: number }): Note[] {
  const rand = seededRandom(opts.seed);
  const root = ((Math.round(opts.root) % 12) + 12) % 12;
  const bars = Math.max(STEP, opts.bars);
  const melodic = MELODIC[style];
  if (melodic) return melodic({ root, scale: opts.scale ?? 'minor', bars, rand, progression: opts.progression });
  const make = { rumble, offbeat, acid, stabs, kick, hat, clap, hats16, 'kit-techno': kitTechno, 'kit-rolling': kitRolling, 'kit-minimal': kitMinimal }[style as 'rumble'];
  return repeat(make(root, rand), PHRASE_BARS[style] ?? 1, bars);
}
