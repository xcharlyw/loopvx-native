import { splitBands, transcribeDrums } from './drumSplit';

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
