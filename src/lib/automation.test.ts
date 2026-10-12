import type { Track } from '../types';
import { AUTO_PARAMS, hasAutomation, joinPoints, laneOf, laneValue, ramp, sampleLane, setLane, throwAt, withPoint, withoutPoint } from './automation';

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
    expect(ramp('volume', 0, 4, 1.5, -2)).toEqual([{ bar: 0, value: 1.5 }, { bar: 4, value: 0 }]);
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
