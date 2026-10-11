import { ECHO_BEATS } from './devices';
import { LIMITER_RANGE, softLimit } from './fx';

// The numbers behind the devices: filter bands and their response, the compressor's gain computer, saturator
// curves, echo times. Pure, so the displays and the tests use exactly what the audio graph uses.

export type BiquadKind = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf';

export interface Band {
  kind: BiquadKind;
  freq: number;
  /** Lowpass/highpass: resonance in dB (Web Audio); bandpass/peaking: a plain Q. Ignored by shelves. */
  q: number;
  gainDb: number;
}

/** Biquad coefficients as in the Web Audio spec (shelves with slope 1), normalised so a0 = 1. */
export function biquadCoeffs(band: Band, sampleRate = 48000): { b: [number, number, number]; a: [number, number, number] } {
  const { kind, gainDb } = band;
  const w0 = (2 * Math.PI * Math.max(1, Math.min(band.freq, sampleRate / 2 - 1))) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  let b: [number, number, number];
  let a: [number, number, number];
  if (kind === 'lowpass' || kind === 'highpass' || kind === 'bandpass') {
    const q = kind === 'bandpass' ? Math.max(0.0001, band.q) : Math.pow(10, band.q / 20);
    const alpha = sin / (2 * q);
    if (kind === 'lowpass') b = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    else if (kind === 'highpass') b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    else b = [alpha, 0, -alpha];
    a = [1 + alpha, -2 * cos, 1 - alpha];
  } else if (kind === 'peaking') {
    const alpha = sin / (2 * Math.max(0.0001, band.q));
    b = [1 + alpha * A, -2 * cos, 1 - alpha * A];
    a = [1 + alpha / A, -2 * cos, 1 - alpha / A];
  } else {
    const k = 2 * Math.sqrt(A) * (sin / 2) * Math.SQRT2;
    if (kind === 'lowshelf') {
      b = [A * (A + 1 - (A - 1) * cos + k), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - k)];
      a = [A + 1 + (A - 1) * cos + k, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - k];
    } else {
      b = [A * (A + 1 + (A - 1) * cos + k), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - k)];
      a = [A + 1 - (A - 1) * cos + k, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - k];
    }
  }
  return { b: [b[0] / a[0], b[1] / a[0], b[2] / a[0]], a: [1, a[1] / a[0], a[2] / a[0]] };
}

/** Magnitude in dB of one band at `freqs` Hz. */
export function bandResponse(band: Band, freqs: number[], sampleRate = 48000): number[] {
  const { b, a } = biquadCoeffs(band, sampleRate);
  return freqs.map((f) => {
    const w = (2 * Math.PI * f) / sampleRate;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    // |B(e^jw)| / |A(e^jw)| with e^-jw = cos w - j sin w
    const nr = b[0] + b[1] * c1 + b[2] * c2, ni = -(b[1] * s1 + b[2] * s2);
    const dr = a[0] + a[1] * c1 + a[2] * c2, di = -(a[1] * s1 + a[2] * s2);
    return 20 * Math.log10(Math.max(1e-6, Math.hypot(nr, ni) / Math.max(1e-12, Math.hypot(dr, di))));
  });
}

/** Bands in series multiply, so their dB responses add. */
export function cascadeResponse(bands: Band[], freqs: number[], sampleRate = 48000): number[] {
  const total = freqs.map(() => 0);
  for (const band of bands) bandResponse(band, freqs, sampleRate).forEach((db, i) => (total[i] += db));
  return total;
}

// ---------------------------------------------------------------- EQ

/** Butterworth: a flat second-order lowpass/highpass has a Q of 1/sqrt(2), i.e. -3.01 dB. */
export const BUTTERWORTH_DB = -3.0103;
const HP_OFF = 5;
const LP_OFF = 30000; // above Nyquist: the node clamps it there, where a lowpass is flat

/** The six filters of the EQ in series order (low cut, bass shelf, two bells, treble shelf, high cut); neutral ones are parked. */
export function eqBands(p: Record<string, number>): Band[] {
  return [
    { kind: 'highpass', freq: p.hp <= 20.5 ? HP_OFF : p.hp, q: BUTTERWORTH_DB, gainDb: 0 },
    { kind: 'lowshelf', freq: p.lsF, q: 0, gainDb: p.lsG },
    { kind: 'peaking', freq: p.p1F, q: p.p1Q, gainDb: p.p1G },
    { kind: 'peaking', freq: p.p2F, q: p.p2Q, gainDb: p.p2G },
    { kind: 'highshelf', freq: p.hsF, q: 0, gainDb: p.hsG },
    { kind: 'lowpass', freq: p.lp >= 19999 ? LP_OFF : p.lp, q: BUTTERWORTH_DB, gainDb: 0 },
  ];
}

// ---------------------------------------------------------------- compressor

