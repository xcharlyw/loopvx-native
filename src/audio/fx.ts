import type { TrackFx } from '../types';

// Track effects, the math only (the engine builds the nodes):
//   input -> highpass -> lowpass -> drive (dry + shaped) -> pan -> fader -> master
//                                                                    \-> reverb send, delay send
// Sends are post-fader, so mute and solo silence them too.

const LOG_MIN_HP = Math.log(20);
const LOG_MAX_HP = Math.log(8000);
const LOG_MIN_LP = Math.log(80);
const LOG_MAX_LP = Math.log(20000);

/**
 * Ableton-style DJ filter on one knob: below 0 a lowpass closes towards 80 Hz, above 0 a highpass
 * opens up to 8 kHz, 0 leaves the sound untouched (both filters parked outside the audible range).
 */
export function djFilter(v: number): { lowpass: number; highpass: number } {
  const x = Math.max(-1, Math.min(1, v || 0));
  if (x < 0) return { lowpass: Math.exp(LOG_MAX_LP + (LOG_MIN_LP - LOG_MAX_LP) * -x), highpass: 10 };
  if (x > 0) return { lowpass: 22000, highpass: Math.exp(LOG_MIN_HP + (LOG_MAX_HP - LOG_MIN_HP) * x) };
  return { lowpass: 22000, highpass: 10 };
}

/**
 * Parallel distortion: the dry signal fades out while a hard-driven copy fades in. `pre` pushes the
 * shaper into clipping; `wet` brings the clipped copy back to roughly the dry level.
 */
export function driveGains(amount: number): { dry: number; pre: number; wet: number } {
  const d = Math.max(0, Math.min(1, amount || 0));
  return { dry: 1 - d, pre: 1 + 24 * d * d + 2 * d, wet: 0.22 * d };
}

/** Soft-clipping transfer curve over [-1, 1] (inputs beyond are clamped by the shaper: hard clip). */
export function driveCurve(points = 2048): Float32Array {
  const curve = new Float32Array(points);
  const k = 2.5;
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

/**
 * A stereo room impulse: decaying noise, slightly different per channel for width, with the
 * high end dying faster than the lows (one-pole smoothing that grows over the tail).
 */
export function reverbImpulse(sampleRate: number, seconds = 2.4, seed = 1): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const length = Math.max(1, Math.round(sampleRate * seconds));
  let a = seed >>> 0;
  const rand = () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
  const make = () => {
    const out = new Float32Array(length);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const noise = rand() * 2 - 1;
      const damp = 0.15 + 0.8 * t; // more smoothing (darker) towards the end
      smooth += (noise - smooth) * (1 - damp);
      out[i] = smooth * Math.pow(1 - t, 3.2) * 0.6;
    }
    return out;
  };
  return [make(), make()];
}

/** Dotted eighth at the project tempo: the classic techno delay. */
export const delaySeconds = (bpm: number) => (60 / Math.max(20, bpm)) * 0.75;

export const DELAY_FEEDBACK = 0.38;

/** Effect settings with defaults filled in. */
export const trackFx = (fx: TrackFx | undefined): Required<TrackFx> => ({ filter: 0, drive: 0, reverb: 0, delay: 0, pan: 0, pump: 0, ...fx });

/** True when a track uses no effect at all. */
export const fxIsDefault = (fx: TrackFx | undefined) => {
  const f = trackFx(fx);
  return !f.filter && !f.drive && !f.reverb && !f.delay && !f.pan && !f.pump;
};

export type GainEvent = { kind: 'set'; t: number; v: number } | { kind: 'ramp'; t: number; v: number } | { kind: 'target'; t: number; v: number; tau: number };

/**
 * Gain automation for one pump on a beat at `when`: duck within 5 ms (no click), then swell back
 * with a time constant of a fifth of a beat (95 % back after ~0.6 beats, like a sidechained kick).
 * The leading `set` ends the previous swell: by then it is within 1 % of unity.
 */
export function pumpEvents(when: number, amount: number, beatSeconds: number): GainEvent[] {
  const a = Math.max(0, Math.min(1, amount || 0));
  const floor = 1 - 0.95 * a;
  return [
    { kind: 'set', t: when, v: 1 },
    { kind: 'ramp', t: when + 0.005, v: floor },
    { kind: 'target', t: when + 0.005, v: 1, tau: beatSeconds * 0.2 },
  ];
}
