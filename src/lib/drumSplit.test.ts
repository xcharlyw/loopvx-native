import { biquad, clickWindow, cutOneShot, hitTimesMs, kickOnsetsMs, makeDrumSplitter, pickCleanHit, splitBands, transcribeDrums } from './drumSplit';

const SR = 22050;
const BPM = 150;

/** Synthetic hard techno drums: kick on every beat, clap on 2 and 4 (with the kick), closed hats on the offbeats. */
function drums(bars: number, lead = 0, claps = true) {
  const beat = (60 / BPM) * SR;
  const x = new Float32Array(Math.round(bars * 4 * beat + lead * SR + SR));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const add = (at: number, len: number, f: (i: number) => number) => {
    for (let i = 0; i < len && at + i < x.length; i++) x[at + i] += f(i);
  };
  for (let b = 0; b < bars * 4; b++) {
    const at = Math.round(lead * SR + b * beat);
    add(at, Math.round(0.15 * SR), (i) => 0.8 * Math.sin((2 * Math.PI * 55 * i) / SR) * Math.exp(-i / (0.05 * SR)));
    if (claps && b % 2 === 1) add(at, Math.round(0.08 * SR), (i) => 0.4 * Math.sin((2 * Math.PI * 1800 * i) / SR + rnd() * 3) * Math.exp(-i / (0.02 * SR)));
    const off = Math.round(at + beat / 2);
    let last = 0;
    add(off, Math.round(0.03 * SR), (i) => {
      const n = rnd();
      const hp = n - last; // differenced noise = mostly highs
      last = n;
      return 0.25 * hp * Math.exp(-i / (0.008 * SR));
    });
  }
  return x;
}

describe('drum split', () => {
  it('splits a stem into three bands that each keep their instrument', () => {
    const x = drums(1);
    const b = splitBands(x, SR);
    const rms = (v: Float32Array) => Math.sqrt(v.reduce((s, y) => s + y * y, 0) / v.length);
    expect(rms(b.kick)).toBeGreaterThan(rms(b.hat) * 3);
    expect(b.kick.length).toBe(x.length);
  });

  it('writes the groove as 909 MIDI on the 16th grid', () => {
    const t = transcribeDrums(drums(4), SR, BPM);
    const at = (pitch: number) => [...new Set(t.notes.filter((n) => n.pitch === pitch).map((n) => Math.round((n.start * 16) % 16)))].sort((a, b) => a - b);
    expect(at(36)).toEqual([0, 4, 8, 12]);
    expect(at(39)).toEqual([4, 12]);
    expect(at(42)).toEqual([2, 6, 10, 14]);
    expect(t.notes.filter((n) => n.pitch === 36)).toHaveLength(16);
  });

  it('finds the first beat when the audio starts late and a slightly wrong tempo', () => {
    const t = transcribeDrums(drums(4, 0.13), SR, BPM + 0.2);
    expect(Math.abs(t.bpm - BPM)).toBeLessThan(0.06);
    expect(Math.abs(t.phaseMs - 130)).toBeLessThan(6);
    expect(t.notes.filter((n) => n.pitch === 36)).toHaveLength(16);
  });

  it('finds no claps in drums without claps', () => {
    const t = transcribeDrums(drums(4, 0, false), SR, BPM);
    expect(t.notes.filter((n) => n.pitch === 39)).toHaveLength(0);
    expect(t.notes.filter((n) => n.pitch === 36)).toHaveLength(16);
  });

  it('starts bar 1 at the first kick and cuts what comes before', () => {
    const t = transcribeDrums(drums(4, 0.13), SR, BPM);
    expect(Math.abs(t.downbeatMs - 130)).toBeLessThan(6);
    expect(t.notes[0]).toMatchObject({ pitch: 36, start: 0 });
  });

  it('measures the exact tempo at 22.05 kHz (no 0.2 % tick error)', () => {
    const t = transcribeDrums(drums(8, 0.5), SR, BPM);
    expect(Math.abs(t.bpm - BPM)).toBeLessThan(0.03);
    expect(Math.abs(t.downbeatMs - 500)).toBeLessThan(6);
  });
});

