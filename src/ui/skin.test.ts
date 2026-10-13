import { gainToDb, ledSegments } from './skin';

describe('LED meter', () => {
  it('lights nothing for silence and everything at +3 dB', () => {
    expect(ledSegments(0, 20).some((s) => s.on)).toBe(false);
    expect(ledSegments(Math.pow(10, 3 / 20), 20).every((s) => s.on)).toBe(true);
  });
  it('lights up to the level, with yellow near and red above 0 dB', () => {
    const half = ledSegments(Math.pow(10, -24 / 20), 20); // -24 dB
    const lit = half.filter((s) => s.on).length;
    expect(lit).toBeGreaterThan(8);
    expect(lit).toBeLessThan(12);
    const colors = ledSegments(1, 20).map((s) => s.color);
    expect(colors[0]).toBe(colors[5]); // green at the bottom
    expect(new Set(colors).size).toBe(3);
    expect(colors[19]).not.toBe(colors[0]);
  });
  it('converts gain to dB', () => {
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(0)).toBe(-Infinity);
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 2);
  });
});
