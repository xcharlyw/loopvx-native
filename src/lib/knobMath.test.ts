import { arcPath, dragToT, fillRange, KNOB_DRAG_PX, polar, snapValue, tToDeg, tToValue, valueToT } from './knobMath';

describe('value <-> dial position', () => {
  it('linear is proportional and round-trips', () => {
    expect(valueToT(0.5, 0, 1)).toBe(0.5);
    expect(valueToT(-50, -50, 50)).toBe(0);
    expect(valueToT(0, -50, 50)).toBe(0.5);
    for (const v of [0, 0.25, 0.7, 1]) expect(tToValue(valueToT(v, 0, 1), 0, 1)).toBeCloseTo(v);
  });
  it('log puts the geometric middle at half way', () => {
    expect(valueToT(Math.sqrt(40 * 16000), 40, 16000, 'log')).toBeCloseTo(0.5);
    expect(tToValue(0.5, 40, 16000, 'log')).toBeCloseTo(Math.sqrt(40 * 16000));
    expect(tToValue(valueToT(1234, 40, 16000, 'log'), 40, 16000, 'log')).toBeCloseTo(1234);
  });
  it('clamps values outside the range and survives a flat range', () => {
    expect(valueToT(99, 0, 1)).toBe(1);
    expect(valueToT(-99, 0, 1)).toBe(0);
    expect(valueToT(5, 3, 3)).toBe(0);
    expect(tToValue(5, 0, 10)).toBe(10);
  });
});

describe('dragging', () => {
  it('up turns it up, down turns it down, over the full travel it sweeps the range', () => {
    expect(dragToT(0.5, -KNOB_DRAG_PX / 2)).toBeCloseTo(1);
    expect(dragToT(0.5, KNOB_DRAG_PX / 2)).toBeCloseTo(0);
    expect(dragToT(0.5, -17)).toBeGreaterThan(0.5);
    expect(dragToT(0.5, 17)).toBeLessThan(0.5);
  });
  it('stops at the ends', () => {
    expect(dragToT(0.9, -1000)).toBe(1);
    expect(dragToT(0.1, 1000)).toBe(0);
  });
});

describe('snapValue', () => {
  it('snaps to steps counted from the minimum and stays in range', () => {
    expect(snapValue(2.4, 0, 7, 1)).toBe(2);
    expect(snapValue(2.6, 0, 7, 1)).toBe(3);
    expect(snapValue(-1.4, -2, 2, 1)).toBe(-1);
    expect(snapValue(9, 0, 7, 1)).toBe(7);
    expect(snapValue(0.123, 0, 1)).toBe(0.123);
    expect(snapValue(0.26, 0, 1, 0.05)).toBe(0.25);
  });
});

describe('arcs', () => {
  it('polar: 0 deg is straight up, 90 deg is right, clockwise', () => {
    const up = polar(50, 50, 10, 0);
    expect(up.x).toBeCloseTo(50);
    expect(up.y).toBeCloseTo(40);
    expect(polar(50, 50, 10, 90).x).toBeCloseTo(60);
    expect(polar(50, 50, 10, 180).y).toBeCloseTo(60);
  });
  it('the dial spans -135..+135 degrees', () => {
    expect(tToDeg(0)).toBe(-135);
    expect(tToDeg(0.5)).toBe(0);
    expect(tToDeg(1)).toBe(135);
    expect(tToDeg(7)).toBe(135);
  });
  it('arcPath uses the large-arc flag past a half circle', () => {
    expect(arcPath(30, 30, 20, -135, 135)).toMatch(/A 20 20 0 1 1/);
    expect(arcPath(30, 30, 20, -135, -45)).toMatch(/A 20 20 0 0 1/);
    expect(arcPath(30, 30, 20, 40, -40)).toBe(arcPath(30, 30, 20, -40, 40)); // order does not matter
  });
  it('a unipolar knob fills from the minimum, a knob around zero fills from 12 o clock', () => {
    expect(fillRange(0.75, 0, 1)).toEqual({ from: -135, to: 67.5 });
    expect(fillRange(0.75, -50, 50)).toEqual({ from: 0, to: 67.5 });
    expect(fillRange(0.25, -50, 50)).toEqual({ from: -67.5, to: 0 });
    expect(fillRange(0.5, -50, 50)).toEqual({ from: 0, to: 0 });
  });
});
