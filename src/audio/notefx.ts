import type { ArpSettings, Note, SeqSettings, SeqStep } from '../types';

// MIDI effects of a track, as pure functions on notes (positions and lengths in bars, relative to the clip): the
// arpeggiator turns the notes held at each step into a run, the step sequencer plays a pattern on every held note.
// The engine runs them on a clip's notes right before scheduling, so live playback and export sound the same.

const EPS = 1e-6;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const SEQ_STEPS = 16;
export const ARP_RATES = [8, 12, 16, 24, 32];
export const rateLabel = (r: number) => (r === 8 ? '1/8' : r === 12 ? '1/8T' : r === 16 ? '1/16' : r === 24 ? '1/16T' : r === 32 ? '1/32' : `${r}/Takt`);

export const DEFAULT_ARP: ArpSettings = { on: false, pattern: 'up', rate: 16, octaves: 1, gate: 0.6, swing: 0 };
export const emptySteps = (): SeqStep[] => Array.from({ length: SEQ_STEPS }, () => ({ on: false, semi: 0 }));
export const DEFAULT_SEQ: SeqSettings = { on: false, rate: 16, length: 16, steps: emptySteps().map((s, i) => ({ ...s, on: i % 4 === 0 })), gate: 0.6, swing: 0 };

/** Deterministic pseudo random number in [0, 1) for the random pattern. */
function hash01(n: number): number {
  let a = (Math.imul(n + 1, 2654435761) ^ 0x9e3779b9) >>> 0;
  a = Math.imul(a ^ (a >>> 15), 2246822519) >>> 0;
  a = Math.imul(a ^ (a >>> 13), 3266489917) >>> 0;
  return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
}

const heldAt = (notes: Note[], t: number) => notes.filter((n) => n.start <= t + EPS && n.start + n.length > t + EPS);

/** Time of step `k`: the grid, with every second step delayed by `swing` of a step. */
const stepTime = (k: number, rate: number, swing: number) => k / rate + (k % 2 === 1 ? clamp(swing, 0, 0.5) / rate : 0);

/** The pitches an arp run walks through for a held chord, with the velocity each came from. */
function runOf(held: Note[], pattern: ArpSettings['pattern'], octaves: number): { pitch: number; velocity: number }[] {
  const byPitch = new Map<number, number>();
  for (const n of held) byPitch.set(n.pitch, Math.max(byPitch.get(n.pitch) ?? 0, n.velocity));
  const order = pattern === 'played' ? [...new Set([...held].sort((a, b) => a.start - b.start).map((n) => n.pitch))] : [...byPitch.keys()].sort((a, b) => a - b);
  const up: { pitch: number; velocity: number }[] = [];
  for (let o = 0; o < clamp(Math.round(octaves), 1, 4); o++) for (const p of order) up.push({ pitch: p + 12 * o, velocity: byPitch.get(p)! });
  if (pattern === 'down') return up.reverse();
  if (pattern === 'updown') return up.length > 2 ? [...up, ...up.slice(1, -1).reverse()] : up;
  return up;
}

/** The arpeggiator: at every step the held notes become one note of the run (or the whole chord for 'chord'). */
export function arpNotes(notes: Note[], arp: ArpSettings, clipLength: number): Note[] {
  const rate = Math.max(1, arp.rate);
  const gate = clamp(arp.gate, 0.05, 1) / rate;
  const out: Note[] = [];
  let counter = 0;
  let lastGrid = -Infinity;
  for (let k = 0; k / rate < clipLength - EPS; k++) {
    const grid = k / rate;
    const held = heldAt(notes, grid);
    if (!held.length) {
      lastGrid = grid;
      counter = 0;
      continue;
    }
    // a note that began since the last step starts the run again from its first note
    counter = held.some((n) => n.start > lastGrid + EPS) || lastGrid === -Infinity ? 0 : counter + 1;
    lastGrid = grid;
    const start = stepTime(k, rate, arp.swing);
    if (arp.pattern === 'chord') {
      for (const n of held) out.push({ pitch: n.pitch, start, length: gate, velocity: n.velocity });
      continue;
    }
    const run = runOf(held, arp.pattern, arp.octaves);
    const pick = arp.pattern === 'random' ? run[Math.floor(hash01(k) * run.length)] : run[counter % run.length];
    out.push({ pitch: pick.pitch, start, length: gate, velocity: pick.velocity });
  }
  return out;
}

/** The step sequencer: step `k mod length` of the pattern plays on every note held at that step, shifted by the step's semitones. */
export function seqNotes(notes: Note[], seq: SeqSettings, clipLength: number): Note[] {
  const rate = Math.max(1, seq.rate);
  const length = clamp(Math.round(seq.length), 1, SEQ_STEPS);
  const gate = clamp(seq.gate, 0.05, 1) / rate;
  const out: Note[] = [];
  for (let k = 0; k / rate < clipLength - EPS; k++) {
    const step = seq.steps[k % length];
    if (!step?.on) continue;
    const start = stepTime(k, rate, seq.swing);
    for (const n of heldAt(notes, k / rate)) out.push({ pitch: clamp(n.pitch + step.semi, 0, 127), start, length: gate, velocity: clamp(n.velocity * (step.accent ? 1 : 0.7), 0.05, 1) });
  }
  return out;
}

const cache = new WeakMap<Note[], { arp?: ArpSettings; seq?: SeqSettings; clipLength: number; out: Note[] }>();

/** A track's MIDI effects applied to a clip's notes: sequencer first, then arpeggiator. The result is cached per notes array. */
export function applyNoteFx(notes: Note[], fx: { arp?: ArpSettings; seq?: SeqSettings }, clipLength: number): Note[] {
  const seq = fx.seq?.on ? fx.seq : undefined;
  const arp = fx.arp?.on ? fx.arp : undefined;
  if (!seq && !arp) return notes;
  const hit = cache.get(notes);
  if (hit && hit.arp === arp && hit.seq === seq && hit.clipLength === clipLength) return hit.out;
  let out = notes;
  if (seq) out = seqNotes(out, seq, clipLength);
  if (arp) out = arpNotes(out, arp, clipLength);
  cache.set(notes, { arp, seq, clipLength, out });
  return out;
}
