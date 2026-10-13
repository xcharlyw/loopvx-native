// Tempo detection for loops: where does the beat sit?
//
// 1. Onset curve: how fast the loudness rises, per ~6 ms hop.
// 2. Its autocorrelation says how well the curve repeats after a lag; a real tempo repeats after one
//    beat, two beats, a bar, so the score of a tempo is the mean over its multiples (a "comb").
// 3. Candidates: whole-bar lengths of the sample (loops are cut on bars, so they are exact) plus the
//    strongest autocorrelation peaks (for samples that are not cut cleanly). A prior towards the
//    hard-techno range settles the octave question (80 or 160 BPM?).
// Pure and deterministic: PCM in, a tempo or nothing out.

export interface TempoGuess {
  bpm: number;
  /** 0..1: how well the onsets repeat at this tempo. Vocals and pads score low. */
  confidence: number;
  /** 'loop': the sample length is a whole number of bars at this tempo. 'beat': found from the onsets alone. */
  source: 'loop' | 'beat';
}

export interface TempoOptions {
  minBpm?: number;
  maxBpm?: number;
  /** Below this confidence nothing is returned. */
  minConfidence?: number;
  /** Analyse at most this many seconds from the start. */
  maxSeconds?: number;
}

const HOPS_PER_SECOND = 172; // ~5.8 ms
const PRIOR_CENTER = 150;
const PRIOR_WIDTH_OCTAVES = 0.5;
const MIN_CREST = 3;

/** Peak height over RMS of the onset curve: hits are spiky (high), ripple and drones are not (about 1.4). */
export function crestFactor(curve: Float32Array): number {
  let peak = 0;
  let sum = 0;
  for (const v of curve) {
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  const rms = Math.sqrt(sum / Math.max(1, curve.length));
  return rms > 1e-9 ? peak / rms : 0;
}

/** Loudness rise per hop, mean removed: positive where a drum hit or note starts. */
export function onsetCurve(samples: Float32Array, sampleRate: number): { curve: Float32Array; hopsPerSecond: number } {
  const hop = Math.max(1, Math.round(sampleRate / HOPS_PER_SECOND));
  // Windows of four hops (~23 ms): a window shorter than a bass period would make the level ripple
  // with the pitch, which looks like a steady beat to the autocorrelation.
  const win = hop * 4;
  const frames = Math.max(0, Math.floor((samples.length - win) / hop) + 1);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop; i < f * hop + win; i++) sum += samples[i] * samples[i];
    env[f] = Math.log1p(1000 * Math.sqrt(sum / win)); // compress: quiet notes count, the loudest does not swamp
  }
  const curve = new Float32Array(frames);
  let mean = 0;
  for (let f = 1; f < frames; f++) {
    curve[f] = Math.max(0, env[f] - env[f - 1]);
    mean += curve[f];
  }
  mean /= Math.max(1, frames);
  for (let f = 0; f < frames; f++) curve[f] -= mean;
  return { curve, hopsPerSecond: sampleRate / hop };
}

/** Normalised autocorrelation of `curve` for lags 0..maxLag (1 at lag 0, corrected for the shrinking overlap). */
function autocorrelation(curve: Float32Array, maxLag: number): Float32Array {
  const n = curve.length;
  const ac = new Float32Array(maxLag + 1);
  let energy = 0;
  for (let i = 0; i < n; i++) energy += curve[i] * curve[i];
  if (energy <= 0) return ac;
  for (let lag = 0; lag <= maxLag && lag < n; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += curve[i] * curve[i + lag];
    ac[lag] = (sum / (n - lag)) / (energy / n);
  }
  return ac;
}

const at = (ac: Float32Array, lag: number) => {
  const i = Math.floor(lag);
  if (i < 0 || i + 1 >= ac.length) return 0;
  const t = lag - i;
  return ac[i] * (1 - t) + ac[i + 1] * t;
};

/** How well the onsets repeat at this tempo: mean autocorrelation at 1, 2, 3 and 4 beats (those that fit). */
function combScore(ac: Float32Array, lagFrames: number): number {
  let sum = 0;
  let count = 0;
  for (let k = 1; k <= 4; k++) {
    const lag = lagFrames * k;
    if (lag >= ac.length - 1) break;
    sum += Math.max(0, at(ac, lag));
    count++;
  }
  return count >= 2 ? sum / count : 0;
}

const prior = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / PRIOR_CENTER) / PRIOR_WIDTH_OCTAVES) ** 2);

/** Whole-bar lengths of a sample of `seconds` that land in the tempo range (4/4). */
function loopCandidates(seconds: number, min: number, max: number): number[] {
  const out: number[] = [];
  for (let bars = 1; bars <= 128; bars *= 2) {
    const bpm = (bars * 4 * 60) / seconds;
    if (bpm >= min && bpm <= max) out.push(bpm);
  }
  // Odd bar counts (3, 6, 12 ...) are rare for loops but real: include them too.
  for (const bars of [3, 6, 12, 24]) {
    const bpm = (bars * 4 * 60) / seconds;
    if (bpm >= min && bpm <= max) out.push(bpm);
  }
  return out;
}

