import type { Note } from '../types';

// The drums stem of a tune, taken apart without AI: band filters split it into kick (lows), clap/snare (mids) and hi-hats
// (highs) as audio, and a hit detector on the same bands writes the groove as MIDI on the 909's notes (kick C1 36, clap 39,
// closed hat 42), on a 16th grid fitted to the tune's kicks. Pure and tested on synthetic drums.

type Coeffs = [number, number, number, number, number];

/** RBJ cookbook biquad (b0, b1, b2, a1, a2 normalised by a0). */
export function biquad(kind: 'lowpass' | 'highpass', freq: number, q: number, sampleRate: number): Coeffs {
  const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b1 = kind === 'lowpass' ? 1 - cos : -(1 + cos);
  const b0 = kind === 'lowpass' ? (1 - cos) / 2 : (1 + cos) / 2;
  return [b0 / a0, b1 / a0, b0 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

function run(x: Float32Array, [b0, b1, b2, a1, a2]: Coeffs): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** Two filters in a row (24 dB/oct) for each edge. */
const chain = (x: Float32Array, sr: number, steps: [kind: 'lowpass' | 'highpass', freq: number][]) => steps.reduce((acc, [k, f]) => run(run(acc, biquad(k, f, Math.SQRT1_2, sr)), biquad(k, f, Math.SQRT1_2, sr)), x);

export type DrumPart = 'kick' | 'clap' | 'hat';
export const DRUM_PARTS: DrumPart[] = ['kick', 'clap', 'hat'];
export const DRUM_PART_LABEL: Record<DrumPart, string> = { kick: 'Kick', clap: 'Clap + Snare', hat: 'HiHats' };
export const DRUM_PITCH: Record<DrumPart, number> = { kick: 36, clap: 39, hat: 42 };

const EDGES: Record<DrumPart, [kind: 'lowpass' | 'highpass', freq: number][]> = { kick: [['lowpass', 150]], clap: [['highpass', 500], ['lowpass', 5000]], hat: [['highpass', 7000]] };

/** One band of a channel (one at a time keeps the memory of a whole tune low). */
export const bandOf = (x: Float32Array, sampleRate: number, part: DrumPart) => chain(x, sampleRate, EDGES[part]);

/** One channel split into the three bands. */
export function splitBands(x: Float32Array, sampleRate: number): Record<DrumPart, Float32Array> {
  return { kick: bandOf(x, sampleRate, 'kick'), clap: bandOf(x, sampleRate, 'clap'), hat: bandOf(x, sampleRate, 'hat') };
}

/** How long the click of a kick lasts (ms after the onset) and how long the fades at the window's edges are. */
const CLICK_MS = 6;
const CLICK_PRE_MS = 0.5;
const CLICK_FADE_MS = 1;

/** Kick onsets (ms) of a mono signal: where the kick band's level jumps, at least 80 ms apart. */
export function kickOnsetsMs(x: Float32Array, sampleRate: number): number[] {
  const env = envelope(chain(x, sampleRate, [['lowpass', 150]]), sampleRate);
  const rise = new Float32Array(env.length);
  for (let i = 0; i + 10 < env.length; i++) rise[i] = Math.max(0, env[i + 10] - env[i]);
  const loud = percentile(Array.from(rise), 0.95);
  if (loud <= 0) return [];
  const out: number[] = [];
  for (let i = 1; i < rise.length - 1; i++) {
    if (rise[i] < loud * 0.35 || rise[i] < rise[i - 1] || rise[i] < rise[i + 1]) continue;
    if (out.length && i - out[out.length - 1] < 80) continue;
    out.push(i);
  }
  return out;
}

/** 1 inside the kick-click windows (smooth edges), 0 elsewhere. */
export function clickWindow(length: number, sampleRate: number, onsetsMs: number[]): Float32Array {
  const w = new Float32Array(length);
  const perMs = sampleRate / 1000;
  const fade = Math.max(1, Math.round(CLICK_FADE_MS * perMs));
  for (const t of onsetsMs) {
    const a = Math.round((t - CLICK_PRE_MS) * perMs);
    const b = Math.round((t + CLICK_MS) * perMs);
    for (let i = Math.max(0, a - fade); i < Math.min(length, b + fade); i++) {
      const edge = i < a ? (i - (a - fade)) / fade : i > b ? ((b + fade) - i) / fade : 1;
      w[i] = Math.max(w[i], Math.min(1, Math.max(0, edge)));
    }
  }
  return w;
}

/**
 * The drums split into Kick, Clap + Snare and HiHats as **complementary** parts: the kick's click (the highs in the first
 * milliseconds of every kick) belongs to the kick, so it is added to the kick band and taken out of the hats band; otherwise
 * the same click would sit in two stems and the kick would phase when they play together. `part(p)` computes one part at a time (a whole tune is large); parts keep the length of the input.
 */
export function makeDrumSplitter(channels: Float32Array[], sampleRate: number): { onsetsMs: number[]; part: (p: DrumPart) => Float32Array[] } {
  const mono = monoForAnalysis(channels, sampleRate);
  const onsetsMs = kickOnsetsMs(mono.data, mono.sampleRate);
  const w = clickWindow(channels[0].length, sampleRate, onsetsMs);
  return {
    onsetsMs,
    part: (p) =>
      channels.map((x) => {
        const band = bandOf(x, sampleRate, p);
        if (p === 'kick') {
          // body (< 150 Hz) plus everything else of the original inside the click window
          for (let i = 0; i < band.length; i++) if (w[i] > 0) band[i] += w[i] * (x[i] - band[i]);
        } else if (p === 'hat') {
          for (let i = 0; i < band.length; i++) band[i] *= 1 - w[i];
        }
        return band;
      }),
  };
}

/** Mono and at most ~24 kHz (plenty for finding hits; a whole tune stays small). */
export function monoForAnalysis(channels: Float32Array[], sampleRate: number): { data: Float32Array; sampleRate: number } {
  const factor = sampleRate > 30000 ? 2 : 1;
  const len = Math.floor(channels[0].length / factor);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (const ch of channels) for (let k = 0; k < factor; k++) sum += ch[i * factor + k];
    out[i] = sum / (channels.length * factor);
  }
  return { data: out, sampleRate: sampleRate / factor };
}

/**
 * Peak envelope sampled every millisecond, exactly: tick i covers the samples of [i ms, i + 1 ms). (A whole-sample hop of
 * 22 at 22.05 kHz made a tick 0.998 ms and put the fitted tempo 0.3 BPM off.)
 */
function envelope(x: Float32Array, sampleRate: number): Float32Array {
  const perMs = sampleRate / 1000;
  const out = new Float32Array(Math.ceil(x.length / perMs));
  const release = Math.exp(-1 / (0.03 * 1000)); // 30 ms per 1 ms tick
  let env = 0;
  for (let i = 0; i < out.length; i++) {
    let peak = 0;
    const end = Math.min(x.length, Math.round((i + 1) * perMs));
    for (let j = Math.round(i * perMs); j < end; j++) peak = Math.max(peak, Math.abs(x[j]));
    env = peak > env ? peak : env * release;
    out[i] = env;
  }
  return out;
}

const percentile = (v: number[], p: number) => {
  const s = v.filter((x) => x > 0).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
};

/** Tempo and phase (ms of the first beat) that line the kicks up best, searched around the given tempo. */
export function fitGrid(kickRise: Float32Array, bpm: number): { bpm: number; phase: number } {
  let best = { bpm, phase: 0, score: -1 };
  for (let b = bpm - 0.25; b <= bpm + 0.2501; b += 0.01) {
    const beat = 60000 / b;
    for (let phase = 0; phase < beat; phase += 2) {
      let score = 0;
      for (let t = phase; t < kickRise.length; t += beat) score += kickRise[Math.round(t)] ?? 0;
      if (score > best.score) best = { bpm: Math.round(b * 100) / 100, phase, score };
    }
  }
  return { bpm: best.bpm, phase: best.phase };
}

export interface DrumTranscript {
  notes: Note[];
  /** The tempo the grid was fitted to, and where its first beat sits (ms from the start of the audio). */
  bpm: number;
  phaseMs: number;
  /** Where bar 1 starts in the audio (ms): the first kick on a beat, kept on the bar grid. */
  downbeatMs: number;
  bars: number;
}

/**
 * The drum groove of a (mono) drums stem as MIDI: per 16th step and band, how far the level jumps from just before the step to
 * just after it, measured against that band's typical jump. A clap on a kick step must stand out from the kick's own bleed into
 * the mids (1.6x the jump of the quieter kick steps), a hat on a kick/clap step likewise in the highs.
 */
export function transcribeDrums(x: Float32Array, sampleRate: number, bpm: number): DrumTranscript {
  const bands = splitBands(x, sampleRate);
  const env = Object.fromEntries(DRUM_PARTS.map((p) => [p, envelope(bands[p], sampleRate)])) as Record<DrumPart, Float32Array>;
  const kickRise = new Float32Array(env.kick.length);
  for (let i = 0; i + 10 < env.kick.length; i++) kickRise[i] = Math.max(0, env.kick[i + 10] - env.kick[i]); // forward: the jump right after i peaks at the onset
  const grid = fitGrid(kickRise, bpm);
  const stepMs = 60000 / grid.bpm / 4;
  const len = env.kick.length;
  const steps = Math.floor((len - grid.phase) / stepMs);
  const rise: Record<DrumPart, number[]> = { kick: [], clap: [], hat: [] };
  const post: Record<DrumPart, number[]> = { kick: [], clap: [], hat: [] };
  for (let s = 0; s < steps; s++) {
    const t = Math.round(grid.phase + s * stepMs);
    for (const p of DRUM_PARTS) {
      const e = env[p];
      let hi = 0;
      for (let i = Math.max(0, t - 8); i <= Math.min(len - 1, t + 25); i++) hi = Math.max(hi, e[i]);
      let lo = 0;
      let n = 0;
      for (let i = Math.max(0, t - 40); i <= Math.max(0, t - 10); i++, n++) lo += e[i];
      const before = n ? lo / n : 0;
      rise[p].push(Math.max(0, hi - before));
      post[p].push(hi);
    }
  }
  const norm = Object.fromEntries(DRUM_PARTS.map((p) => [p, percentile(rise[p], 0.95) || 1])) as Record<DrumPart, number>;
  const loud = Object.fromEntries(DRUM_PARTS.map((p) => [p, percentile(post[p], 0.99)])) as Record<DrumPart, number>;
  const hit = (p: DrumPart, s: number, thr: number) => rise[p][s] / norm[p] > thr && post[p][s] > loud[p] * 0.05;

  const kick = rise.kick.map((_, s) => hit('kick', s, 0.35));
  const kickSteps = kick.flatMap((k, s) => (k ? [s] : []));
  // The kick's own bleed into the mids: the quieter half of the kick steps (claps sit on at most every second kick).
  const clapOnKick = percentile(kickSteps.map((s) => rise.clap[s]), 0.25);
  // Hats reach down into the mids as well: on a step with a hat-like jump a clap must stand out from that bleed.
  const hatLike = rise.hat.map((_, s) => hit('hat', s, 0.15) && !kick[s]); // low bar: any hat-ish jump counts as bleed source
  const clapOnHat = percentile(hatLike.flatMap((h, s) => (h ? [rise.clap[s]] : [])), 0.5);
  const clap = rise.clap.map((r, s) => hit('clap', s, 0.4) && (kick[s] ? r > clapOnKick * 1.6 : hatLike[s] ? r > clapOnHat * 2.5 : true));
  // Claps and kicks reach into the highs too: on their steps a hat must stand out from that bleed.
  const hatOnClap = percentile(clap.flatMap((c, s) => (c ? [rise.hat[s]] : [])), 0.5);
  const hatOnKick = percentile(kick.flatMap((k, s) => (k && !clap[s] ? [rise.hat[s]] : [])), 0.25);
  const hat = rise.hat.map((r, s) => hit('hat', s, 0.35) && (clap[s] ? r > hatOnClap * 1.6 : kick[s] ? r > hatOnKick * 1.6 : true));

  // Bar 1 starts with the first kick on a beat (tunes start on a downbeat); the bar grid keeps that phase all through, so a kick
  // that enters later still lands on its bar line. Anything before the first bar (a pickup, silence) is cut.
  const firstKick = kick.findIndex((k, s) => k && s % 4 === 0);
  const barStart = firstKick < 0 ? 0 : firstKick % 16;
  const notes: Note[] = [];
  const vel = (p: DrumPart, s: number) => Math.round(Math.min(1, 0.45 + 0.55 * Math.min(1, rise[p][s] / norm[p])) * 100) / 100;
  for (let s = barStart; s < steps; s++) {
    const start = (s - barStart) / 16;
    if (kick[s]) notes.push({ pitch: DRUM_PITCH.kick, start, length: 1 / 16, velocity: vel('kick', s) });
    if (clap[s]) notes.push({ pitch: DRUM_PITCH.clap, start, length: 1 / 16, velocity: vel('clap', s) });
    if (hat[s]) notes.push({ pitch: DRUM_PITCH.hat, start, length: 1 / 16, velocity: vel('hat', s) });
  }
  return { notes, bpm: grid.bpm, phaseMs: grid.phase, downbeatMs: grid.phase + barStart * stepMs, bars: Math.max(1, Math.ceil((steps - barStart) / 16)) };
}
