import { adsrPoints, pitchRate, SAMPLE_ROOT, voicePeak } from './synth';

describe('adsrPoints', () => {
  const env = { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 };

  it('runs attack, decay, sustain and release for a long note', () => {
    expect(adsrPoints(env, 1, 1)).toEqual([
      { t: 0.01, v: 1 },
      { t: 0.11, v: 0.5 },
      { t: 1, v: 0.5 },
      { t: 1.2, v: 0 },
    ]);
  });

  it('releases from mid-decay for a short note', () => {
    const p = adsrPoints(env, 1, 0.06);
    expect(p[0]).toEqual({ t: 0.01, v: 1 });
    expect(p[1].t).toBe(0.06);
    expect(p[1].v).toBeCloseTo(0.75);
    expect(p[2].v).toBe(0);
    expect(p[2].t).toBeCloseTo(0.26);
  });

  it('releases from mid-attack for a very short note', () => {
    const p = adsrPoints({ ...env, attack: 0.1 }, 0.8, 0.05);
    expect(p[0]).toEqual({ t: 0.05, v: 0.4 });
    expect(p[1]).toEqual({ t: 0.25, v: 0 });
  });
});

describe('sample instrument', () => {
  it('plays the sample unchanged on C3 and an octave per 12 semitones', () => {
    expect(pitchRate(SAMPLE_ROOT)).toBe(1);
    expect(pitchRate(72)).toBeCloseTo(2);
    expect(pitchRate(48)).toBeCloseTo(0.5);
    expect(pitchRate(67)).toBeCloseTo(1.4983, 3);
  });

  it('gives samples more level than stacked oscillators', () => {
    expect(voicePeak({ wave: 'sample' }, 1)).toBeGreaterThan(voicePeak({ wave: 'sawtooth' }, 1));
    expect(voicePeak({ wave: 'sine' }, 0.5)).toBeCloseTo(0.125);
  });
});
