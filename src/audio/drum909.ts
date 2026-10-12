// A 909-style drum machine as an instrument: every pad is a recipe of oscillators, filtered noise and "metal" (six
// detuned squares for the cymbals). Pure data and maths, so the engine, the pad display and the tests share it.
// Pads sit on the usual drum-rack notes (C1 = 36, GM names), so a .mid drum pattern plays on it as it is.

export type PadId = 'kick' | 'rim' | 'snare' | 'clap' | 'tomLow' | 'hatClosed' | 'tomMid' | 'hatOpen' | 'tomHigh' | 'crash' | 'ride' | 'cowbell';

export interface Pad {
  id: PadId;
  pitch: number;
  name: string;
  /** Short label for the pad and the piano roll row. */
  short: string;
}

/** Laid out like a drum rack, left to right and bottom to top: kick, rim, snare, clap / toms / hats / cymbals. */
export const KIT_PADS: Pad[] = [
  { id: 'kick', pitch: 36, name: 'Kick', short: 'KICK' },
  { id: 'rim', pitch: 37, name: 'Rimshot', short: 'RIM' },
  { id: 'snare', pitch: 38, name: 'Snare', short: 'SNARE' },
  { id: 'clap', pitch: 39, name: 'Clap', short: 'CLAP' },
  { id: 'tomLow', pitch: 41, name: 'Tom tief', short: 'TOM L' },
  { id: 'hatClosed', pitch: 42, name: 'Hi-Hat zu', short: 'HH ZU' },
  { id: 'tomMid', pitch: 45, name: 'Tom mittel', short: 'TOM M' },
  { id: 'hatOpen', pitch: 46, name: 'Hi-Hat offen', short: 'HH AUF' },
  { id: 'tomHigh', pitch: 48, name: 'Tom hoch', short: 'TOM H' },
  { id: 'crash', pitch: 49, name: 'Crash', short: 'CRASH' },
  { id: 'ride', pitch: 51, name: 'Ride', short: 'RIDE' },
  { id: 'cowbell', pitch: 56, name: 'Cowbell', short: 'BELL' },
];

const BY_PITCH = new Map(KIT_PADS.map((p) => [p.pitch, p]));
export const padAt = (pitch: number): Pad | undefined => BY_PITCH.get(pitch);
export const padById = (id: PadId): Pad => KIT_PADS.find((p) => p.id === id)!;

/** A closed hat cuts an open one, like on the real machine. */
export const chokes = (hit: PadId, ringing: PadId): boolean => hit === 'hatClosed' && ringing === 'hatOpen';

/** One layer of a drum sound. All times in seconds, gains are linear before the pad level. */
export type Part =
  | { kind: 'osc'; type: 'sine' | 'triangle' | 'square'; from: number; to: number; sweep: number; gain: number; decay: number; delay?: number }
  | { kind: 'noise'; filter: 'highpass' | 'bandpass' | 'lowpass'; freq: number; q: number; gain: number; decay: number; delay?: number }
  /** Six square oscillators through a highpass (the 909's cymbal circuit); `ratios` scale `base`. */
  | { kind: 'metal'; base: number; ratios: number[]; hp: number; bp?: number; gain: number; decay: number };

export interface DrumPlan {
  parts: Part[];
  /** When the whole sound has died away, seconds after the hit. */
  length: number;
}

export interface KitOpts {
  /** Cents; shifts every pitched part and the metal. */
  tune?: number;
  /** Multiplies every decay (0.5 tight, 2 long). */
  decay?: number;
}

/** The classic cymbal frequencies, as ratios of the lowest. */
const METAL_RATIOS = [1, 1.4471, 1.617, 1.9265, 2.5028, 2.6637];
const METAL_BASE = 205.3;

