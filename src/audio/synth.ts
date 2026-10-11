import { midiToHz } from '../lib/midi';
import type { OscWave, SynthSettings } from '../types';

/** One oscillator of a voice: wave, frequency in Hz and linear gain. */
export interface OscPart {
  wave: OscWave;
  freq: number;
  gain: number;
}

/** How to build the filter of a voice: type, resting cutoff, envelope start and LFO. */
export interface FilterPlan {
  type: 'lowpass' | 'highpass' | 'bandpass';
  cutoff: number;
  q: number;
  /** Cutoff at note-on; it falls to `cutoff` within `decay` seconds (equal to cutoff: no envelope). */
  startCutoff: number;
  decay: number;
  /** LFO in Hz and its swing in Hz either side of the cutoff (0: no LFO). */
  lfoHz: number;
  lfoDepthHz: number;
}

export interface VoicePlan {
  oscs: OscPart[];
  /** Linear gain of the sub sine (one octave below) and the noise; 0 = absent. */
  sub: { freq: number; gain: number } | null;
  noise: number;
  filter: FilterPlan;
}

const cents = (c: number) => Math.pow(2, c / 1200);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The sound of one note of an oscillator synth, as plain data: unison copies of oscillator A (and B),
 * detuned over the spread, scaled so the sum keeps the level of a single oscillator; sub and noise;
 * a filter with envelope and tempo-synced LFO. The engine only turns this into nodes.
 */
export function planVoice(s: SynthSettings, pitch: number, bpm: number): VoicePlan {
  const n = clamp(Math.round(s.unison ?? 1), 1, 7);
  const spread = Math.max(0, s.spread ?? 0);
  const b = s.oscB && s.oscB.level > 0 ? s.oscB : null;
  const bLevel = b ? clamp(b.level, 0, 1) : 0;
  // Sum of squares of all oscillator gains is 1: unison and a second oscillator do not get louder.
  const norm = 1 / Math.sqrt(n * (1 + bLevel * bLevel));
  const oscs: OscPart[] = [];
  for (let i = 0; i < n; i++) {
    const off = n > 1 ? (i / (n - 1) - 0.5) * spread : 0;
    oscs.push({ wave: s.wave as OscWave, freq: midiToHz(pitch) * cents(off), gain: norm });
    if (b) oscs.push({ wave: b.wave, freq: midiToHz(pitch + clamp(Math.round(b.octave), -3, 3) * 12) * cents(off + b.detune), gain: norm * bLevel });
  }
  const cutoff = clamp(s.cutoff, 20, 20000);
  const env = Math.max(0, s.filterEnv ?? 0);
  const depth = clamp(s.lfoDepth ?? 0, 0, 1);
  const rate = Math.max(0, s.lfoRate ?? 0);
  return {
    oscs,
    sub: s.sub && s.sub > 0 ? { freq: midiToHz(pitch - 12), gain: clamp(s.sub, 0, 1) * 0.7 } : null,
    noise: clamp(s.noise ?? 0, 0, 1) * 0.5,
    filter: {
      type: s.filterType ?? 'lowpass',
      cutoff,
      q: Math.max(0.0001, s.resonance),
      startCutoff: env > 0 ? Math.min(20000, cutoff * Math.pow(2, env)) : cutoff,
      decay: Math.max(0.01, s.filterDecay ?? 0.25),
      lfoHz: depth > 0 && rate > 0 ? (bpm / 60 / 4) * rate : 0,
      lfoDepthHz: depth > 0 && rate > 0 ? cutoff * 0.9 * depth : 0,
    },
  };
}

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