describe('kick click', () => {
  /** Kicks on every beat: a 55 Hz body plus a 3 ms burst of 3 kHz "click" at the onset; hats on the offbeats; the click has hat-like highs too. */
  function kicksWithClick(bars: number) {
    const beat = (60 / BPM) * SR;
    const x = new Float32Array(Math.round(bars * 4 * beat + SR));
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const onsets: number[] = [];
    for (let b = 0; b < bars * 4; b++) {
      const at = Math.round(b * beat) + 200;
      onsets.push((at / SR) * 1000);
      for (let i = 0; i < Math.round(0.15 * SR); i++) x[at + i] += 0.8 * Math.sin((2 * Math.PI * 55 * i) / SR) * Math.exp(-i / (0.05 * SR));
      for (let i = 0; i < Math.round(0.003 * SR); i++) x[at + i] += 0.5 * Math.sin((2 * Math.PI * 3000 * i) / SR) * (1 - i / (0.003 * SR)) + 0.2 * rnd();
      const off = Math.round(at + beat / 2);
      for (let i = 0; i < Math.round(0.03 * SR); i++) x[off + i] += 0.25 * rnd() * Math.exp(-i / (0.008 * SR));
    }
    return { x, onsets };
  }
  const energy = (v: Float32Array, from: number, to: number) => {
    let s = 0;
    for (let i = from; i < to; i++) s += v[i] * v[i];
    return s;
  };
  const highs = (x: Float32Array) => {
    const c = biquad('highpass', 2000, Math.SQRT1_2, SR);
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  };

  it('finds the kick onsets', () => {
    const { x, onsets } = kicksWithClick(2);
    const found = kickOnsetsMs(x, SR);
    expect(found).toHaveLength(onsets.length);
    found.forEach((f, i) => expect(Math.abs(f - onsets[i])).toBeLessThan(4));
  });

  it('keeps the click with the kick and takes it out of the hats', () => {
    const { x, onsets } = kicksWithClick(2);
    const plainKick = splitBands(x, SR).kick;
    const split = makeDrumSplitter([x], SR);
    const kick = split.part('kick')[0];
    const hat = split.part('hat')[0];
    const at = Math.round((onsets[1] / 1000) * SR);
    const win = [at, at + Math.round(0.005 * SR)] as const;
    const click = energy(highs(x), ...win);
    // the plain low band has lost the click, the new kick part has it back
    expect(energy(highs(plainKick), ...win)).toBeLessThan(click * 0.05);
    expect(energy(highs(kick), ...win)).toBeGreaterThan(click * 0.6);
    // the hats band has none of the kick's click (the plain high band had it)
    expect(energy(splitBands(x, SR).hat, ...win)).toBeGreaterThan(click * 0.05);
    expect(energy(hat, ...win)).toBeLessThan(energy(splitBands(x, SR).hat, ...win) * 0.1);
  });

  it('leaves the hats between the kicks alone', () => {
    const { x, onsets } = kicksWithClick(2);
    const split = makeDrumSplitter([x], SR);
    const hat = split.part('hat')[0];
    const plain = splitBands(x, SR).hat;
    const off = Math.round(((onsets[1] + 60000 / BPM / 2) / 1000) * SR);
    expect(energy(hat, off, off + 400)).toBeCloseTo(energy(plain, off, off + 400), 5);
  });

  it('builds smooth windows', () => {
    const w = clickWindow(20000, 10000, [50]); // 10 samples per ms, onset at sample 500
    expect(w[500]).toBe(1);
    expect(w[540]).toBe(1);
    expect(w[100]).toBe(0);
    expect(w[1000]).toBe(0);
    expect(w[490]).toBeGreaterThan(0);
    expect(w[490]).toBeLessThan(1);
    expect(w[565]).toBeGreaterThan(0);
    expect(w[565]).toBeLessThan(1);
  });
});

describe('clean one-shots', () => {
  const x = drums(4);
  const t = transcribeDrums(x, SR, BPM);

  it('hitTimesMs puts every transcribed note on the tune clock', () => {
    const times = hitTimesMs(t);
    expect(times.kick.length).toBeGreaterThanOrEqual(14);
    const beatMs = 60000 / BPM;
    const rel = (times.kick[1] - times.kick[0]) / beatMs;
    expect(Math.abs(rel - 1)).toBeLessThan(0.02);
  });

  it('picks a kick hit that sits on a beat', () => {
    const times = hitTimesMs(t);
    const at = pickCleanHit(splitBands(x, SR), SR, 'kick', times.kick);
    expect(at).toBeDefined();
    const beatMs = 60000 / BPM;
    const off = ((at! - times.kick[0]) / beatMs) % 1;
    expect(Math.min(off, 1 - off)).toBeLessThan(0.03);
  });

  it('returns nothing when there are no hits', () => {
    expect(pickCleanHit(splitBands(x, SR), SR, 'hat', [])).toBeUndefined();
  });

  it('cuts a short faded hit with peak 0.95', () => {
    const at = hitTimesMs(t).kick[0];
    const cut = cutOneShot('kick', [x, x], SR, at);
    expect(cut).toHaveLength(2);
    const len = cut[0].length;
    expect(len).toBeLessThanOrEqual(Math.round(0.261 * SR));
    expect(len).toBeGreaterThan(Math.round(0.2 * SR));
    expect(Math.max(...Array.from(cut[0]).map(Math.abs))).toBeCloseTo(0.95, 2);
    expect(Math.abs(cut[0][len - 1])).toBeLessThan(0.01);
  });
});
