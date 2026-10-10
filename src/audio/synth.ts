import type { SynthSettings } from '../types';

/** The note on which a sample instrument plays its sample unchanged (C3 in Ableton's naming). */
export const SAMPLE_ROOT = 60;

/** Playback rate that puts a sample instrument's sample on `pitch`. */
export const pitchRate = (pitch: number) => Math.pow(2, (pitch - SAMPLE_ROOT) / 12);

/** What switching an instrument to a sample sets: open filter, no envelope shaping, one-shot. */
export const SAMPLER_PRESET: Partial<SynthSettings> = { wave: 'sample', cutoff: 16000, resonance: 0.7, attack: 0.001, decay: 1.5, sustain: 1, release: 0.05, oneShot: true };

/** Peak level of one voice: synth notes leave headroom for chords, samples come mastered already. */
export const voicePeak = (synth: Pick<SynthSettings, 'wave'>, velocity: number) => (synth.wave === 'sample' ? 0.9 : 0.25) * velocity;

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
