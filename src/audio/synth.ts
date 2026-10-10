import type { SynthSettings } from '../types';

/** The note on which a sample instrument plays its sample unchanged (C3 in Ableton's naming). */
export const SAMPLE_ROOT = 60;

/** Playback rate that puts a sample instrument's sample on `pitch`. */
export const pitchRate = (pitch: number) => Math.pow(2, (pitch - SAMPLE_ROOT) / 12);

/** What switching an instrument to a sample sets: open filter, no envelope shaping, one-shot. */
export const SAMPLER_PRESET: Partial<SynthSettings> = { wave: 'sample', cutoff: 16000, resonance: 0.7, attack: 0.001, decay: 1.5, sustain: 1, release: 0.05, oneShot: true };

/** Synthesized kick: the body sits at 50 Hz on C3 and follows the note like a sample would. */
export const KICK_PRESET: Partial<SynthSettings> = { wave: 'kick', cutoff: 16000, resonance: 0.7, attack: 0.001, decay: 0.45, sustain: 0, release: 0.04 };

/** Noise through a highpass: a closed hat by default; longer decay and lower cutoff give a snare or a riser. */
export const NOISE_PRESET: Partial<SynthSettings> = { wave: 'noise', cutoff: 7500, resonance: 1, attack: 0.001, decay: 0.06, sustain: 0, release: 0.03 };

/** Instruments for drum programming: every hit sits on C3 and plays out, whatever the note length. */
export const isDrumWave = (wave: SynthSettings['wave']) => wave === 'sample' || wave === 'kick' || wave === 'noise';

/** Peak level of one voice: synth notes leave headroom for chords, drums and samples come in hot. */
export function voicePeak(synth: Pick<SynthSettings, 'wave'>, velocity: number): number {
  const peak = synth.wave === 'sample' || synth.wave === 'kick' ? 0.9 : synth.wave === 'noise' ? 0.45 : 0.25;
  return peak * velocity;
}

/** The kick's pitch drop: from a click-like high start down to the body within 80 ms. */
export function kickSweep(pitch: number): { from: number; to: number; time: number } {
  const to = 50 * pitchRate(pitch);
  return { from: to * 7, to, time: 0.08 };
}

/** How long a note keeps its envelope open: synthesized drums ring out their decay like a one-shot. */
export function noteHold(s: Pick<SynthSettings, 'wave' | 'attack' | 'decay'>, hold: number): number {
  return s.wave === 'kick' || s.wave === 'noise' ? Math.max(hold, s.attack + s.decay) : hold;
}

/** Deterministic white noise in [-1, 1). */
export function noiseSamples(length: number, seed = 7): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length);
  let a = seed >>> 0;
  for (let i = 0; i < length; i++) {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    out[i] = (a / 4294967296) * 2 - 1;
  }
  return out;
}

/**
 * Gain breakpoints (seconds from note-on, level) of an ADSR envelope for a note held `hold`
 * seconds, ending at 0 after the release. Linear between points, so they map onto
 * linearRampToValueAtTime after a setValueAtTime(0, noteOn). A note released during the attack
 * or decay releases from wherever the envelope got to.
 */
export function adsrPoints(s: Pick<SynthSettings, 'attack' | 'decay' | 'sustain' | 'release'>, peak: number, hold: number): { t: number; v: number }[] {
  const a = Math.max(0.001, s.attack);
  const d = Math.max(0.001, s.decay);
  const sus = peak * Math.max(0, Math.min(1, s.sustain));
  const r = Math.max(0.005, s.release);
  const h = Math.max(0, hold);
  const points: { t: number; v: number }[] = [];
  let level: number;
  if (h <= a) {
    level = peak * (h / a);
    points.push({ t: h, v: level });
  } else if (h <= a + d) {
    level = peak + (sus - peak) * ((h - a) / d);
    points.push({ t: a, v: peak }, { t: h, v: level });
  } else {
    level = sus;
    points.push({ t: a, v: peak }, { t: a + d, v: sus }, { t: h, v: sus });
  }
  points.push({ t: h + r, v: 0 });
  return points;
}
