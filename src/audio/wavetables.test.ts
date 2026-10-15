import { TABLES, tableFrame, tableSpectrum } from './wavetables';

const mag = (s: { real: Float32Array; imag: Float32Array }, k: number) => Math.hypot(s.real[k], s.imag[k]);

describe('wavetables', () => {
  it('basic: a sine at the start, a square (odd harmonics only) at the end', () => {
    const start = tableSpectrum('basic', 0);
    expect(mag(start, 1)).toBeCloseTo(1, 3);
    expect(mag(start, 2)).toBeLessThan(0.001);
    expect(mag(start, 3)).toBeLessThan(0.001);
    const end = tableSpectrum('basic', 1);
    expect(mag(end, 2)).toBeLessThan(0.01);
    expect(mag(end, 3)).toBeCloseTo(1 / 3, 1);
  });

  it('basic: the saw in the middle has every harmonic falling as 1/n', () => {
    const s = tableSpectrum('basic', 2 / 3);
    expect(mag(s, 2)).toBeCloseTo(0.5, 1);
    expect(mag(s, 4)).toBeCloseTo(0.25, 1);
  });

  it('harmonics: the frame opens up along the position', () => {
    expect(mag(tableSpectrum('harm', 0), 2)).toBeLessThan(0.01);
    expect(mag(tableSpectrum('harm', 1), 20)).toBeGreaterThan(0.03);
  });

  it('acid: the resonance peak moves up with the position', () => {
    const peakOf = (pos: number) => {
      const s = tableSpectrum('acid', pos);
      let best = 2;
      for (let k = 2; k < 40; k++) if (mag(s, k) > mag(s, best)) best = k;
      return best;
    };
    expect(peakOf(0.2)).toBeLessThan(peakOf(0.8));
  });

  it('every table gives a usable, normalised, DC-free spectrum at every position', () => {
    for (const t of TABLES)
      for (const pos of [0, 0.5, 1]) {
        const s = tableSpectrum(t.id, pos);
        expect(s.real[0]).toBe(0);
        const peak = Math.max(...Array.from({ length: 128 }, (_, i) => mag(s, i + 1)));
        expect(peak).toBeCloseTo(1, 5);
        expect(tableFrame(t.id, pos, 64).every((v) => Number.isFinite(v) && Math.abs(v) <= 1.0001)).toBe(true);
      }
  });

  it('fold and screech get brighter with the position', () => {
    const bright = (id: string, pos: number) => {
      const s = tableSpectrum(id, pos);
      let hi = 0;
      for (let k = 6; k <= 64; k++) hi += mag(s, k) ** 2;
      return hi;
    };
    expect(bright('fold', 1)).toBeGreaterThan(bright('fold', 0) * 10);
    expect(bright('screech', 1)).toBeGreaterThan(bright('screech', 0));
  });
});
