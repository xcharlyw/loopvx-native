import { midiToHz } from '../lib/midi';
import type { ModSlot, ModSource, ModTarget, OscWave, SynthSettings } from '../types';
import { snapPos, tableById } from './wavetables';

/** One oscillator of a voice: wave, frequency in Hz and linear gain. */
export interface OscPart {
  wave: OscWave;
  freq: number;
  gain: number;
  /** A wavetable frame instead of `wave`: table id and position 0..1. */
  table?: { id: string; pos: number };
  /** Which oscillator it belongs to (for the position modulation). */
  osc?: 'A' | 'B';
}

/** One LFO of a voice: shape and speed in Hz. */
export interface LfoPlan {
  source: 'lfo1' | 'lfo2';
  shape: OscWave;
  hz: number;
}

/** The modulation of a voice: which sources run and how they are routed (only slots that do something). */
export interface ModPlan {
  lfos: LfoPlan[];
  env2: { attack: number; decay: number; sustain: number; release: number } | null;
  slots: ModSlot[];
}

/** How to build the filter of a voice: type, resting cutoff, envelope start and LFO. */
export interface FilterPlan {
  type: 'lowpass' | 'highpass' | 'bandpass';
  cutoff: number;
  q: number;
  /** Cutoff at note-on; it falls to `cutoff` within `decay` seconds (equal to cutoff: no envelope). */
  startCutoff: number;
  decay: number;
  /** Two filters in a row (24 dB/octave). */
  steep: boolean;
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
  mod: ModPlan;
}

export const MOD_SOURCES: ModSource[] = ['lfo1', 'lfo2', 'env2'];
export const MOD_TARGETS: ModTarget[] = ['cutoff', 'reso', 'pitch', 'posA', 'posB', 'level', 'pan'];
export const MAX_MODS = 8;

/** Sources that swing around zero (the LFOs) and ones that go from 0 to 1 (the envelope). */
export const isBipolar = (s: ModSource) => s !== 'env2';

/** The valid, audible routings of a sound, at most MAX_MODS (a slot without amount, or to a target that has no sound, is dropped). */
export function activeMods(s: Pick<SynthSettings, 'mods' | 'tableA' | 'oscB'>): ModSlot[] {
  const out: ModSlot[] = [];
  for (const m of s.mods ?? []) {
    if (out.length >= MAX_MODS) break;
    if (!MOD_SOURCES.includes(m.source) || !MOD_TARGETS.includes(m.target)) continue;
    const amount = clamp(Number(m.amount) || 0, -1, 1);
    if (Math.abs(amount) < 0.005) continue;
    if (m.target === 'posA' && !s.tableA) continue;
    if (m.target === 'posB' && !(s.oscB && s.oscB.level > 0 && s.oscB.table)) continue;
    out.push({ source: m.source, target: m.target, amount });
  }
  return out;
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
  const tableA = tableById(s.tableA);
  const tableB = b ? tableById(b.table) : undefined;
  // Sum of squares of all oscillator gains is 1: unison and a second oscillator do not get louder.
  const norm = 1 / Math.sqrt(n * (1 + bLevel * bLevel));
  const oscs: OscPart[] = [];
  for (let i = 0; i < n; i++) {
    const off = n > 1 ? (i / (n - 1) - 0.5) * spread : 0;
    const a: OscPart = { wave: s.wave as OscWave, freq: midiToHz(pitch) * cents(off), gain: norm, osc: 'A' };
    if (tableA) a.table = { id: tableA.id, pos: snapPos(s.posA ?? 0) };
    oscs.push(a);
    if (b) {
      const part: OscPart = { wave: b.wave, freq: midiToHz(pitch + clamp(Math.round(b.octave), -3, 3) * 12) * cents(off + b.detune), gain: norm * bLevel, osc: 'B' };
      if (tableB) part.table = { id: tableB.id, pos: snapPos(b.pos ?? 0) };
      oscs.push(part);
    }
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
      steep: !!s.filter24,
      lfoHz: depth > 0 && rate > 0 ? (bpm / 60 / 4) * rate : 0,
      lfoDepthHz: depth > 0 && rate > 0 ? cutoff * 0.9 * depth : 0,
    },
    mod: modPlan(s, bpm),
  };
}

/** Which LFOs and envelope the mod matrix needs, with their speeds (LFO rates are cycles per bar, so they follow the tempo). */
export function modPlan(s: SynthSettings, bpm: number): ModPlan {
  const slots = activeMods(s);
  const uses = (src: ModSource) => slots.some((m) => m.source === src);
  const perBar = (rate: number) => (bpm / 60 / 4) * Math.max(0, rate);
  const lfos: LfoPlan[] = [];
  if (uses('lfo1')) lfos.push({ source: 'lfo1', shape: s.lfoShape ?? 'sine', hz: perBar(s.lfoRate || 1) });
  if (uses('lfo2')) lfos.push({ source: 'lfo2', shape: s.lfo2Shape ?? 'sine', hz: perBar(s.lfo2Rate || 0.5) });
  const e = s.env2;
  return { lfos, env2: uses('env2') ? { attack: e?.attack ?? 0.01, decay: e?.decay ?? 0.4, sustain: e?.sustain ?? 0, release: e?.release ?? 0.2 } : null, slots };
}

