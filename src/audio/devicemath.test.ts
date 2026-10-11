import {
  biquadCoeffs,
  bandResponse,
  cascadeResponse,
  compCurve,
  compGainDb,
  chorusSwing,
  echoSeconds,
  eqBands,
  limitedLevel,
  satCurve,
  satPreGain,
  saturate,
  SAT_RANGE,
} from './devicemath';
import { DEVICE_DEFS, deviceParams } from './devices';
import { logFreqs } from './scopes';

const flatEq = () => deviceParams({ type: 'eq', params: {} });

describe('band responses', () => {
  it('a bell boosts at its centre and is flat far away', () => {
    const [centre, far] = bandResponse({ kind: 'peaking', freq: 1000, q: 1, gainDb: 9 }, [1000, 20, 20000]);
    expect(centre).toBeCloseTo(9, 1);
    expect(Math.abs(far)).toBeLessThan(0.5);
  });

  it('a narrow bell is narrower than a wide one', () => {
    const at = (q: number) => bandResponse({ kind: 'peaking', freq: 1000, q, gainDb: 12 }, [2000])[0];
    expect(at(8)).toBeLessThan(at(0.5));
  });

  it('shelves reach their gain on their side only', () => {
    const [lowLow, lowHigh] = bandResponse({ kind: 'lowshelf', freq: 200, q: 0, gainDb: 12 }, [20, 10000]);
    expect(lowLow).toBeCloseTo(12, 0);
    expect(Math.abs(lowHigh)).toBeLessThan(0.2);
    const [highHigh, highLow] = bandResponse({ kind: 'highshelf', freq: 4000, q: 0, gainDb: -9 }, [18000, 100]);
    expect(highHigh).toBeCloseTo(-9, 0);
    expect(Math.abs(highLow)).toBeLessThan(0.2);
  });

  it('zero gain is exactly flat', () => {
    for (const kind of ['peaking', 'lowshelf', 'highshelf'] as const) {
      for (const db of bandResponse({ kind, freq: 800, q: 2, gainDb: 0 }, logFreqs(24))) expect(Math.abs(db)).toBeLessThan(1e-9);
    }
  });

  it('coefficients are normalised', () => {
    expect(biquadCoeffs({ kind: 'peaking', freq: 500, q: 1, gainDb: 6 }).a[0]).toBe(1);
  });

  it('a Butterworth lowpass is 3 dB down at the cutoff', () => {
    expect(bandResponse({ kind: 'lowpass', freq: 1000, q: -3.0103, gainDb: 0 }, [1000])[0]).toBeCloseTo(-3.01, 1);
  });
});

describe('EQ bands', () => {
  it('a fresh EQ is flat across the spectrum', () => {
    for (const db of cascadeResponse(eqBands(flatEq()), logFreqs(64))) expect(Math.abs(db)).toBeLessThan(0.1);
  });

  it('low cut and high cut shape the ends; bands add up', () => {
    const p = { ...flatEq(), hp: 100, lp: 8000, p1G: 6, p1F: 1000 };
    const [sub, mid, top] = cascadeResponse(eqBands(p), [30, 1000, 16000]);
    expect(sub).toBeLessThan(-20);
    expect(mid).toBeGreaterThan(5);
    expect(top).toBeLessThan(-6);
  });

  it('always six filters, parked when unused', () => {
    const bands = eqBands(flatEq());
    expect(bands.map((b) => b.kind)).toEqual(['highpass', 'lowshelf', 'peaking', 'peaking', 'highshelf', 'lowpass']);
    expect(bands[0].freq).toBeLessThan(10);
    expect(bands[5].freq).toBeGreaterThan(22050);
  });
});

describe('compressor gain computer', () => {
  const opts = { threshold: -20, ratio: 4, knee: 0 };

  it('leaves quiet signals alone and squeezes loud ones by the ratio', () => {
    expect(compGainDb(-30, opts)).toBe(0);
    expect(compGainDb(-20, opts)).toBe(0);
    // 8 dB over the threshold at 4:1 leaves 2 dB over: 6 dB of reduction
    expect(compGainDb(-12, opts)).toBeCloseTo(-6, 6);
    // output level grows by 1/4 dB per input dB above the threshold
    expect(-12 + compGainDb(-12, opts)).toBeCloseTo(-18, 6);
  });

  it('ratio 1 does nothing; a huge ratio limits', () => {
    expect(compGainDb(-3, { ...opts, ratio: 1 })).toBe(0);
    expect(-3 + compGainDb(-3, { ...opts, ratio: 20 })).toBeCloseTo(-20 + 17 / 20, 6);
  });

  it('a soft knee eases in: continuous, monotone, between nothing and the hard value', () => {
    const soft = { ...opts, knee: 10 };
    expect(compGainDb(-26, soft)).toBe(0);
    expect(compGainDb(-20, soft)).toBeLessThan(0); // already working at the threshold
    expect(compGainDb(-20, soft)).toBeGreaterThan(compGainDb(-20, { ...soft, knee: 0 }) - 1e-9 - 5);
    let prev = 0;
    for (let l = -40; l <= 0; l += 0.25) {
      const g = compGainDb(l, soft);
      expect(g).toBeLessThanOrEqual(prev + 1e-9);
      prev = g;
    }
    // at the edge of the knee both formulas agree
    expect(compGainDb(-15 - 1e-6, soft)).toBeCloseTo(compGainDb(-15 + 1e-6, soft), 4);
    expect(compGainDb(-25 - 1e-6, soft)).toBeCloseTo(compGainDb(-25 + 1e-6, soft), 4);
  });

  it('the shaper curve holds the linear gain per detector level', () => {
    const curve = compCurve(opts, 4097);
    const at = (level: number) => curve[Math.round(((level + 1) / 2) * 4096)];
    expect(at(0.01)).toBeCloseTo(1, 6); // -40 dB: untouched
    expect(at(1)).toBeCloseTo(Math.pow(10, compGainDb(0, opts) / 20), 3); // 0 dBFS
    expect(at(-0.5)).toBeCloseTo(at(0.5), 6); // symmetric: only the magnitude counts
    expect(at(0.5)).toBeLessThan(1);
  });
});

