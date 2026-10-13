import type { Track } from '../types';
import { AUTO_GRID, AUTO_PARAMS, drawStep, drawStroke, simplifyLane, deviceAutoParams, hasAutomation, joinPoints, knobPosition, knobValue, paramDef, parseDeviceParam, laneOf, laneValue, ramp, sampleLane, setLane, throwAt, withPoint, withoutPoint } from './automation';

const track = { id: 't', name: 't', category: 'synth', color: '#fff', volume: 1, muted: false, solo: false, clips: [], slots: [] } as Track;

describe('laneValue', () => {
  const pts = [{ bar: 4, value: 0 }, { bar: 8, value: 1 }];
  it('is linear between points and held outside', () => {
    expect(laneValue(pts, 6)).toBe(0.5);
    expect(laneValue(pts, 0)).toBe(0);
    expect(laneValue(pts, 20)).toBe(1);
    expect(laneValue([], 3)).toBeUndefined();
  });
  it('jumps at two points on the same bar', () => {
    expect(laneValue([{ bar: 4, value: 0 }, { bar: 4, value: 1 }, { bar: 8, value: 1 }], 5)).toBe(1);
  });
});

describe('sampleLane', () => {
  it('starts and ends on the window and keeps corners inside it', () => {
    const s = sampleLane([{ bar: 0, value: 0 }, { bar: 1.03, value: 1 }, { bar: 4, value: 0 }], 0, 2, 0.5);
    expect(s[0].bar).toBe(0);
    expect(s[s.length - 1].bar).toBe(2);
    expect(s.some((p) => p.bar === 1.03 && p.value === 1)).toBe(true);
    expect(s.map((p) => p.bar)).toEqual([...s.map((p) => p.bar)].sort((a, b) => a - b));
  });
  it('is empty without points', () => {
    expect(sampleLane([], 0, 4)).toEqual([]);
  });
});

describe('editing', () => {
  it('adds points on the grid, replaces a point on the same bar and clamps to the range', () => {
    let p = withPoint('filter', [], 4.01, -3);
    expect(p).toEqual([{ bar: 4, value: -1 }]);
    p = withPoint('filter', p, 2, 0.5);
    p = withPoint('filter', p, 4, 0.25);
    expect(p).toEqual([{ bar: 2, value: 0.5 }, { bar: 4, value: 0.25 }]);
    expect(withoutPoint(p, 0)).toEqual([{ bar: 4, value: 0.25 }]);
  });
  it('sets and clears a lane on a track without touching the others', () => {
    const a = setLane(track, 'filter', ramp('filter', 0, 8, -1, 0));
    const b = setLane(a, 'reverb', [{ bar: 0, value: 0.3 }]);
    expect(b.automation).toHaveLength(2);
    expect(laneOf(b, 'filter')).toHaveLength(2);
    expect(hasAutomation(b)).toBe(true);
    const c = setLane(setLane(b, 'filter', []), 'reverb', []);
    expect(c.automation).toBeUndefined();
    expect(hasAutomation(c)).toBe(false);
  });
  it('replaces a lane instead of adding a second one', () => {
    const a = setLane(setLane(track, 'drive', [{ bar: 0, value: 0.1 }]), 'drive', [{ bar: 0, value: 0.9 }]);
    expect(a.automation).toEqual([{ param: 'drive', points: [{ bar: 0, value: 0.9 }] }]);
  });
});

describe('shapes', () => {
  it('ramps and clamps to the parameter range', () => {
    expect(ramp('volume', 0, 4, 1.5, -2)).toEqual([{ bar: 0, value: 1 }, { bar: 4, value: 0 }]);
  });
  it('throws up before a bar and drops back on it', () => {
    const t = throwAt('reverb', 16, 4, 0.8, 0);
    expect(laneValue(t, 12)).toBe(0);
    expect(laneValue(t, 15.9)).toBeGreaterThan(0.7);
    expect(laneValue(t, 16)).toBe(0);
  });
  it('joins shapes sorted, a later point on the same bar winning', () => {
    const j = joinPoints([{ bar: 0, value: 0 }, { bar: 4, value: 1 }], [{ bar: 4, value: 0.5 }, { bar: 8, value: 0 }]);
    expect(j).toEqual([{ bar: 0, value: 0 }, { bar: 4, value: 0.5 }, { bar: 8, value: 0 }]);
  });
  it('knows every parameter it can automate', () => {
    expect(Object.keys(AUTO_PARAMS).sort()).toEqual(['delay', 'drive', 'filter', 'pan', 'reverb', 'volume']);
  });
});

