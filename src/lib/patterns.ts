import type { Note } from '../types';

// Pattern generator for MIDI clips: hard techno building blocks in a minor key.
// Pure and seeded, so "Würfeln" gives a new variation and tests stay deterministic.

export type PatternStyle = 'rumble' | 'offbeat' | 'acid' | 'arp' | 'stabs' | 'kick' | 'hat' | 'clap' | 'hats16';

export const PATTERN_STYLES: { id: PatternStyle; label: string }[] = [
  { id: 'rumble', label: 'Rumble' },
  { id: 'offbeat', label: 'Offbeat-Bass' },
  { id: 'acid', label: 'Acid' },
  { id: 'arp', label: 'Arp' },
  { id: 'stabs', label: 'Stabs' },
];

/** For sample instruments: one drum sound per track, on the sample's own pitch (C3). */
export const DRUM_STYLES: { id: PatternStyle; label: string }[] = [
  { id: 'kick', label: 'Kick 4/4' },
  { id: 'hat', label: 'Offbeat-Hat' },
  { id: 'clap', label: 'Clap 2 & 4' },
  { id: 'hats16', label: '16tel-Hats' },
];

export const isDrumStyle = (style: PatternStyle) => DRUM_STYLES.some((d) => d.id === style);

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

/** Minor-key arpeggio in 16ths over i – VI – VII – i, one chord per bar. */
function arp(root: number, rand: () => number): Note[] {
  const chords = [
    [0, 3, 7],
    [-4, 0, 3], // VI, voiced close around the root so the line stays in a two-octave view
    [-2, 2, 5], // VII
    [0, 3, 7],
  ];
  const shapes = [
    [0, 1, 2, 3],
    [0, 2, 1, 3],
    [3, 2, 1, 0],
    [0, 1, 2, 1],
  ];
  const shape = shapes[Math.floor(rand() * shapes.length)];
  const notes: Note[] = [];
  chords.forEach((chord, bar) => {
    const tones = [...chord, chord[0] + 12].map((d) => LEAD + root + d);
    for (let i = 0; i < 16; i++) notes.push(note(tones[shape[i % 4]], bar * 16 + i, 1, i % 4 === 0 ? 0.9 : 0.7));
  });
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

const PHRASE_BARS: Record<PatternStyle, number> = { rumble: 2, offbeat: 2, acid: 2, arp: 4, stabs: 1, kick: 2, hat: 2, clap: 2, hats16: 2 };

/** A pattern of `style` in the minor key on `root` (0 = C … 11 = B), filling `bars` bars. */
export function generatePattern(style: PatternStyle, opts: { root: number; bars: number; seed: number }): Note[] {
  const rand = seededRandom(opts.seed);
  const root = ((Math.round(opts.root) % 12) + 12) % 12;
  const make = { rumble, offbeat, acid, arp, stabs, kick, hat, clap, hats16 }[style];
  return repeat(make(root, rand), PHRASE_BARS[style], Math.max(STEP, opts.bars));
}
