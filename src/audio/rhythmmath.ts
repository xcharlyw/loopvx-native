// Pure maths of the tempo-synced and dynamic effects: Kickstart (duck on every beat, Nicky Romero style), the
// ShaperBox-style shaper (LFO shapes on volume, filter and pan) and the transient shaper's gain law.

export const KICKSTART_CURVES = ['Classic', 'Snappy', 'Smooth', 'Lang', 'Hold', 'Pump', 'Gate', 'Weich'];
export const RHYTHM_RATES = ['1/16', '1/8', '1/4', '1/2', '1 Takt', '2 Takte'];
/** Cycle length of each rate in bars (4/4). */
export const RATE_BARS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2];
export const SHAPER_TARGETS = ['Volume', 'Filter', 'Pan'];
export const SHAPER_SHAPES = ['Saw ab', 'Saw auf', 'Sinus', 'Dreieck', 'Square', 'Gate 1/16', 'Trance-Gate', 'Offbeat'];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Recovery of a Kickstart curve at phase t (0..1 of a cycle): 0 = fully ducked, 1 = full level. */
export function kickstartShape(curve: number, t: number): number {
  const x = clamp01(t);
  switch (Math.round(curve)) {
    case 0: // Classic: quick duck, smooth exponential swell
      return 1 - Math.exp(-x / 0.18);
    case 1: // Snappy
      return 1 - Math.exp(-x / 0.08);
    case 2: // Smooth: raised cosine over 70 %
      return x >= 0.7 ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * x) / 0.7);
    case 3: // Lang: linear over the whole beat
      return x;
    case 4: // Hold: stays down for 15 %, then swells
      return x < 0.15 ? 0 : 1 - Math.exp(-(x - 0.15) / 0.15);
    case 5: // Pump: square-law swell
      return Math.min(1, Math.pow(x / 0.85, 2));
    case 6: // Gate: off for a quarter, then on (with a short fade)
      return x < 0.25 ? 0 : Math.min(1, (x - 0.25) / 0.03);
    default: // Weich: logarithmic, opens fast and settles slowly
      return Math.log1p(9 * Math.min(1, x / 0.8)) / Math.log(10);
  }
}

/** Gain over one cycle: 1 - mix * (1 - shape). `points` values for `setValueCurveAtTime`. */
export function kickstartCurve(curve: number, mix: number, points = 96): Float32Array<ArrayBuffer> {
  const m = clamp01(mix);
  const out = new Float32Array(points);
  for (let i = 0; i < points; i++) out[i] = 1 - m * (1 - kickstartShape(curve, i / (points - 1)));
  return out;
}

const FADE = 0.03; // gate edges, fraction of a step

/** Value of a shaper shape at phase t (0..1): 0..1. Gates soften their edges so they never click. */
export function shaperShape(shape: number, t: number): number {
  const x = ((t % 1) + 1) % 1;
  const gate = (steps: boolean[]) => {
    const n = steps.length;
    const pos = x * n;
    const i = Math.min(n - 1, Math.floor(pos));
    const frac = pos - i;
    if (!steps[i]) return 0;
    const inFade = steps[(i - 1 + n) % n] ? 1 : Math.min(1, frac / FADE);
    const outFade = steps[(i + 1) % n] ? 1 : Math.min(1, (1 - frac) / FADE);
    return Math.min(inFade, outFade);
  };
  switch (Math.round(shape)) {
    case 0:
      return 1 - x;
    case 1:
      return x;
    case 2:
      return 0.5 + 0.5 * Math.cos(2 * Math.PI * x);
    case 3:
      return 1 - Math.abs(2 * x - 1);
    case 4:
      return gate([true, false]);
    case 5:
      return gate(Array.from({ length: 16 }, (_, i) => i % 2 === 0));
    case 6:
      return gate([1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1].map(Boolean));
    default:
      return gate(Array.from({ length: 8 }, (_, i) => i % 2 === 1));
  }
}

/** What a shaper does to its target: values for one cycle, in the target's own unit (gain, Hz or pan). */
export function shaperCurve(p: { target: number; shape: number; depth: number; cutoff: number }, points = 128): Float32Array<ArrayBuffer> {
  const d = clamp01(p.depth);
  const out = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const v = shaperShape(p.shape, i / points);
    const target = Math.round(p.target);
    out[i] = target === 1 ? Math.max(30, p.cutoff * Math.pow(2, -7 * d * (1 - v))) : target === 2 ? d * (2 * v - 1) : 1 - d * (1 - v);
  }
  return out;
}

/** Cycle start bars inside [fromBar, toBar) for a rate in bars, on the grid of the arrangement. */
export function cycleStarts(fromBar: number, toBar: number, rateBars: number): number[] {
  const out: number[] = [];
  const first = Math.ceil(fromBar / rateBars - 1e-9) * rateBars;
  for (let b = first; b < toBar - 1e-9; b += rateBars) out.push(Math.round(b * 1e9) / 1e9 + 0); // + 0 turns -0 into 0
  return out;
}

/** dB range the transient shaper's log detectors map to the waveshaper's -1..0. */
export const TRANSIENT_RANGE_DB = 72;

/**
 * Gain in dB the transient shaper applies for a detector difference `diffDb` (fast envelope minus slow envelope):
 * positive at an attack, negative in the decay. `attack`/`sustain` in -100..100 %; at most ±12 dB.
 */
export function transientGainDb(diffDb: number, attack: number, sustain: number): number {
  const amount = diffDb >= 0 ? attack : sustain;
  return (amount / 100) * Math.min(12, Math.abs(diffDb) * 0.75);
}

/** Curve of the log detector: input amplitude x in [-1, 1] -> dB / TRANSIENT_RANGE_DB in [-1, 0]. */
export function logCurve(points = 8193): Float32Array<ArrayBuffer> {
  const out = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const a = Math.abs((i / (points - 1)) * 2 - 1);
    out[i] = Math.max(-TRANSIENT_RANGE_DB, 20 * Math.log10(Math.max(a, 1e-6))) / TRANSIENT_RANGE_DB;
  }
  return out;
}

/** Curve from the detector difference (x = diffDb / TRANSIENT_RANGE_DB in [-1, 1]) to the linear gain to apply. */
export function transientCurve(attack: number, sustain: number, points = 2049): Float32Array<ArrayBuffer> {
  const out = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const diffDb = ((i / (points - 1)) * 2 - 1) * TRANSIENT_RANGE_DB;
    out[i] = Math.pow(10, transientGainDb(diffDb, attack, sustain) / 20);
  }
  return out;
}