describe('device knobs', () => {
  const eq = { id: 'e1', type: 'eq', on: true, params: { lp: 2000 } } as const;
  const withEq = { ...track, devices: [{ ...eq, params: { ...eq.params } }] } as Track;
  it('lists the continuous knobs of the track’s devices under their own keys', () => {
    const list = deviceAutoParams(withEq);
    expect(list.some((d) => d.param === 'dev:e1:lp' && d.label === 'EQ: High-Cut')).toBe(true);
    expect(parseDeviceParam('dev:e1:lp')).toEqual({ deviceId: 'e1', key: 'lp' });
    expect(parseDeviceParam('filter')).toBeUndefined();
  });
  it('maps knob positions to values on the knob’s own curve (log for frequencies) and back', () => {
    const d = withEq.devices![0];
    const t = knobPosition(d, 'lp', 2000);
    expect(t).toBeGreaterThan(0.4);
    expect(t).toBeLessThan(0.8);
    expect(knobValue(d, 'lp', t)).toBeCloseTo(2000, 0);
    expect(knobValue(d, 'lp', 2)).toBe(knobValue(d, 'lp', 1));
  });
  it('describes a device lane as 0..1 with the knob’s readout and rest at the current value', () => {
    const def = paramDef(withEq, 'dev:e1:lp');
    expect(def.min).toBe(0);
    expect(def.max).toBe(1);
    expect(def.format(def.rest)).toBe('2,0 kHz');
    expect(paramDef(withEq, 'dev:gone:lp').label).toBe('Gerät fehlt');
  });
  it('clamps device lanes to 0..1', () => {
    expect(withPoint('dev:e1:lp', [], 0, 3)).toEqual([{ bar: 0, value: 1 }]);
  });
});

describe('drawing', () => {
  it('draws a line where there was nothing', () => {
    const pts = drawStroke('volume', [], [{ bar: 0, value: 0 }, { bar: 4, value: 1 }], 0.25);
    // A straight line: the in-between points are dropped again.
    expect(pts).toEqual([{ bar: 0, value: 0 }, { bar: 4, value: 1 }]);
  });

  it('fills the gaps of a fast finger and keeps the corners', () => {
    const pts = drawStroke('volume', [], [{ bar: 0, value: 0 }, { bar: 2, value: 1 }, { bar: 4, value: 0 }], 0.25);
    expect(pts).toEqual([{ bar: 0, value: 0 }, { bar: 2, value: 1 }, { bar: 4, value: 0 }]);
    expect(laneValue(pts, 1)).toBeCloseTo(0.5);
    expect(laneValue(pts, 3)).toBeCloseTo(0.5);
  });

  it('replaces only the drawn range and keeps the old curve around it', () => {
    const base = [{ bar: 0, value: 0.2 }, { bar: 16, value: 1 }];
    const pts = drawStroke('volume', base, [{ bar: 4, value: 0 }, { bar: 8, value: 0 }], 0.25);
    expect(laneValue(pts, 2)).toBeCloseTo(laneValue(base, 2)!);
    expect(laneValue(pts, 12)).toBeCloseTo(laneValue(base, 12)!);
    expect(laneValue(pts, 6)).toBe(0);
    expect(laneValue(pts, 4 - AUTO_GRID)).toBeCloseTo(laneValue(base, 4 - AUTO_GRID)!);
    expect(pts[0]).toEqual({ bar: 0, value: 0.2 });
    expect(pts[pts.length - 1]).toEqual({ bar: 16, value: 1 });
  });

  it('drawing backwards redraws the same bars', () => {
    const pts = drawStroke('filter', [], [{ bar: 4, value: 1 }, { bar: 0, value: -1 }, { bar: 2, value: 0.5 }], 0.25);
    expect(laneValue(pts, 0)).toBe(-1);
    expect(laneValue(pts, 2)).toBe(0.5);
    expect(laneValue(pts, 4)).toBe(1);
  });

  it('clamps to the parameter range and never goes before bar 1', () => {
    const pts = drawStroke('volume', [], [{ bar: -1, value: 3 }, { bar: 1, value: -2 }], 0.25);
    expect(pts[0].bar).toBe(0);
    expect(Math.max(...pts.map((p) => p.value))).toBeLessThanOrEqual(1);
    expect(Math.min(...pts.map((p) => p.value))).toBeGreaterThanOrEqual(0);
  });

  it('simplifies only what sits on the line', () => {
    const pts = [{ bar: 0, value: 0 }, { bar: 1, value: 0.5 }, { bar: 2, value: 1 }, { bar: 3, value: 0 }];
    expect(simplifyLane(pts, 0.01)).toEqual([pts[0], pts[2], pts[3]]);
  });

  it('draw step follows the zoom', () => {
    expect(drawStep(240)).toBe(1 / 16);
    expect(drawStep(56)).toBe(1 / 8);
    expect(drawStep(8)).toBe(1);
  });
});
