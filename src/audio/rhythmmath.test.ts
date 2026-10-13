import { cycleStarts, kickstartCurve, kickstartShape, KICKSTART_CURVES, shaperCurve, shaperShape, SHAPER_SHAPES, transientCurve, transientGainDb, logCurve, TRANSIENT_RANGE_DB } from './rhythmmath';

describe('Kickstart', () => {
  it('every curve starts ducked and ends at full level', () => {
    KICKSTART_CURVES.forEach((_, c) => {
      expect(kickstartShape(c, 0)).toBeCloseTo(0, 2);
      expect(kickstartShape(c, 1)).toBeGreaterThan(0.99);
      for (let t = 0; t < 1; t += 0.05) expect(kickstartShape(c, t + 0.05)).toBeGreaterThanOrEqual(kickstartShape(c, t) - 1e-9); // never dips back
    });
  });
  it('mix sets the depth', () => {
    const full = kickstartCurve(0, 1);
    const half = kickstartCurve(0, 0.5);
    expect(full[0]).toBeCloseTo(0, 5);
    expect(half[0]).toBeCloseTo(0.5, 5);
    expect(kickstartCurve(0, 0).every((v) => v === 1)).toBe(true);
    expect(full[full.length - 1]).toBeGreaterThan(0.99);
  });
  it('snappy recovers faster than classic, lang slowest', () => {
    expect(kickstartShape(1, 0.2)).toBeGreaterThan(kickstartShape(0, 0.2));
    expect(kickstartShape(3, 0.2)).toBeLessThan(kickstartShape(0, 0.2));
  });
});

describe('Shaper', () => {
  it('keeps every shape within 0..1 and gates without hard steps', () => {
    SHAPER_SHAPES.forEach((_, s) => {
      let maxJump = 0;
      let prev = shaperShape(s, 0);
      for (let i = 1; i <= 2000; i++) {
        const v = shaperShape(s, i / 2000);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        if (s >= 2) maxJump = Math.max(maxJump, Math.abs(v - prev)); // saws wrap once per cycle by design
        prev = v;
      }
      expect(maxJump).toBeLessThan(0.5);
    });
  });
  it('maps to the target: gain, cutoff in Hz, pan', () => {
    const vol = shaperCurve({ target: 0, shape: 1, depth: 1, cutoff: 8000 });
    expect(vol[0]).toBeCloseTo(0, 2);
    expect(vol[vol.length - 1]).toBeGreaterThan(0.98);
    const filt = shaperCurve({ target: 1, shape: 1, depth: 1, cutoff: 8000 });
    expect(filt[0]).toBeCloseTo(8000 / 128, 0);
    expect(filt[filt.length - 1]).toBeGreaterThan(7500);
    const pan = shaperCurve({ target: 2, shape: 2, depth: 0.5, cutoff: 8000 });
    expect(Math.max(...pan)).toBeCloseTo(0.5, 2);
    expect(Math.min(...pan)).toBeCloseTo(-0.5, 2);
  });
  it('lists cycle starts on the grid', () => {
    expect(cycleStarts(0, 1, 0.25)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(cycleStarts(0.1, 1, 0.25)).toEqual([0.25, 0.5, 0.75]);
    expect(cycleStarts(3, 7, 2)).toEqual([4, 6]);
  });
});

describe('Transient shaper', () => {
  it('boosts attacks and cuts the tail by the knob amounts, limited to 12 dB', () => {
    expect(transientGainDb(8, 100, 0)).toBeCloseTo(6, 5);
    expect(transientGainDb(-8, 0, -100)).toBeCloseTo(-6, 5);
    expect(transientGainDb(40, 100, 0)).toBe(12);
    expect(transientGainDb(8, 0, 100)).toBe(0);
  });
  it('builds a neutral curve at 0 / 0 and a log detector', () => {
    expect(transientCurve(0, 0).every((v) => Math.abs(v - 1) < 1e-9)).toBe(true);
    const log = logCurve(4097);
    expect(log[4096]).toBeCloseTo(0, 6); // 0 dBFS
    expect(log[2048]).toBe(-1); // silence clamps to the floor
    expect(log[Math.round(2048 + 0.5 * 2048)] * TRANSIENT_RANGE_DB).toBeCloseTo(-6.02, 1);
  });
});