/** The strongest local maxima of the autocorrelation inside the lag range, as BPM (parabolic refinement). */
function peakCandidates(ac: Float32Array, hps: number, min: number, max: number, count = 5): number[] {
  const lo = Math.max(2, Math.floor((60 / max) * hps));
  const hi = Math.min(ac.length - 2, Math.ceil((60 / min) * hps));
  const peaks: { lag: number; v: number }[] = [];
  for (let l = lo; l <= hi; l++) {
    if (ac[l] > ac[l - 1] && ac[l] >= ac[l + 1] && ac[l] > 0) {
      const d = ac[l - 1] - 2 * ac[l] + ac[l + 1];
      const shift = d !== 0 ? (0.5 * (ac[l - 1] - ac[l + 1])) / d : 0;
      peaks.push({ lag: l + Math.max(-0.5, Math.min(0.5, shift)), v: ac[l] });
    }
  }
  return peaks
    .sort((a, b) => b.v - a.v)
    .slice(0, count)
    .map((p) => (60 * hps) / p.lag);
}

/**
 * Best tempo of mono PCM, or undefined when nothing repeats clearly enough (speech, pads, noise).
 * Candidates are re-tuned within +-2.5 % (decoders pad loops by a few ms, trimmed samples are not exact);
 * a whole-bar length is kept as is when it scores about as well as the re-tuned value.
 */
export function detectTempo(samples: Float32Array, sampleRate: number, opts: TempoOptions = {}): TempoGuess | undefined {
  const { minBpm = 70, maxBpm = 200, minConfidence = 0.2, maxSeconds = 60 } = opts;
  const used = samples.subarray(0, Math.min(samples.length, Math.floor(maxSeconds * sampleRate)));
  const seconds = used.length / sampleRate;
  if (seconds < 1) return undefined;
  const { curve, hopsPerSecond } = onsetCurve(used, sampleRate);
  if (crestFactor(curve) < MIN_CREST) return undefined; // no distinct hits: a drone, a pad, silence
  const maxLag = Math.min(curve.length - 1, Math.ceil((60 / minBpm) * hopsPerSecond * 4) + 2);
  const ac = autocorrelation(curve, maxLag);
  const score = (bpm: number) => combScore(ac, (60 / bpm) * hopsPerSecond);
  const weighted = (bpm: number) => score(bpm) * (0.4 + 0.6 * prior(bpm));

  const exact = loopCandidates(seconds, minBpm, maxBpm);
  const found = peakCandidates(ac, hopsPerSecond, minBpm, maxBpm);
  const candidates: { bpm: number; source: 'loop' | 'beat' }[] = [];
  for (const bpm of exact) {
    // Re-tune around the exact value; keep it when it is nearly as good (it is exact by construction).
    let tuned = bpm;
    for (let d = -0.025; d <= 0.0251; d += 0.0025) if (weighted(bpm * (1 + d)) > weighted(tuned)) tuned = bpm * (1 + d);
    candidates.push(weighted(bpm) >= 0.9 * weighted(tuned) ? { bpm, source: 'loop' } : { bpm: tuned, source: 'beat' });
  }
  for (const bpm of found) candidates.push({ bpm, source: 'beat' });

  let best: { bpm: number; source: 'loop' | 'beat'; w: number; score: number } | undefined;
  for (const c of candidates) {
    const w = weighted(c.bpm);
    if (!best || w > best.w) best = { ...c, w, score: score(c.bpm) };
  }
  if (!best || best.score < minConfidence) return undefined;
  if (best.source === 'beat') {
    // A whole-bar length close to the winner is exact by construction: prefer it when it scores about as well.
    const exactNear = candidates
      .filter((c) => c.source === 'loop' && Math.abs(c.bpm / best!.bpm - 1) < 0.03)
      .map((c) => ({ ...c, w: weighted(c.bpm), score: score(c.bpm) }))
      .sort((x, y) => y.w - x.w)[0];
    if (exactNear && exactNear.w >= 0.95 * best.w) best = exactNear;
  }
  return { bpm: Math.round(best.bpm * 100) / 100, confidence: Math.min(1, best.score), source: best.source };
}

/** Channels averaged to mono (so a hard-panned hit still counts). */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

/**
 * Producers work in whole BPM: a guess near one (149.82) is snapped to it (150), within 0.35 BPM, or within 1 % when the
 * sample is then a whole number of bars long. Otherwise a fractional tempo would make a loop drift against the song.
 */
export function snapTempo(bpm: number, seconds: number): number {
  const whole = Math.round(bpm);
  if (Math.abs(whole - bpm) <= 0.35) return whole;
  if (Math.abs(whole - bpm) / bpm > 0.01) return bpm;
  const bars = (seconds * whole) / 240;
  const nearest = Math.round(bars);
  return nearest >= 1 && Math.abs(bars - nearest) < 0.01 * nearest ? whole : bpm;
}
