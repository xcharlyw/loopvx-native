import type { OscWave, SynthSettings } from '../types';
import { bandResponse } from './devicemath';
import { adsrPoints } from './synth';

// The numbers behind the synth's displays: oscillator shapes, the filter's real frequency response and the
// envelope curve. Pure functions, so the pictures can be tested against what the engine really does.

/** One cycle of an oscillator shape, `n` points in -1..1, shifted by `phase` (0..1 of a cycle). */
export function waveShape(wave: OscWave, n = 96, phase = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (((i / n + phase) % 1) + 1) % 1;
    out.push(wave === 'sine' ? Math.sin(2 * Math.PI * t) : wave === 'square' ? (t < 0.5 ? 1 : -1) : wave === 'sawtooth' ? 2 * t - 1 : 1 - 4 * Math.abs(t - 0.5));
  }
  return out;
}

export type FilterKind = NonNullable<SynthSettings['filterType']>;

/**
 * Magnitude response in dB of the Web Audio biquad (lowpass, highpass, bandpass) at `freqs` Hz. As in the
 * Web Audio spec, the resonance of lowpass and highpass is in dB (linear Q = 10^(dB/20)); for bandpass it
 * is a plain Q.
 */
export function filterResponse(type: FilterKind, cutoff: number, resonance: number, freqs: number[], sampleRate = 48000): number[] {
  return bandResponse({ kind: type, freq: cutoff, q: resonance, gainDb: 0 }, freqs, sampleRate);
}

/** `n` frequencies from 20 Hz to 20 kHz, evenly spaced on a log axis (what the display plots). */
export const logFreqs = (n = 96, lo = 20, hi = 20000) => Array.from({ length: n }, (_, i) => lo * Math.pow(hi / lo, i / (n - 1)));

/** Where a frequency sits on that axis, 0..1. */
export const freqToX = (f: number, lo = 20, hi = 20000) => Math.log(Math.max(lo, Math.min(hi, f)) / lo) / Math.log(hi / lo);

/**
 * The amplitude envelope for the display: a note held for `hold` seconds, then released. Time on the x axis is
 * returned as `t` seconds, level 0..1; `total` is the end of the release.
 */
export function envelopeCurve(s: Pick<SynthSettings, 'attack' | 'decay' | 'sustain' | 'release'>, hold: number): { points: { t: number; v: number }[]; total: number; holdAt: number } {
  const pts = adsrPoints(s, 1, hold);
  const points = [{ t: 0, v: 0 }, ...pts];
  // Keep the sustain plateau visible as a horizontal run until the key is released.
  return { points, total: pts[pts.length - 1].t, holdAt: hold };
}

/** The filter envelope for the display: from `start` Hz back to `cutoff` Hz over `decay` seconds, as 0..1 heights on the log axis. */
export function filterEnvelopeCurve(cutoff: number, octaves: number, decay: number, points = 32): { t: number; x: number }[] {
  const start = Math.min(20000, cutoff * Math.pow(2, Math.max(0, octaves)));
  return Array.from({ length: points }, (_, i) => {
    const t = (i / (points - 1)) * decay;
    // exponential approach, as the engine's exponentialRamp does
    const f = start * Math.pow(cutoff / start, t / decay);
    return { t, x: freqToX(f) };
  });
}

/** `cycles` cycles of the LFO's sine as -1..1 over `n` points, for the display. */
export const lfoShape = (n = 96, cycles = 1) => Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * cycles * i) / n));

/**
 * What the LFO scope shows: a window of whole bars long enough for at least one full cycle (a slow LFO of a
 * quarter cycle per bar needs four bars), and how many cycles fit in it.
 */
export function lfoWindow(rate: number): { bars: number; cycles: number } {
  const r = Math.max(0.0625, rate || 1);
  const bars = Math.max(1, Math.min(8, Math.ceil(1 / r - 1e-9)));
  return { bars, cycles: r * bars };
}
