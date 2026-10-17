import { lfoRateLabel, modRings, rateAt, rateIndex, synthLayout } from './synthView';
import { modArc } from './knobMath';

describe('mod rings', () => {
  it('has none without routings', () => {
    expect(modRings({})).toEqual({ cutoff: 0, reso: 0, posA: 0, posB: 0 });
  });
  it('turns a cutoff amount into the part of the log dial it sweeps', () => {
    const r = modRings({ mods: [{ source: 'lfo1', target: 'cutoff', amount: 1 }] });
    expect(r.cutoff).toBeCloseTo(4 / Math.log2(400), 5);
    expect(modRings({ mods: [{ source: 'lfo1', target: 'cutoff', amount: -0.5 }] }).cutoff).toBeLessThan(0);
  });
  it('sums routings to the same knob and clamps to the whole dial', () => {
    const r = modRings({ tableA: 'fold', mods: [{ source: 'lfo1', target: 'posA', amount: 0.8 }, { source: 'env2', target: 'posA', amount: 0.7 }] });
    expect(r.posA).toBe(1);
  });
  it('ignores routings that make no sound (no wavetable, no amount)', () => {
    expect(modRings({ mods: [{ source: 'lfo1', target: 'posA', amount: 1 }] }).posA).toBe(0);
    expect(modRings({ mods: [{ source: 'lfo1', target: 'reso', amount: 0 }] }).reso).toBe(0);
  });
});

describe('mod arc', () => {
  it('runs from the knob over the span and stops at the end of the dial', () => {
    expect(modArc(0.5, 0.25)).toEqual({ from: 0, to: 67.5 });
    expect(modArc(0.5, -0.25)).toEqual({ from: -67.5, to: 0 });
    expect(modArc(0.9, 0.5)).toEqual({ from: 108, to: 135 });
    expect(modArc(0.5, 0)).toBeNull();
    expect(modArc(1, 0.5)).toBeNull();
  });
});

describe('layout and rates', () => {
  it('picks the layout by width', () => {
    expect(synthLayout(1000)).toBe('rack');
    expect(synthLayout(700)).toBe('columns');
    expect(synthLayout(360)).toBe('tabs');
  });
  it('steps LFO rates, with "off" first for LFO 1', () => {
    expect(rateIndex(undefined, true)).toBe(0);
    expect(rateAt(0, true)).toBeUndefined();
    expect(rateAt(rateIndex(4, true), true)).toBe(4);
    expect(rateAt(rateIndex(0.5, false), false)).toBe(0.5);
    expect(rateIndex(undefined, false)).toBe(2);
    expect(rateAt(99, false)).toBe(16);
    expect(rateIndex(3, false)).toBe(4); // nearest on a log scale: 4 (not 2)
    expect(lfoRateLabel(1)).toBe('1 Takt');
    expect(lfoRateLabel(16)).toBe('1/16');
  });
});
