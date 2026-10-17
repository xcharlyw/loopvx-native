import { detectOnsets, gridOnsets, sliceBars, toSlices } from './slicing';

const SR = 22050;

/** A sine burst with an exponential decay at each time, over silence. */
function burst(times: number[], seconds: number, opts: { freq?: number; gain?: number[] } = {}): Float32Array {
  const data = new Float32Array(Math.round(seconds * SR));
  times.forEach((t, k) => {
    const at = Math.round(t * SR);
    const g = opts.gain?.[k] ?? 1;
    for (let i = 0; i < 0.12 * SR && at + i < data.length; i++) data[at + i] += g * Math.exp(-i / (0.03 * SR)) * Math.sin((2 * Math.PI * (opts.freq ?? 120) * i) / SR);
  });
  return data;
}

describe('detectOnsets', () => {
  it('finds the hits of a four-on-the-floor kick pattern to within 10 ms', () => {
    const hits = [0, 0.4, 0.8, 1.2];
    const found = detectOnsets(burst(hits, 1.6), SR);
    expect(found).toHaveLength(4);
    found.forEach((t, i) => expect(Math.abs(t - hits[i])).toBeLessThan(0.012));
  });
  it('finds offbeat hats between the kicks', () => {
    const data = burst([0, 0.4, 0.8, 1.2], 1.6);
    const hats = burst([0.2, 0.6, 1.0, 1.4], 1.6, { freq: 6000, gain: [0.6, 0.6, 0.6, 0.6] });
    for (let i = 0; i < data.length; i++) data[i] += hats[i];
    const found = detectOnsets(data, SR);
    expect(found).toHaveLength(8);
  });
  it('starts at 0 even when the first hit comes late', () => {
    const found = detectOnsets(burst([0.3, 0.7], 1.2), SR);
    expect(found[0]).toBe(0);
    expect(found).toHaveLength(3);
  });
  it('returns just 0 for silence', () => {
    expect(detectOnsets(new Float32Array(SR), SR)).toEqual([0]);
  });
  it('a higher sensitivity finds quieter hits', () => {
    // a steady bass bed with loud hits and weak hits on top of it: the weak ones only rise a few dB
    const data = burst([0, 0.4, 0.8, 1.2], 1.6, { gain: [1, 0.35, 1, 0.35] });
    for (let i = 0; i < data.length; i++) data[i] += 0.12 * Math.sin((2 * Math.PI * 80 * i) / SR);
    const low = detectOnsets(data, SR, { sensitivity: 0 });
    const high = detectOnsets(data, SR, { sensitivity: 1 });
    expect(low).toHaveLength(2);
    // every real hit is found (the bed beating against the hit can add one more)
    for (const t of [0, 0.4, 0.8, 1.2]) expect(high.some((f) => Math.abs(f - t) < 0.015)).toBe(true);
  });
  it('keeps hits apart by the minimum gap and caps the number of slices', () => {
    const many = Array.from({ length: 40 }, (_, i) => i * 0.1);
    const found = detectOnsets(burst(many, 4.2), SR, { minGapMs: 80 });
    expect(found.length).toBeLessThanOrEqual(32);
    for (let i = 1; i < found.length; i++) expect(found[i] - found[i - 1]).toBeGreaterThanOrEqual(0.079);
    expect(detectOnsets(burst(many, 4.2), SR, { max: 8 })).toHaveLength(8);
  });
});

describe('gridOnsets', () => {
  it('cuts a bar at 150 BPM into 16ths', () => {
    const g = gridOnsets(1.6, 150, 16);
    expect(g).toHaveLength(16);
    expect(g[1]).toBeCloseTo(0.1, 6);
  });
  it('covers several bars and stops at the cap', () => {
    expect(gridOnsets(3.2, 150, 4)).toHaveLength(8);
    expect(gridOnsets(32, 150, 16)).toHaveLength(32);
  });
  it('is just 0 for bad input', () => {
    expect(gridOnsets(0, 150, 4)).toEqual([0]);
    expect(gridOnsets(1, 0, 4)).toEqual([0]);
  });
});

describe('toSlices', () => {
  it('tiles the sample from 0 to its end', () => {
    expect(toSlices([0, 0.5, 1], 1.5)).toEqual([{ start: 0, end: 0.5 }, { start: 0.5, end: 1 }, { start: 1, end: 1.5 }]);
  });
  it('adds 0, sorts, dedupes and drops tiny slices and starts beyond the end', () => {
    expect(toSlices([1, 0.5, 0.5, 0.505, 9], 1.5)).toEqual([{ start: 0, end: 0.5 }, { start: 0.5, end: 1 }, { start: 1, end: 1.5 }]);
  });
  it('snaps a start inside the first 20 ms to 0', () => {
    expect(toSlices([0.01, 0.5], 1)[0]).toEqual({ start: 0, end: 0.5 });
  });
});

describe('sliceBars', () => {
  it('warps the slice to the project tempo', () => {
    // a loop of 2 bars at 140 BPM played at 150: each second of the loop lasts 140/150 s
    const bar150 = 240 / 150;
    const at = sliceBars({ start: 240 / 140, end: 480 / 140 }, 140, 150);
    expect(at.start).toBeCloseTo(1, 6);
    expect(at.length).toBeCloseTo(1, 6);
    expect(bar150).toBe(1.6);
  });
  it('plays at original speed without a sample tempo', () => {
    expect(sliceBars({ start: 1.6, end: 3.2 }, undefined, 150)).toEqual({ start: 1, length: 1 });
  });
});
