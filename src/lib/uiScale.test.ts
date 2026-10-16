import { clampUiScale, scaledSize, unscaleDrag } from './uiScale';

describe('ui scale', () => {
  it('snaps to an allowed level and treats junk as normal', () => {
    expect(clampUiScale(0.87)).toBe(0.9);
    expect(clampUiScale(0.5)).toBe(0.7);
    expect(clampUiScale(3)).toBe(1);
    expect(clampUiScale('x')).toBe(1);
    expect(clampUiScale(NaN)).toBe(1);
  });

  it('gives the zoomed interface more room', () => {
    expect(scaledSize({ width: 1400, height: 900 }, 0.8)).toEqual({ width: 1750, height: 1125 });
    expect(scaledSize({ width: 390, height: 844 }, 1)).toEqual({ width: 390, height: 844 });
  });

  it('a screen drag is longer in the zoomed interface', () => {
    expect(unscaleDrag(80, 0.8)).toBeCloseTo(100);
    expect(unscaleDrag(80, 1)).toBe(80);
  });
});
