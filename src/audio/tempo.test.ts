import { detectTempo, onsetCurve, snapTempo, toMono } from './tempo';

const SR = 22050;

/** Seeded noise so tests are deterministic. */
function rng(seed = 1) {
  let a = seed;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296 - 0.5;
  };
}

interface LoopOpts {
  bpm: number;
  bars: number;
  kick?: boolean; // a kick on every beat
  hats?: boolean; // noise ticks on the off-beats
  sixteenths?: boolean; // hats on every 16th
  padSeconds?: number; // silence appended (decoder padding, trimmed export)
}

function loop({ bpm, bars, kick = true, hats = true, sixteenths = false, padSeconds = 0 }: LoopOpts): Float32Array {
  const beat = 60 / bpm;
  const out = new Float32Array(Math.round((bars * 4 * beat + padSeconds) * SR));
  const rand = rng(bpm);
  const add = (t: number, fn: (i: number) => number, len: number) => {
    const start = Math.round(t * SR);
    for (let i = 0; i < len && start + i < out.length; i++) out[start + i] += fn(i / SR);
  };
  for (let b = 0; b < bars * 4; b++) {
    if (kick) add(b * beat, (t) => 0.9 * Math.sin(2 * Math.PI * (55 + 120 * Math.exp(-t * 40)) * t) * Math.exp(-t * 14), Math.round(0.25 * SR));
    if (hats) add(b * beat + beat / 2, (t) => 0.4 * (rand() * 2) * Math.exp(-t * 90), Math.round(0.06 * SR));
    if (sixteenths) for (let q = 0; q < 4; q++) add(b * beat + (q * beat) / 4, (t) => 0.25 * (rand() * 2) * Math.exp(-t * 120), Math.round(0.03 * SR));
  }
  return out;
}

describe('detectTempo', () => {
  it.each([145, 150, 155, 160, 165, 175])('finds %d BPM of a clean four-bar loop', (bpm) => {
    const guess = detectTempo(loop({ bpm, bars: 4 }), SR)!;
    expect(guess.bpm).toBeCloseTo(bpm, 0);
    expect(guess.confidence).toBeGreaterThan(0.3);
  });

  it('is exact for loops cut on bars and says so', () => {
    const guess = detectTempo(loop({ bpm: 157, bars: 4 }), SR)!;
    expect(guess.source).toBe('loop');
    expect(guess.bpm).toBeCloseTo(157, 1);
  });

  it('survives decoder padding after the loop', () => {
    const guess = detectTempo(loop({ bpm: 150, bars: 2, padSeconds: 0.12 }), SR)!;
    expect(Math.abs(guess.bpm - 150) / 150).toBeLessThan(0.01);
  });

  it('works on one bar and on a long sample', () => {
    expect(detectTempo(loop({ bpm: 160, bars: 1 }), SR)!.bpm).toBeCloseTo(160, 0);
    expect(detectTempo(loop({ bpm: 148, bars: 16 }), SR)!.bpm).toBeCloseTo(148, 0);
  });

  it('chooses 150 over 75 and 300 for a kick on every beat', () => {
    const guess = detectTempo(loop({ bpm: 150, bars: 4, hats: false }), SR)!;
    expect(guess.bpm).toBeCloseTo(150, 0);
  });

  it('works without a kick (off-beat hats only) and with busy 16th hats', () => {
    expect(detectTempo(loop({ bpm: 160, bars: 4, kick: false }), SR)!.bpm).toBeCloseTo(160, 0);
    expect(detectTempo(loop({ bpm: 155, bars: 4, sixteenths: true }), SR)!.bpm).toBeCloseTo(155, 0);
  });

  it('gives up on noise, a held tone and silence', () => {
    const r = rng(9);
    const noise = Float32Array.from({ length: SR * 6 }, () => r() * 0.5);
    const tone = Float32Array.from({ length: SR * 6 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR));
    expect(detectTempo(noise, SR)).toBeUndefined();
    expect(detectTempo(tone, SR)).toBeUndefined();
    expect(detectTempo(new Float32Array(SR * 6), SR)).toBeUndefined();
  });

  it('refuses samples shorter than a second', () => {
    expect(detectTempo(loop({ bpm: 160, bars: 1 }).subarray(0, SR / 2), SR)).toBeUndefined();
  });

  it('respects a custom range', () => {
    const guess = detectTempo(loop({ bpm: 160, bars: 4 }), SR, { minBpm: 120, maxBpm: 180 })!;
    expect(guess.bpm).toBeCloseTo(160, 0);
  });
});

describe('helpers', () => {
  it('onset curve has zero mean and peaks at hits', () => {
    const { curve, hopsPerSecond } = onsetCurve(loop({ bpm: 120, bars: 2, hats: false }), SR);
    expect(hopsPerSecond).toBeGreaterThan(150);
    expect(Math.abs(curve.reduce((a, b) => a + b, 0) / curve.length)).toBeLessThan(1e-4);
    expect(Math.max(...curve)).toBeGreaterThan(0.2);
  });
  it('mixes channels to mono', () => {
    const m = toMono([Float32Array.of(1, 0), Float32Array.of(0, 1)]);
    expect(Array.from(m)).toEqual([0.5, 0.5]);
    const one = Float32Array.of(0.3);
    expect(toMono([one])).toBe(one);
  });
});

describe('snapTempo', () => {
  it('snaps a guess within 0.35 BPM to whole BPM', () => {
    expect(snapTempo(149.82, 3.2)).toBe(150);
    expect(snapTempo(160.3, 5)).toBe(160);
  });
  it('snaps a wider guess only when the sample is then whole bars long', () => {
    expect(snapTempo(150.6, (240 / 151) * 4)).toBe(151);
    expect(snapTempo(150.6, 3.5)).toBe(150.6);
  });
  it('leaves tempos far from a whole number alone', () => {
    expect(snapTempo(127.5, 7)).toBe(127.5);
    expect(snapTempo(97.5, 4)).toBe(97.5);
  });
});
