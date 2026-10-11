import type { Note } from '../types';

// Melodic generators for MIDI clips: scale-aware, with chord progressions and phrase structure.
// Everything is pure and driven by a seeded random function, so "Würfeln" gives a new variation and
// tests can check musical properties (in key, in range, phrase endings) deterministically.

export type ScaleName = 'minor' | 'harmonic' | 'phrygian' | 'dorian' | 'major';

export interface Scale {
  id: ScaleName;
  label: string;
  /** Semitones above the root for the seven degrees. */
  steps: number[];
  /** Chord progressions as scale degrees (0 = I/i), four bars each. */
  progressions: number[][];
}

export const SCALES: Scale[] = [
  { id: 'minor', label: 'Moll', steps: [0, 2, 3, 5, 7, 8, 10], progressions: [[0, 5, 2, 6], [0, 6, 5, 6], [0, 3, 5, 4], [0, 5, 6, 4]] },
  { id: 'harmonic', label: 'Harm. Moll', steps: [0, 2, 3, 5, 7, 8, 11], progressions: [[0, 5, 3, 4], [0, 3, 4, 0], [0, 5, 1, 4]] },
  { id: 'phrygian', label: 'Phrygisch', steps: [0, 1, 3, 5, 7, 8, 10], progressions: [[0, 1, 0, 6], [0, 1, 6, 5], [0, 6, 1, 0]] },
  { id: 'dorian', label: 'Dorisch', steps: [0, 2, 3, 5, 7, 9, 10], progressions: [[0, 3, 0, 6], [0, 3, 6, 3], [0, 6, 3, 0]] },
  { id: 'major', label: 'Dur', steps: [0, 2, 4, 5, 7, 9, 11], progressions: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 3]] },
];

export const scaleOf = (id: ScaleName): Scale => SCALES.find((s) => s.id === id) ?? SCALES[0];

/** Pitch classes (0..11) of the key: what "in key" means. */
export function pitchClasses(root: number, scale: ScaleName): Set<number> {
  return new Set(scaleOf(scale).steps.map((s) => (((root + s) % 12) + 12) % 12));
}

/** The root as a pitch near `base`: keys above F# fold down an octave so lines stay in their register. */
export const rootPitch = (root: number, base: number) => base + (root > 6 ? root - 12 : root);

/** Pitch of a scale degree (any integer: 7 is the root an octave up, -1 the seventh below). */
export function degreePitch(scale: ScaleName, degree: number, rootAt: number): number {
  const steps = scaleOf(scale).steps;
  const octave = Math.floor(degree / 7);
  return rootAt + steps[((degree % 7) + 7) % 7] + 12 * octave;
}

export interface MelodyOpts {
  root: number;
  scale: ScaleName;
  bars: number;
  rand: () => number;
}

const STEP = 1 / 16;
const pick = <T,>(items: T[], rand: () => number): T => items[Math.floor(rand() * items.length) % items.length];
const note = (pitch: number, step: number, steps: number, velocity: number): Note => ({
  pitch: Math.max(0, Math.min(127, pitch)),
  start: step * STEP,
  length: steps * STEP,
  velocity: Math.round(Math.max(0.05, Math.min(1, velocity)) * 100) / 100,
});