export interface CompOpts {
  threshold: number;
  ratio: number;
  knee: number;
}

/** Gain change in dB (zero or negative) for an input level in dB: the classic soft-knee gain computer. */
export function compGainDb(levelDb: number, { threshold, ratio, knee }: CompOpts): number {
  const slope = 1 / Math.max(1, ratio) - 1;
  const over = levelDb - threshold;
  if (knee <= 0 || 2 * Math.abs(over) > knee) return over > 0 ? slope * over : 0;
  return (slope * (over + knee / 2) ** 2) / (2 * knee);
}

/** The detector's peak loop runs through a delay of one render block. */
export const PEAK_LOOP_SAMPLES = 128;

/** Factor the held peak shrinks by per pass of the loop so that it falls with the time constant `releaseMs`. */
export const peakDecay = (releaseMs: number, sampleRate: number) => Math.exp(-(PEAK_LOOP_SAMPLES / sampleRate) / (Math.max(1, releaseMs) / 1000));

/**
 * WaveShaper curve of the compressor: input x in [-1, 1] is the detector's level in linear amplitude (1 = 0 dBFS;
 * only the magnitude counts), output the linear gain to apply.
 */
export function compCurve(opts: CompOpts, points = 4097): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const level = Math.abs((i / (points - 1)) * 2 - 1);
    const db = 20 * Math.log10(Math.max(level, 1e-5));
    curve[i] = Math.pow(10, compGainDb(db, opts) / 20);
  }
  return curve;
}

/** Cutoff in Hz of the attack lowpass: a second-order filter rises about twice as slowly as a one-pole one of the same cutoff, so this is tuned to land near the knob value (measured 63 % rise time). */
export const followerCutoff = (ms: number) => 1000 / (Math.PI * Math.max(0.05, ms));

// ---------------------------------------------------------------- saturator

/** Saturator input range: the curve covers signals up to this many times full scale after the drive. */
export const SAT_RANGE = 16;

/** One shaping function: `x` is the driven signal (1 = full scale before shaping). */
export function saturate(x: number, mode: number): number {
  switch (Math.round(mode)) {
    case 1:
      return Math.max(-1, Math.min(1, x));
    case 2:
      return Math.sin((x * Math.PI) / 2); // folds back instead of clipping
    case 3: {
      // Asymmetric: even harmonics, like a tube stage. Normalised to a slope of one at the origin.
      const bias = 0.35;
      return (Math.tanh(x + bias) - Math.tanh(bias)) / (1 - Math.tanh(bias) ** 2);
    }
    default:
      return Math.tanh(x);
  }
}

/** WaveShaper curve over [-SAT_RANGE, SAT_RANGE] (the node's input is pre-scaled by drive / SAT_RANGE). */
export function satCurve(mode: number, points = 8193): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = ((i / (points - 1)) * 2 - 1) * SAT_RANGE;
    curve[i] = Math.max(-1.6, Math.min(1.6, saturate(x, mode)));
  }
  return curve;
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** Gain in front of the saturator's WaveShaper: the drive, scaled to the curve's input range. */
export const satPreGain = (driveDb: number) => dbToGain(driveDb) / SAT_RANGE;

// ---------------------------------------------------------------- time based

/** Echo delay in seconds: free in ms, or a note length at the project tempo. */
export function echoSeconds(p: { sync: number; division: number; time: number }, bpm: number): number {
  const seconds = p.sync >= 0.5 ? (ECHO_BEATS[Math.max(0, Math.min(ECHO_BEATS.length - 1, Math.round(p.division)))] * 60) / Math.max(20, bpm) : p.time / 1000;
  return Math.max(0.01, Math.min(3.5, seconds));
}

/** Chorus sweep: how far (in seconds) the delay time swings either way. */
export const chorusSwing = (depth: number, delayMs: number) => Math.min(delayMs / 1000 - 0.0005, 0.0005 + depth * 0.006);

/** The limiter's WaveShaper sees the signal at `gain / LIMITER_RANGE`; its output is scaled to the ceiling. */
export const limiterGains = (gainDb: number, ceilingDb: number) => ({ pre: dbToGain(gainDb) / LIMITER_RANGE, post: dbToGain(ceilingDb) });

/** Level out of the limiter for a given input amplitude (what the node chain computes). */
export const limitedLevel = (amplitude: number, gainDb: number, ceilingDb: number) => {
  const { post } = limiterGains(gainDb, ceilingDb);
  return softLimit(amplitude * dbToGain(gainDb)) * post;
};

/** Q for the Filter device's biquad: dB resonance for low/high pass, a plain Q for band pass. */
export const filterDeviceQ = (type: number, res: number) => (Math.round(type) === 2 ? 0.5 + res * 0.6 : res);
export const FILTER_KINDS: BiquadKind[] = ['lowpass', 'highpass', 'bandpass'];