describe('saturator', () => {
  it('soft saturation is odd, bounded and monotone', () => {
    expect(saturate(0, 0)).toBe(0);
    expect(saturate(-2, 0)).toBeCloseTo(-saturate(2, 0), 12);
    expect(saturate(10, 0)).toBeLessThanOrEqual(1);
    expect(saturate(0.5, 0)).toBeLessThan(saturate(1, 0));
  });

  it('hard clips at one, fold comes back down', () => {
    expect(saturate(3, 1)).toBe(1);
    expect(saturate(-3, 1)).toBe(-1);
    expect(saturate(0.3, 1)).toBe(0.3);
    expect(saturate(1, 2)).toBeCloseTo(1, 12);
    expect(saturate(2, 2)).toBeCloseTo(0, 12);
    expect(saturate(3, 2)).toBeCloseTo(-1, 12);
  });

  it('tube is asymmetric (even harmonics) with unit slope at the origin', () => {
    expect(saturate(0, 3)).toBeCloseTo(0, 12);
    expect(saturate(1, 3) + saturate(-1, 3)).not.toBeCloseTo(0, 2);
    expect((saturate(1e-4, 3) - saturate(-1e-4, 3)) / 2e-4).toBeCloseTo(1, 3);
  });

  it('the curve maps the driven signal and stays bounded', () => {
    for (const mode of [0, 1, 2, 3]) {
      const c = satCurve(mode, 1025);
      expect(c.length).toBe(1025);
      for (const v of c) expect(Math.abs(v)).toBeLessThanOrEqual(1.6);
      // x = 1 (index at 1/16 of the half range) matches the function
      const i = Math.round((1 / SAT_RANGE / 2 + 0.5) * 1024);
      expect(c[i]).toBeCloseTo(saturate(((i / 1024) * 2 - 1) * SAT_RANGE, mode), 6);
    }
  });

  it('pre gain turns the drive into curve position: 0 dB at full scale is x = 1', () => {
    expect(satPreGain(0) * SAT_RANGE).toBeCloseTo(1, 12);
    expect(satPreGain(20) * SAT_RANGE).toBeCloseTo(10, 9);
  });
});

describe('time based', () => {
  it('echo follows the tempo: dotted eighth at 150 BPM is 300 ms', () => {
    expect(echoSeconds({ sync: 1, division: 2, time: 999 }, 150)).toBeCloseTo(0.3, 6);
    expect(echoSeconds({ sync: 1, division: 3, time: 999 }, 120)).toBeCloseTo(0.5, 6);
    expect(echoSeconds({ sync: 1, division: 6, time: 999 }, 160)).toBeCloseTo(1.5, 6);
  });

  it('free echo uses milliseconds and stays inside the delay line', () => {
    expect(echoSeconds({ sync: 0, division: 2, time: 375 }, 150)).toBeCloseTo(0.375, 6);
    expect(echoSeconds({ sync: 0, division: 0, time: 5 }, 150)).toBe(0.01);
    expect(echoSeconds({ sync: 1, division: 6, time: 0 }, 40)).toBe(3.5);
  });

  it('chorus swing never reaches below zero delay', () => {
    expect(chorusSwing(1, 1)).toBeLessThanOrEqual(0.0005 + 1e-12);
    expect(chorusSwing(1, 1)).toBeGreaterThanOrEqual(0);
    expect(chorusSwing(0, 10)).toBeCloseTo(0.0005, 6);
    expect(chorusSwing(1, 10)).toBeGreaterThan(chorusSwing(0.2, 10));
  });
});

describe('limiter', () => {
  it('passes quiet signals at the ceiling-scaled level and never exceeds the ceiling', () => {
    expect(limitedLevel(0.5, 0, 0)).toBeCloseTo(0.5, 6);
    for (const a of [0.5, 1, 2, 8]) expect(limitedLevel(a, 12, -1)).toBeLessThan(Math.pow(10, -1 / 20) + 1e-9);
    expect(limitedLevel(0.5, 12, -1)).toBeGreaterThan(0.5);
  });
});

describe('definitions agree with the math', () => {
  it('every EQ parameter the math reads exists', () => {
    const keys = DEVICE_DEFS.eq.params.map((p) => p.key);
    for (const k of ['hp', 'lsF', 'lsG', 'p1F', 'p1G', 'p1Q', 'p2F', 'p2G', 'p2Q', 'hsF', 'hsG', 'lp']) expect(keys).toContain(k);
  });
});