/** Keep a phrase inside `bars` bars (dropping what starts after, cutting what runs over) and sorted. */
function fit(notes: Note[], bars: number): Note[] {
  return notes
    .filter((n) => n.start < bars - 1e-9)
    .map((n) => ({ ...n, length: Math.min(n.length, bars - n.start) }))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** Repeat a phrase of `phraseBars` bars to fill `bars` bars. */
function loop(phrase: Note[], phraseBars: number, bars: number): Note[] {
  const out: Note[] = [];
  for (let at = 0; at < bars - 1e-9; at += phraseBars) for (const n of phrase) out.push({ ...n, start: n.start + at });
  return fit(out, bars);
}

const progressionFor = (o: MelodyOpts) => pick(scaleOf(o.scale).progressions, o.rand);

// ---------------------------------------------------------------- Reese bass

type BassBar = { at: number; len: number; vel: number; to?: 'next' | 'octave' | 'fifth' }[];

/** Rhythm cells for one bar of bass (16ths): long notes, a pickup into the next chord, a gallop. */
const BASS_BARS: BassBar[] = [
  [{ at: 0, len: 16, vel: 1 }],
  [{ at: 0, len: 12, vel: 1 }, { at: 12, len: 4, vel: 0.85, to: 'next' }],
  [{ at: 0, len: 6, vel: 1 }, { at: 6, len: 6, vel: 0.8 }, { at: 12, len: 4, vel: 0.9, to: 'octave' }],
  [{ at: 0, len: 8, vel: 1 }, { at: 8, len: 4, vel: 0.8, to: 'fifth' }, { at: 12, len: 4, vel: 0.9 }],
];

/**
 * A reese bassline: long, legato notes on the roots of the chord progression (one chord per bar),
 * with pickups into the next chord and occasional octave or fifth jumps. Low register, built for
 * detuned saws with a slow filter.
 */
export function reeseLine(o: MelodyOpts): Note[] {
  const prog = progressionFor(o);
  const base = rootPitch(o.root, 36);
  const out: Note[] = [];
  for (let bar = 0; bar < o.bars; bar++) {
    const deg = prog[bar % 4];
    const next = prog[(bar + 1) % 4];
    const cell = bar % 4 === 0 ? pick([BASS_BARS[0], BASS_BARS[1], BASS_BARS[3]], o.rand) : bar % 4 === 3 ? pick([BASS_BARS[1], BASS_BARS[2]], o.rand) : pick(BASS_BARS, o.rand);
    for (const c of cell) {
      const d = c.to === 'next' ? next : c.to === 'fifth' ? deg + 4 : c.to === 'octave' ? deg + 7 : deg;
      out.push(note(degreePitch(o.scale, d, base), bar * 16 + c.at, c.len, c.vel));
    }
  }
  return fit(out, o.bars);
}

// ---------------------------------------------------------------- Trance lead

/** Rhythms of one bar as [start step, length in steps]: anthem, syncopated 3+3+2, long, gallop, off-beat. */
const LEAD_RHYTHMS: [number, number][][] = [
  [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]],
  [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
  [[0, 8], [8, 4], [12, 4]],
  [[0, 2], [2, 1], [3, 1], [4, 4], [8, 2], [10, 1], [11, 1], [12, 4]],
  [[2, 2], [6, 2], [10, 2], [14, 2]],
  [[0, 1], [1, 1], [2, 2], [4, 1], [5, 1], [6, 2], [8, 4], [12, 4]],
];

interface Cell {
  rhythm: [number, number][];
  /** Scale-degree offsets from the bar's anchor, one per note. */
  offsets: number[];
}

const LEAD_LOW = -2;
const LEAD_HIGH = 11;

function makeCell(rand: () => number): Cell {
  const rhythm = pick(LEAD_RHYTHMS, rand);
  const offsets = [0];
  for (let i = 1; i < rhythm.length; i++) offsets.push(offsets[i - 1] + pick([-2, -1, -1, 0, 0, 1, 1, 2], rand));
  return { rhythm, offsets };
}

/**
 * Same rhythm, at least two notes changed (and the last one always): the second phrase answers the
 * first instead of copying it, yet is recognisably the same idea.
 */
function varyCell(cell: Cell, rand: () => number): Cell {
  const last = cell.offsets.length - 1;
  const changed = new Set<number>([last]);
  while (changed.size < Math.min(3, cell.offsets.length - 1)) changed.add(1 + Math.floor(rand() * last));
  const offsets = cell.offsets.map((v, i) => (changed.has(i) && i > 0 ? v + pick([-2, -1, 1, 2], rand) : v));
  return { rhythm: cell.rhythm, offsets };
}

/** The chord tone (root, third, fifth, octave, ninth) nearest to `degree`. */
function nearestChordTone(degree: number, chord: number): number {
  const tones = [chord - 3, chord, chord + 2, chord + 4, chord + 7, chord + 9];
  return tones.reduce((best, t) => (Math.abs(t - degree) < Math.abs(best - degree) ? t : best), tones[0]);
}

const clampDegree = (d: number) => Math.max(LEAD_LOW, Math.min(LEAD_HIGH, d));

/** One bar of a lead: the cell's notes around `anchor`, strong beats (steps 0 and 8) snapped to chord tones. */
function leadBar(cell: Cell, anchor: number, chord: number, bar: number, mirror: boolean, o: MelodyOpts, base: number): Note[] {
  return cell.rhythm.map(([at, len], i) => {
    let degree = clampDegree(anchor + (mirror ? -cell.offsets[i] : cell.offsets[i]));
    if (at % 8 === 0 || i === 0) degree = clampDegree(nearestChordTone(degree, chord));
    const vel = at === 0 ? 0.95 : len >= 4 ? 0.88 : 0.76;
    return note(degreePitch(o.scale, degree, base), bar * 16 + at, len, vel);
  });
}

/** A closing bar: long notes walking down to `target` (a scale degree), so the phrase lands. */
function cadenceBar(target: number, bar: number, o: MelodyOpts, base: number): Note[] {
  const walk = [target + 2, target + 1, target];
  return [[0, 8], [8, 4], [12, 4]].map(([at, len], i) => note(degreePitch(o.scale, clampDegree(walk[i]), base), bar * 16 + at, len, i === 2 ? 0.85 : 0.9));
}

/**
 * A trance lead in two four-bar phrases (eight bars, looped to fill the clip): a motif in bar 1,
 * mirrored as the answer in bar 2, repeated over the next chord in bar 3, then a cadence. The first
 * phrase ends open on the fifth, the second one answers it and lands on the root.
 */
export function tranceLead(o: MelodyOpts): Note[] {
  const prog = progressionFor(o);
  const base = rootPitch(o.root, 60);
  const motif = makeCell(o.rand);
  const answer = varyCell(motif, o.rand);
  const anchors = [2, 4, 4]; // third, fifth, fifth above each bar's chord root: an arc
  const out: Note[] = [];
  const phrase = (cell: Cell, bar0: number, endOn: number) => {
    out.push(...leadBar(cell, prog[0] + anchors[0], prog[0], bar0, false, o, base));
    out.push(...leadBar(cell, prog[1] + anchors[1], prog[1], bar0 + 1, true, o, base));
    out.push(...leadBar(cell, prog[2] + anchors[2], prog[2], bar0 + 2, false, o, base));
    out.push(...cadenceBar(endOn, bar0 + 3, o, base));
  };
  phrase(motif, 0, 4);
  phrase(answer, 4, 0);
  return loop(out, 8, o.bars);
}

// ---------------------------------------------------------------- Hypnotic techno melody

/**
 * A minimal, hypnotic melody: a cell of three to five short notes on a few scale tones, repeated every
 * half bar with small changes (a note left out), moving up a step in the third bar.
 */
export function hypnoticLine(o: MelodyOpts): Note[] {
  const base = rootPitch(o.root, 60);
  const tones = pick([[0, 2, 4], [0, 3, 4], [0, 2, 3, 4], [0, 4, 6]], o.rand);
  const hits = 3 + Math.floor(o.rand() * 3);
  const positions = new Set<number>([0]);
  while (positions.size < hits) positions.add(Math.floor(o.rand() * 8));
  const cell = [...positions].sort((a, b) => a - b).map((at, i, all) => ({ at, len: (all[i + 1] ?? 8) - at >= 2 && o.rand() < 0.5 ? 2 : 1, tone: tones[Math.floor(o.rand() * tones.length)] }));
  cell[0].tone = tones[0];
  const out: Note[] = [];
  for (let bar = 0; bar < o.bars; bar++) {
    const lift = bar % 4 === 2 ? 1 : 0; // the third bar answers one step higher
    for (let half = 0; half < 2; half++) {
      cell.forEach((c, i) => {
        if (bar % 4 === 3 && half === 1 && i === cell.length - 1) return; // a gap before the loop restarts
        if (bar % 2 === 1 && half === 1 && i === 1 && o.rand() < 0.6) return; // variation by leaving a note out
        out.push(note(degreePitch(o.scale, c.tone + lift, base), bar * 16 + half * 8 + c.at, c.len, c.at === 0 ? 0.95 : 0.72));
      });
    }
  }
  return fit(out, o.bars);
}

// ---------------------------------------------------------------- Progressive arp

/** Index patterns over the four chord tones: up, up-down, skip, broken. */
const ARP_SHAPES = [[0, 1, 2, 3], [0, 1, 2, 1], [0, 2, 1, 3], [0, 3, 1, 2]];

/**
 * A 16th-note arpeggio over seventh chords of the progression: a shape per clip, accents on the beats,
 * a few steps gated out for groove, and an octave lift in the last beat of every second bar.
 */
export function progArp(o: MelodyOpts): Note[] {
  const prog = progressionFor(o);
  const shape = pick(ARP_SHAPES, o.rand);
  const base = rootPitch(o.root, 60);
  const out: Note[] = [];
  for (let bar = 0; bar < o.bars; bar++) {
    const d = prog[bar % 4];
    const tones = [d, d + 2, d + 4, d + 6];
    for (let i = 0; i < 16; i++) {
      const strong = i % 4 === 0;
      if (!strong && o.rand() < 0.15) continue;
      const lift = bar % 2 === 1 && i >= 12 ? 7 : 0;
      out.push(note(degreePitch(o.scale, tones[shape[i % 4]] + lift, base), bar * 16 + i, strong ? 2 : 1, strong ? 0.95 : 0.6 + 0.1 * (i % 2)));
    }
  }
  return fit(out, o.bars);
}

// ---------------------------------------------------------------- Pad chords

/** Seventh/ninth chords, one per bar (or per two bars), voiced wide: root low, the rest above. */
export function padChords(o: MelodyOpts): Note[] {
  const prog = progressionFor(o);
  const base = rootPitch(o.root, 60);
  const every = o.rand() < 0.5 ? 1 : 2;
  const out: Note[] = [];
  for (let bar = 0, i = 0; bar < o.bars; bar += every, i++) {
    const d = prog[i % 4];
    // A ninth only when it is a whole step above the root: a minor ninth rubs against the root.
    const wholeStepNinth = degreePitch(o.scale, d + 8, base) - degreePitch(o.scale, d, base) === 14;
    const tones = [d, d + 2, d + 4, d + 6, ...(i % 2 === 1 && wholeStepNinth ? [d + 8] : [])];
    const len = Math.min(every, o.bars - bar) * 16;
    out.push(note(degreePitch(o.scale, d - 7, base), bar * 16, len, 0.55));
    for (const t of tones) out.push(note(degreePitch(o.scale, t, base), bar * 16, len, 0.68));
  }
  return fit(out, o.bars);
}

// ---------------------------------------------------------------- Rave stabs

const STAB_RHYTHMS = [[0, 3, 6, 8, 11], [0, 3, 6, 10, 13], [2, 6, 10, 14], [0, 6, 8, 14], [3, 6, 11, 14]];

/** Short chord stabs on syncopated 16ths over the progression: triads plus the root an octave up. */
export function raveStabs(o: MelodyOpts): Note[] {
  const prog = progressionFor(o);
  const base = rootPitch(o.root, 60);
  const out: Note[] = [];
  let rhythm = pick(STAB_RHYTHMS, o.rand);
  for (let bar = 0; bar < o.bars; bar++) {
    if (bar % 2 === 0) rhythm = o.rand() < 0.7 ? rhythm : pick(STAB_RHYTHMS, o.rand);
    const d = prog[bar % 4];
    rhythm.forEach((at, i) => {
      for (const t of [d, d + 2, d + 4, d + 7]) out.push(note(degreePitch(o.scale, t, base), bar * 16 + at, 2, i === 0 ? 0.95 : 0.8));
    });
  }
  return fit(out, o.bars);
}
