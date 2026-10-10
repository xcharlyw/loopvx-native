import { delaySeconds, pumpEvents, djFilter, driveCurve, driveGains, fxIsDefault, reverbImpulse, trackFx } from './fx';

describe('djFilter', () => {
  it('is transparent at 0', () => {
    expect(djFilter(0)).toEqual({ lowpass: 22000, highpass: 10 });
  });
  it('closes the lowpass going left and opens the highpass going right, logarithmically', () => {
    expect(djFilter(-1).lowpass).toBeCloseTo(80);
    expect(djFilter(-0.5).lowpass).toBeCloseTo(Math.sqrt(80 * 20000));
    expect(djFilter(1).highpass).toBeCloseTo(8000);
    expect(djFilter(0.5).highpass).toBeCloseTo(Math.sqrt(20 * 8000));
    expect(djFilter(-0.3).highpass).toBe(10);
    expect(djFilter(0.3).lowpass).toBe(22000);
  });
  it('clamps and ignores NaN', () => {
    expect(djFilter(-5)).toEqual(djFilter(-1));
    expect(djFilter(NaN)).toEqual(djFilter(0));
  });
});

describe('drive', () => {
  it('is fully dry at 0 and fully wet at 1', () => {
    expect(driveGains(0)).toEqual({ dry: 1, pre: 1, wet: 0 });
    const full = driveGains(1);
    expect(full.dry).toBe(0);
    expect(full.pre).toBeGreaterThan(20);
    expect(full.wet).toBeGreaterThan(0);
  });
  it('curve is odd, monotonic and peaks at ±1', () => {
    const c = driveCurve(1025);
    expect(c[0]).toBeCloseTo(-1);
    expect(c[1024]).toBeCloseTo(1);
    expect(c[512]).toBeCloseTo(0);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });
});

describe('reverb impulse', () => {
  it('decays to silence, differs per channel, stays bounded', () => {
    const [l, r] = reverbImpulse(8000, 2);
    expect(l.length).toBe(16000);
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    expect(rms(l.subarray(0, 1000))).toBeGreaterThan(rms(l.subarray(14000)) * 20);
    expect(l[100]).not.toBe(r[100]);
    expect(Math.max(...l.map(Math.abs))).toBeLessThan(1);
  });
});

it('delay is a dotted eighth', () => {
  expect(delaySeconds(120)).toBeCloseTo(0.375);
  expect(delaySeconds(150)).toBeCloseTo(0.3);
});

it('fills defaults and detects untouched tracks', () => {
  expect(trackFx(undefined)).toEqual({ filter: 0, drive: 0, reverb: 0, delay: 0, pan: 0, pump: 0 });
  expect(fxIsDefault({ filter: 0 })).toBe(true);
  expect(fxIsDefault({ reverb: 0.2 })).toBe(false);
});

describe('pumpEvents', () => {
  it('ducks right after the beat and swells back within the beat', () => {
    const ev = pumpEvents(10, 1, 0.4);
    expect(ev[0]).toEqual({ kind: 'set', t: 10, v: 1 });
    expect(ev[1].kind).toBe('ramp');
    expect(ev[1].v).toBeCloseTo(0.05);
    expect(ev[1].t).toBeCloseTo(10.005);
    expect(ev[2]).toMatchObject({ kind: 'target', v: 1 });
    // value one beat later is back within 1 % of unity
    const tau = (ev[2] as { tau: number }).tau;
    expect(1 - 0.95 * Math.exp(-(0.4 - 0.005) / tau)).toBeGreaterThan(0.99);
  });
  it('half amount ducks half way', () => {
    expect(pumpEvents(0, 0.5, 0.4)[1].v).toBeCloseTo(0.525);
  });
});
