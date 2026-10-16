import { levelOf, vocalGainDb } from './loudness';

const tone = (amp: number, n = 44100) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / 44100));

describe('vocal level matching', () => {
  it('measures the speech level without the pauses', () => {
    const speech = tone(0.5);
    const padded = new Float32Array(speech.length * 2);
    padded.set(speech);
    const a = levelOf([speech])!;
    const b = levelOf([padded])!;
    expect(b.rmsDb).toBeCloseTo(a.rmsDb, 1);
    expect(a.peakDb).toBeCloseTo(-6, 0);
  });
  it('lifts a quiet vocal and lowers a hot one towards the same level', () => {
    expect(vocalGainDb([tone(0.1)])).toBeGreaterThan(3);
    expect(vocalGainDb([tone(0.95)])).toBeLessThan(0);
  });
  it('never pushes the peak over the ceiling or beyond the clip gain range', () => {
    const quietWithSpike = tone(0.02);
    quietWithSpike[10] = 0.7;
    const g = vocalGainDb([quietWithSpike]);
    expect(20 * Math.log10(0.7) + g).toBeLessThanOrEqual(-1 + 0.25);
    expect(vocalGainDb([tone(0.0004)])).toBe(0);
    expect(vocalGainDb([tone(0.02)])).toBeLessThanOrEqual(6);
  });
  it('leaves silence and an already matched vocal alone', () => {
    expect(vocalGainDb([new Float32Array(1000)])).toBe(0);
    // a sine at -18 dBFS RMS has the amplitude 10^(-18/20) * sqrt(2) = 0.178
    expect(vocalGainDb([tone(0.178)])).toBe(0);
  });
});
