import { setParam } from './devicenodes';

// A fake AudioParam that records what was scheduled.
function fakeParam() {
  const calls: string[] = [];
  return {
    calls,
    param: {
      setTargetAtTime: (v: number, t: number) => calls.push(`target ${v}@${t}`),
      setValueAtTime: (v: number, t: number) => calls.push(`value ${v}@${t}`),
      linearRampToValueAtTime: (v: number, t: number) => calls.push(`ramp ${v}@${t}`),
    },
  };
}
const ctx = { currentTime: 3 } as never;

describe('setParam', () => {
  it('glides only while playing (smooth)', () => {
    const a = fakeParam();
    setParam(ctx, a.param as never, 0.5, { bpm: 150, smooth: true });
    expect(a.calls).toEqual(['target 0.5@3']);
  });
  it('jumps when not smooth: a render or a device just built must not start from the defaults', () => {
    const a = fakeParam();
    setParam(ctx, a.param as never, 0.2, { bpm: 150, smooth: false });
    setParam(ctx, a.param as never, 0.3, false);
    expect(a.calls).toEqual(['value 0.2@0', 'value 0.3@0']);
  });
  it('schedules automation at its time', () => {
    const a = fakeParam();
    setParam(ctx, a.param as never, 1, { bpm: 150, smooth: false, at: 5, ramp: true });
    expect(a.calls).toEqual(['ramp 1@5']);
  });
});
