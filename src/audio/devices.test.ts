import { deviceSummary, DEVICE_DEFS, DEVICE_TYPES, createDevice, deviceIsDefault, deviceParams, formatParam } from './devices';

describe('device registry', () => {
  it('every parameter has a sane range, a default inside it and a unique key', () => {
    for (const type of DEVICE_TYPES) {
      const keys = new Set<string>();
      for (const p of DEVICE_DEFS[type].params) {
        expect(keys.has(p.key)).toBe(false);
        keys.add(p.key);
        expect(p.min).toBeLessThan(p.max);
        expect(p.def).toBeGreaterThanOrEqual(p.min);
        expect(p.def).toBeLessThanOrEqual(p.max);
        if (p.curve === 'log') expect(p.min).toBeGreaterThan(0);
        if (p.options) expect(p.options.length).toBe(p.max - p.min + 1);
      }
    }
  });

  it('fills defaults, clamps and snaps', () => {
    const d = createDevice('comp', 'x');
    expect(deviceParams(d).threshold).toBe(-18);
    expect(deviceIsDefault(d)).toBe(true);
    const wild = deviceParams({ type: 'comp', params: { threshold: 40, ratio: -3, attack: NaN, release: 130.2, knee: 3.3 } });
    expect(wild.threshold).toBe(0);
    expect(wild.ratio).toBe(1);
    expect(wild.attack).toBe(10);
    expect(wild.knee).toBe(3.5);
    expect(deviceIsDefault({ ...d, params: { threshold: -20 } })).toBe(false);
  });

  it('survives a device type from a future version', () => {
    // @ts-expect-error not a known type
    expect(deviceParams({ type: 'wobbler', params: { a: 1 } })).toEqual({});
    // @ts-expect-error not a known type
    expect(deviceIsDefault({ id: 'x', type: 'wobbler', on: true, params: {} })).toBe(true);
  });

  it('formats the way the knobs show it', () => {
    const find = (type: keyof typeof DEVICE_DEFS, key: string) => DEVICE_DEFS[type].params.find((p) => p.key === key)!;
    expect(formatParam(find('eq', 'p1F'), 1200)).toBe('1,2 kHz');
    expect(formatParam(find('eq', 'p1F'), 400)).toBe('400 Hz');
    expect(formatParam(find('eq', 'p1G'), 3.5)).toBe('+3,5 dB');
    expect(formatParam(find('eq', 'p1G'), -6)).toBe('-6,0 dB');
    expect(formatParam(find('comp', 'ratio'), 4)).toBe('4,0:1');
    expect(formatParam(find('comp', 'ratio'), 20)).toBe('20:1');
    expect(formatParam(find('comp', 'attack'), 10)).toBe('10,0 ms');
    expect(formatParam(find('echo', 'mix'), 0.3)).toBe('30 %');
    expect(formatParam(find('echo', 'division'), 2)).toBe('1/8 punkt.');
    expect(formatParam(find('utility', 'pan'), 0)).toBe('Mitte');
    expect(formatParam(find('utility', 'pan'), -0.5)).toBe('50 L');
    expect(formatParam(find('sat', 'mode'), 2)).toBe('Fold');
    expect(formatParam(find('chorus', 'rate'), 0.6)).toBe('0,60 Hz');
    expect(formatParam(find('eq', 'hp'), 20)).toBe('Aus');
    expect(formatParam(find('eq', 'hp'), 90)).toBe('90 Hz');
    expect(formatParam(find('eq', 'lp'), 20000)).toBe('Aus');
    expect(formatParam(find('eq', 'lp'), 8000)).toBe('8,0 kHz');
  });
});

describe('deviceSummary', () => {
  it('tells the state of each device in one line', () => {
    expect(deviceSummary({ type: 'eq', params: {} })).toBe('Flach');
    expect(deviceSummary({ type: 'eq', params: { lsG: 8, hp: 90 } })).toBe('Low-Cut 90 Hz · Bass +8,0 dB');
    expect(deviceSummary({ type: 'comp', params: {} })).toBe('-18 dB · 4,0:1 · 120 ms');
    expect(deviceSummary({ type: 'sat', params: { mode: 2 } })).toBe('Fold · Drive +9,0 dB');
    expect(deviceSummary({ type: 'echo', params: {} })).toBe('1/8 punkt. · FB 40 % · 30 %');
    expect(deviceSummary({ type: 'echo', params: { sync: 0, time: 250 } })).toBe('250 ms · FB 40 % · 30 %');
    expect(deviceSummary({ type: 'utility', params: { gain: -6, pan: -0.5, invert: 1 } })).toBe('-6,0 dB · 50 L · Phase');
    // @ts-expect-error not a known type
    expect(deviceSummary({ type: 'wobbler', params: {} })).toBe('');
  });
  it('has a summary for every type', () => {
    for (const type of DEVICE_TYPES) expect(deviceSummary({ type, params: {} }).length).toBeGreaterThan(0);
  });
});