const RECIPES: Record<PadId, Part[]> = {
  kick: [
    { kind: 'osc', type: 'sine', from: 190, to: 48, sweep: 0.07, gain: 1, decay: 0.38 },
    { kind: 'osc', type: 'triangle', from: 320, to: 90, sweep: 0.02, gain: 0.35, decay: 0.05 },
    { kind: 'noise', filter: 'highpass', freq: 3500, q: 0.7, gain: 0.22, decay: 0.012 },
  ],
  rim: [
    { kind: 'osc', type: 'triangle', from: 1100, to: 800, sweep: 0.01, gain: 0.6, decay: 0.03 },
    { kind: 'osc', type: 'square', from: 480, to: 440, sweep: 0.01, gain: 0.25, decay: 0.02 },
    { kind: 'noise', filter: 'bandpass', freq: 2800, q: 1.2, gain: 0.35, decay: 0.03 },
  ],
  snare: [
    { kind: 'osc', type: 'triangle', from: 330, to: 185, sweep: 0.03, gain: 0.7, decay: 0.11 },
    { kind: 'osc', type: 'triangle', from: 220, to: 160, sweep: 0.03, gain: 0.45, decay: 0.09 },
    { kind: 'noise', filter: 'highpass', freq: 1800, q: 0.6, gain: 0.85, decay: 0.19 },
  ],
  clap: [
    { kind: 'noise', filter: 'bandpass', freq: 1150, q: 1.1, gain: 2, decay: 0.01, delay: 0 },
    { kind: 'noise', filter: 'bandpass', freq: 1150, q: 1.1, gain: 2, decay: 0.01, delay: 0.011 },
    { kind: 'noise', filter: 'bandpass', freq: 1150, q: 1.1, gain: 2, decay: 0.01, delay: 0.022 },
    { kind: 'noise', filter: 'bandpass', freq: 1150, q: 1.1, gain: 2.3, decay: 0.2, delay: 0.033 },
  ],
  tomLow: [{ kind: 'osc', type: 'sine', from: 135, to: 100, sweep: 0.08, gain: 1, decay: 0.32 }],
  tomMid: [{ kind: 'osc', type: 'sine', from: 190, to: 145, sweep: 0.07, gain: 1, decay: 0.27 }],
  tomHigh: [{ kind: 'osc', type: 'sine', from: 270, to: 205, sweep: 0.06, gain: 1, decay: 0.22 }],
  hatClosed: [{ kind: 'metal', base: METAL_BASE, ratios: METAL_RATIOS, hp: 7200, gain: 5.5, decay: 0.045 }],
  hatOpen: [{ kind: 'metal', base: METAL_BASE, ratios: METAL_RATIOS, hp: 6800, gain: 2.6, decay: 0.55 }],
  crash: [{ kind: 'metal', base: METAL_BASE * 1.05, ratios: METAL_RATIOS, hp: 5200, gain: 2.2, decay: 1.4 }],
  ride: [{ kind: 'metal', base: METAL_BASE * 1.2, ratios: METAL_RATIOS, hp: 6000, bp: 9000, gain: 3.2, decay: 0.7 }],
  cowbell: [
    { kind: 'osc', type: 'square', from: 540, to: 540, sweep: 0.001, gain: 0.5, decay: 0.16 },
    { kind: 'osc', type: 'square', from: 800, to: 800, sweep: 0.001, gain: 0.5, decay: 0.16 },
  ],
};

const cents = (c: number) => Math.pow(2, c / 1200);

/** The recipe of one hit: the pad's parts with the kit's tuning and decay applied; undefined for a note without a pad. */
export function planHit(pitch: number, opts: KitOpts = {}): DrumPlan | undefined {
  const pad = padAt(pitch);
  if (!pad) return undefined;
  const tune = cents(opts.tune ?? 0);
  const decay = Math.max(0.2, Math.min(3, opts.decay ?? 1));
  const parts = RECIPES[pad.id].map((p): Part => {
    if (p.kind === 'osc') return { ...p, from: p.from * tune, to: p.to * tune, decay: p.decay * decay };
    if (p.kind === 'noise') return { ...p, decay: p.decay * decay };
    return { ...p, base: p.base * tune, decay: p.decay * decay };
  });
  const length = Math.max(...parts.map((p) => ('delay' in p ? p.delay ?? 0 : 0) + p.decay * 4));
  return { parts, length };
}

/** Exponential decay floor: a part's gain falls from its level to this over `decay`, then is cut. */
export const DECAY_FLOOR = 0.001;
