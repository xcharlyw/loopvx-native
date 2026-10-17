/** Cutting a loop into slices: transient detection and beat grids (pure; the slices are start times in seconds of the sample). */

export const MAX_SLICES = 32;
/** The slice never gets shorter than this (a click is not a slice). */
const MIN_SLICE = 0.02;

export interface SliceOptions {
  /** 0..1: higher finds quieter transients (more slices). */
  sensitivity?: number;
  /** Two slices never start closer than this, in ms. */
  minGapMs?: number;
  /** At most this many slices (the strongest transients win). */
  max?: number;
}

/**
 * Energy of the signal in 5 ms steps (10 ms windows) in dB, the base of the onset curve.
 * Returns the steps and the hop in seconds.
 */
function energyDb(data: Float32Array, sampleRate: number): { db: number[]; hop: number } {
  const hopSamples = Math.max(1, Math.round(sampleRate * 0.005));
  const win = hopSamples * 2;
  const db: number[] = [];
  for (let at = 0; at < data.length; at += hopSamples) {
    let sum = 0;
    const end = Math.min(data.length, at + win);
    for (let i = at; i < end; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / Math.max(1, end - at));
    db.push(Math.max(-90, 20 * Math.log10(rms + 1e-9)));
  }
  return { db, hop: hopSamples / sampleRate };
}

/** Where in [from, from + span] the sound really starts: the first sample above 15 % of the loudest one there, a millisecond earlier. */
function exactStart(data: Float32Array, sampleRate: number, from: number, span: number): number {
  const a = Math.max(0, Math.floor(from * sampleRate));
  const b = Math.min(data.length, Math.ceil((from + span) * sampleRate));
  let peak = 0;
  for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak <= 0) return Math.max(0, from);
  // The bed under a hit (a sustained bass) must not count: the sound has to rise well above what the span starts with.
  let bed = 0;
  for (let i = a; i < Math.min(b, a + Math.round(sampleRate * 0.002) + 1); i++) bed = Math.max(bed, Math.abs(data[i]));
  const level = Math.max(peak * 0.15, bed * 1.5);
  for (let i = a; i < b; i++) if (Math.abs(data[i]) >= level) return Math.max(0, i / sampleRate - 0.001);
  return Math.max(0, from);
}

/**
 * Start times (seconds) of the transients in `data`: where the energy jumps up against the last few steps.
 * Always includes 0 when the sample starts with sound, so the slices cover the whole sample.
 */
export function detectOnsets(data: Float32Array, sampleRate: number, opts: SliceOptions = {}): number[] {
  const sensitivity = Math.min(1, Math.max(0, opts.sensitivity ?? 0.5));
  const minGap = Math.max(10, opts.minGapMs ?? 60) / 1000;
  const max = Math.min(MAX_SLICES, opts.max ?? MAX_SLICES);
  const { db, hop } = energyDb(data, sampleRate);
  if (db.length < 4) return [0];
  const peak = Math.max(...db);
  if (peak < -60) return [0];
  // A transient has to rise by this many dB above the recent past: 14 dB at 0, 4 dB at 1.
  const rise = 14 - 10 * sensitivity;
  const floor = peak - 45; // nothing in the noise floor counts
  const found: { time: number; strength: number }[] = [];
  for (let i = 2; i < db.length; i++) {
    const past = Math.max(db[i - 2], db[i - 1]) - 0;
    const jump = db[i] - Math.min(past, db[i - 1]);
    const ahead = Math.max(db[i], db[i + 1] ?? -90, db[i + 2] ?? -90);
    // The onset is the step where the rise starts: the loudest of the next steps must be a real jump over the step before.
    if (ahead - db[i - 1] >= rise && jump > 0 && db[i] > floor && db[i] - db[i - 1] >= rise / 2 && db[i - 1] <= db[i]) {
      found.push({ time: exactStart(data, sampleRate, (i - 1) * hop, hop * 6), strength: ahead - db[i - 1] });
    }
  }
  // Keep the strongest transient of every `minGap` neighbourhood.
  found.sort((a, b) => b.strength - a.strength);
  const kept: { time: number; strength: number }[] = [];
  for (const f of found) if (kept.every((k) => Math.abs(k.time - f.time) >= minGap)) kept.push(f);
  const strongest = kept.slice(0, Math.max(0, max - 1)).sort((a, b) => a.time - b.time);
  const times = strongest.map((k) => Math.round(k.time * 1000) / 1000);
  if (!times.length || times[0] > MIN_SLICE) times.unshift(0);
  return times;
}

/** `perBar` equal slices per bar of a loop at `bpm` (4/4), for as many bars as the sample is long. */
export function gridOnsets(duration: number, bpm: number, perBar: number, max = MAX_SLICES): number[] {
  if (!(duration > 0) || !(bpm > 0) || !(perBar > 0)) return [0];
  const step = 240 / bpm / perBar;
  const times: number[] = [];
  for (let t = 0; t < duration - MIN_SLICE && times.length < max; t += step) times.push(Math.round(t * 1e6) / 1e6);
  return times.length ? times : [0];
}

/** One piece of the sample in seconds. */
export interface Slice {
  start: number;
  end: number;
}

/** Turn start times into slices that tile the sample: sorted, from 0, none shorter than 20 ms, the last running to `duration`. */
export function toSlices(starts: number[], duration: number): Slice[] {
  const sorted = [...new Set(starts.filter((t) => t >= 0 && t < duration))].sort((a, b) => a - b);
  if (!sorted.length || sorted[0] > MIN_SLICE) sorted.unshift(0);
  else sorted[0] = 0;
  const kept: number[] = [];
  for (const t of sorted) if (!kept.length || t - kept[kept.length - 1] >= MIN_SLICE) kept.push(t);
  return kept.slice(0, MAX_SLICES).map((start, i, all) => ({ start, end: all[i + 1] ?? duration }));
}

/** Where the slice sits in the project, in bars from the loop start, when the loop is warped to `projectBpm` (re-pitch, like a clip). */
export function sliceBars(slice: Slice, sampleBpm: number | undefined, projectBpm: number): { start: number; length: number } {
  const rate = sampleBpm ? projectBpm / sampleBpm : 1;
  const bar = 240 / projectBpm;
  return { start: slice.start / rate / bar, length: (slice.end - slice.start) / rate / bar };
}