/**
 * The two frames a modulated wavetable position morphs between: `pos` and `pos + amount` (clamped to the table).
 * A morph of two frames is a linear blend of their spectra, which is what moving through the table sounds like.
 */
export function morphRange(pos: number, amount: number): { lo: number; hi: number } {
  const a = clamp(pos, 0, 1);
  const b = clamp(pos + amount, 0, 1);
  return { lo: snapPos(Math.min(a, b)), hi: snapPos(Math.max(a, b)) };
}

/** The note on which a sample instrument plays its sample unchanged (C3 in Ableton's naming). */
export const SAMPLE_ROOT = 60;

/** Playback rate that puts a sample instrument's sample on `pitch`: `root` is where it sounds unchanged, `tune` is in cents. */
export const pitchRate = (pitch: number, root = SAMPLE_ROOT, tune = 0) => Math.pow(2, (pitch - root) / 12 + tune / 1200);

/** First pad of a slicer instrument: slice 0 sits on C1 = 36 like the kick of the Drum Rack. */
export const SLICE_ROOT = 36;

/**
 * What a slicer note plays: piece `pitch - 36` of the sample from `offset`, `length` seconds of the sample, at `rate`
 * (re-pitch to the project tempo when the loop's tempo is known). Null when the note has no slice.
 */
export function slicePlan(
  synth: Pick<SynthSettings, 'slices' | 'sliceBpm'>,
  pitch: number,
  bufferDuration: number,
  projectBpm: number,
): { offset: number; length: number; rate: number } | null {
  const slices = synth.slices;
  const i = pitch - SLICE_ROOT;
  if (!slices || i < 0 || i >= slices.length) return null;
  const offset = slices[i];
  const end = slices[i + 1] ?? bufferDuration;
  if (!(offset >= 0) || offset >= bufferDuration || end <= offset) return null;
  return { offset, length: Math.min(end, bufferDuration) - offset, rate: synth.sliceBpm ? projectBpm / synth.sliceBpm : 1 };
}

/** The sound settings of a slicer: open filter, a fast envelope that fades out within the last 4 ms of each piece. */
export const SLICER_PRESET: Partial<SynthSettings> = { wave: 'sample', cutoff: 16000, resonance: 0.7, attack: 0.001, decay: 1.5, sustain: 1, release: 0.004, oneShot: true };

/** What switching an instrument to a sample sets: open filter, no envelope shaping, one-shot. */
export const SAMPLER_PRESET: Partial<SynthSettings> = { wave: 'sample', cutoff: 16000, resonance: 0.7, attack: 0.001, decay: 1.5, sustain: 1, release: 0.05, oneShot: true };

/** Synthesized kick: the body sits at 50 Hz on C3 and follows the note like a sample would. */
export const KICK_PRESET: Partial<SynthSettings> = { wave: 'kick', cutoff: 16000, resonance: 0.7, attack: 0.001, decay: 0.45, sustain: 0, release: 0.04 };

/** Noise through a highpass: a closed hat by default; longer decay and lower cutoff give a snare or a riser. */
export const NOISE_PRESET: Partial<SynthSettings> = { wave: 'noise', cutoff: 7500, resonance: 1, attack: 0.001, decay: 0.06, sustain: 0, release: 0.03 };

/** The 909 drum machine: pads on the drum-rack notes from C1, every sound with its own recipe (see drum909.ts). */
export const KIT909_PRESET: Partial<SynthSettings> = { wave: 'kit909', cutoff: 16000, resonance: 0.7, attack: 0.001, decay: 0.45, sustain: 0, release: 0.04, kitDecay: 1 };
export const isKitWave = (wave: SynthSettings['wave']) => wave === 'kit909';

/** Instruments for drum programming: every hit sits on C3 and plays out, whatever the note length. */
export const isDrumWave = (wave: SynthSettings['wave']) => wave === 'sample' || wave === 'kick' || wave === 'noise';

/** Peak level of one voice: synth notes leave headroom for chords, drums and samples come in hot. */
export function voicePeak(synth: Pick<SynthSettings, 'wave' | 'gainDb'>, velocity: number): number {
  const peak = synth.wave === 'kit909' ? 0.7 : synth.wave === 'sample' || synth.wave === 'kick' ? 0.9 : synth.wave === 'noise' ? 0.45 : 0.25;
  return peak * velocity * Math.pow(10, (synth.gainDb ?? 0) / 20);
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
