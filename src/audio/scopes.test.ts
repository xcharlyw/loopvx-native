import { envelopeCurve, filterEnvelopeCurve, filterResponse, freqToX, lfoShape, lfoWindow, logFreqs, waveShape } from './scopes';

describe('waveShape', () => {
  it('draws one cycle of each shape within -1..1', () => {
    for (const w of ['sine', 'square', 'sawtooth', 'triangle'] as const) {
      const s = waveShape(w, 64);
      expect(s).toHaveLength(64);
      expect(Math.max(...s)).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.min(...s)).toBeGreaterThanOrEqual(-1 - 1e-9);
    }
  });
  it('has the right character', () => {
    const saw = waveShape('sawtooth', 64);
    expect(saw[0]).toBeCloseTo(-1);
    expect(saw[63]).toBeGreaterThan(0.9);
    const sq = waveShape('square', 64);
    expect(new Set(sq)).toEqual(new Set([1, -1]));
    expect(waveShape('triangle', 64)[0]).toBeCloseTo(-1);
    expect(waveShape('triangle', 64)[32]).toBeCloseTo(1);
    expect(waveShape('sine', 64)[16]).toBeCloseTo(1);
  });
  it('shifts by phase', () => {
    const a = waveShape('sine', 64, 0);
    const b = waveShape('sine', 64, 0.25);
    expect(b[0]).toBeCloseTo(a[16]);
    expect(waveShape('sine', 8, -0.25)[2]).toBeCloseTo(waveShape('sine', 8, 0.75)[2]);
  });
  it('lfo is a sine over the cycles asked for', () => {
    expect(lfoShape(32)[8]).toBeCloseTo(1);
    expect(lfoShape(32, 2)[4]).toBeCloseTo(1); // two cycles: the first peak comes twice as early
    expect(lfoShape(32, 2)[16]).toBeCloseTo(0);
  });
  it('the lfo window is as many bars as one cycle needs, with the cycles that fit', () => {
    expect(lfoWindow(1)).toEqual({ bars: 1, cycles: 1 });
    expect(lfoWindow(4)).toEqual({ bars: 1, cycles: 4 });
    expect(lfoWindow(16)).toEqual({ bars: 1, cycles: 16 });
    expect(lfoWindow(0.5)).toEqual({ bars: 2, cycles: 1 });
    expect(lfoWindow(0.25)).toEqual({ bars: 4, cycles: 1 });
    expect(lfoWindow(0)).toEqual({ bars: 1, cycles: 1 }); // no LFO: a calm default
    expect(lfoWindow(0.01).bars).toBe(8); // capped
  });
});

describe('filterResponse (the real biquad)', () => {
  const at = (type: 'lowpass' | 'highpass' | 'bandpass', cutoff: number, q: number, f: number) => filterResponse(type, cutoff, q, [f])[0];
  it('lowpass: flat below, 12 dB/octave above, dip of Q at the cutoff', () => {
    expect(at('lowpass', 1000, 0, 100)).toBeCloseTo(0, 0);
    expect(at('lowpass', 1000, 0, 1000)).toBeCloseTo(0, 0); // Q = 0 dB = 1.0: no peak
    expect(at('lowpass', 1000, 0, 2000)).toBeLessThan(-10);
    expect(at('lowpass', 1000, 0, 10000)).toBeLessThan(-35);
  });
  it('the resonance of lowpass and highpass is in dB: 12 dB resonance peaks 12 dB at the cutoff', () => {
    expect(at('lowpass', 1000, 12, 1000)).toBeCloseTo(12, 0);
    expect(at('highpass', 1000, 12, 1000)).toBeCloseTo(12, 0);
  });
  it('highpass: silent below, flat above', () => {
    expect(at('highpass', 1000, 0, 100)).toBeLessThan(-35);
    expect(at('highpass', 1000, 0, 10000)).toBeCloseTo(0, 0);
  });
  it('bandpass peaks at 0 dB at the cutoff with a plain Q', () => {
    expect(at('bandpass', 1000, 4, 1000)).toBeCloseTo(0, 0);
    expect(at('bandpass', 1000, 4, 100)).toBeLessThan(-15);
    expect(at('bandpass', 1000, 4, 10000)).toBeLessThan(-15);
    // a higher Q is narrower
    expect(at('bandpass', 1000, 12, 1300)).toBeLessThan(at('bandpass', 1000, 2, 1300));
  });
  it('stays finite at the extremes of the range', () => {
    for (const r of filterResponse('lowpass', 20000, 20, logFreqs(32))) expect(Number.isFinite(r)).toBe(true);
    for (const r of filterResponse('highpass', 20, 20, logFreqs(32))) expect(Number.isFinite(r)).toBe(true);
  });
});

describe('axes and envelopes', () => {
  it('log frequency axis runs 20 Hz to 20 kHz and maps back', () => {
    const f = logFreqs(5);
    expect(f[0]).toBeCloseTo(20);
    expect(f[4]).toBeCloseTo(20000);
    expect(freqToX(20)).toBeCloseTo(0);
    expect(freqToX(20000)).toBeCloseTo(1);
    expect(freqToX(Math.sqrt(20 * 20000))).toBeCloseTo(0.5);
    expect(freqToX(5)).toBe(0); // clamped
  });
  it('amplitude envelope: rises to 1, falls to the sustain, then releases to 0', () => {
    const e = envelopeCurve({ attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 }, 1);
    expect(e.points[0]).toEqual({ t: 0, v: 0 });
    expect(Math.max(...e.points.map((p) => p.v))).toBeCloseTo(1);
    const atHold = e.points.find((p) => Math.abs(p.t - 1) < 1e-9)!;
    expect(atHold.v).toBeCloseTo(0.5);
    expect(e.points.at(-1)).toEqual({ t: 1.3, v: 0 });
    expect(e.total).toBeCloseTo(1.3);
    expect(e.holdAt).toBe(1);
  });
  it('filter envelope falls from the raised cutoff back to the resting one', () => {
    const c = filterEnvelopeCurve(1000, 2, 0.4, 16);
    expect(c[0].x).toBeGreaterThan(c[15].x);
    expect(c[0].x).toBeCloseTo(freqToX(4000));
    expect(c[15].x).toBeCloseTo(freqToX(1000));
    expect(c[15].t).toBeCloseTo(0.4);
    expect(filterEnvelopeCurve(1000, 0, 0.4)[0].x).toBeCloseTo(freqToX(1000)); // no envelope: flat
  });
});
