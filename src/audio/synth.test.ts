import { adsrPoints, isDrumWave, kickSweep, noiseSamples, noteHold, pitchRate, SAMPLE_ROOT, voicePeak } from './synth';

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

describe('synthesized drums', () => {
  it('kick drops from a click to a 50 Hz body on C3, tuned by the note', () => {
    const k = kickSweep(60);
    expect(k.to).toBeCloseTo(50);
    expect(k.from).toBeGreaterThan(300);
    expect(kickSweep(72).to).toBeCloseTo(100);
  });
  it('kick and noise ring out their decay even for short notes; synths follow the note', () => {
    expect(noteHold({ wave: 'kick', attack: 0.001, decay: 0.45 }, 0.1)).toBeCloseTo(0.451);
    expect(noteHold({ wave: 'noise', attack: 0.001, decay: 0.05 }, 0.2)).toBe(0.2);
    expect(noteHold({ wave: 'sawtooth', attack: 0.001, decay: 0.45 }, 0.1)).toBe(0.1);
    expect(isDrumWave('kick') && isDrumWave('noise') && isDrumWave('sample') && !isDrumWave('sine')).toBe(true);
  });
  it('noise is deterministic and spans [-1, 1)', () => {
    const n = noiseSamples(5000);
    expect(noiseSamples(5000)).toEqual(n);
    expect(Math.min(...n)).toBeLessThan(-0.99);
    expect(Math.max(...n)).toBeGreaterThan(0.99);
    expect(Math.max(...n)).toBeLessThan(1);
  });
});
