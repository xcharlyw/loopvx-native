import { midiToHz } from '../lib/midi';
import { adsrPoints, isDrumWave, kickSweep, morphRange, noiseSamples, noteHold, pitchRate, planVoice, SAMPLE_ROOT, voicePeak } from './synth';

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

describe('planVoice', () => {
  const base = { wave: 'sawtooth' as const, cutoff: 2000, resonance: 2, attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.2 };
  const power = (p: { oscs: { gain: number }[] }) => p.oscs.reduce((a, o) => a + o.gain * o.gain, 0);

  it('a plain synth is one oscillator at full gain on the note', () => {
    const p = planVoice(base, 69, 150);
    expect(p.oscs).toEqual([{ wave: 'sawtooth', freq: 440, gain: 1, osc: 'A' }]);
    expect(p.sub).toBeNull();
    expect(p.noise).toBe(0);
    expect(p.filter).toMatchObject({ type: 'lowpass', cutoff: 2000, startCutoff: 2000, lfoHz: 0, lfoDepthHz: 0 });
  });

  it('unison spreads detuned copies evenly around the pitch and keeps the level', () => {
    const p = planVoice({ ...base, unison: 5, spread: 40 }, 69, 150);
    expect(p.oscs).toHaveLength(5);
    const ratio = (i: number) => 1200 * Math.log2(p.oscs[i].freq / 440);
    expect(ratio(0)).toBeCloseTo(-20);
    expect(ratio(2)).toBeCloseTo(0);
    expect(ratio(4)).toBeCloseTo(20);
    expect(power(p)).toBeCloseTo(1);
  });

  it('a second oscillator is tuned by octave and cents, and the sum keeps its level', () => {
    const p = planVoice({ ...base, unison: 3, spread: 20, oscB: { wave: 'square', octave: -1, detune: 12, level: 0.8 } }, 69, 150);
    expect(p.oscs).toHaveLength(6);
    const b = p.oscs.filter((o) => o.wave === 'square');
    expect(b).toHaveLength(3);
    expect(1200 * Math.log2(b[1].freq / 220)).toBeCloseTo(12); // middle copy: octave below plus 12 cents
    expect(power(p)).toBeCloseTo(1);
  });

  it('ignores a silent second oscillator and clamps absurd values', () => {
    expect(planVoice({ ...base, oscB: { wave: 'sine', octave: 0, detune: 0, level: 0 } }, 60, 150).oscs).toHaveLength(1);
    expect(planVoice({ ...base, unison: 99 }, 60, 150).oscs).toHaveLength(7);
    expect(planVoice({ ...base, unison: 0 }, 60, 150).oscs).toHaveLength(1);
    expect(planVoice({ ...base, oscB: { wave: 'sine', octave: 9, detune: 0, level: 1 } }, 60, 150).oscs[1].freq).toBeCloseTo(midiToHz(60 + 36));
  });

  it('sub sits an octave below, noise is scaled down', () => {
    const p = planVoice({ ...base, sub: 1, noise: 1 }, 69, 150);
    expect(p.sub!.freq).toBeCloseTo(220);
    expect(p.sub!.gain).toBeCloseTo(0.7);
    expect(p.noise).toBeCloseTo(0.5);
  });

  it('filter envelope starts octaves above the cutoff; LFO follows the tempo', () => {
    const p = planVoice({ ...base, filterType: 'bandpass', filterEnv: 2, filterDecay: 0.4, lfoRate: 2, lfoDepth: 0.5 }, 60, 120);
    expect(p.filter.type).toBe('bandpass');
    expect(p.filter.startCutoff).toBeCloseTo(8000);
    expect(p.filter.decay).toBe(0.4);
    expect(p.filter.lfoHz).toBeCloseTo(1); // 120 BPM = 0.5 bars/s, 2 cycles per bar
    expect(p.filter.lfoDepthHz).toBeCloseTo(900);
    expect(planVoice({ ...base, filterEnv: 9 }, 60, 120).filter.startCutoff).toBe(20000);
    expect(planVoice({ ...base, lfoRate: 2, lfoDepth: 0 }, 60, 120).filter.lfoHz).toBe(0);
  });
});

describe('sampler root, tune and gain', () => {
  it('the root note plays the sample unchanged, whatever it is', () => {
    expect(pitchRate(36, 36)).toBe(1);
    expect(pitchRate(48, 36)).toBeCloseTo(2);
    expect(pitchRate(60)).toBe(1); // default root is C3
  });
  it('tune moves it by cents', () => {
    expect(pitchRate(60, 60, 1200)).toBeCloseTo(2);
    expect(pitchRate(60, 60, -100)).toBeCloseTo(Math.pow(2, -1 / 12));
    expect(pitchRate(60, 60, 50)).toBeGreaterThan(1);
  });
  it('gain scales the level in dB', () => {
    expect(voicePeak({ wave: 'sample', gainDb: 0 }, 1)).toBeCloseTo(0.9);
    expect(voicePeak({ wave: 'sample', gainDb: -6.0206 }, 1)).toBeCloseTo(0.45, 3);
    expect(voicePeak({ wave: 'sample', gainDb: 6.0206 }, 1)).toBeCloseTo(1.8, 3);
    expect(voicePeak({ wave: 'sawtooth' }, 1)).toBeCloseTo(0.25);
  });
});

describe('wavetable voices and the mod matrix', () => {
  const base = { wave: 'sawtooth' as const, cutoff: 2000, resonance: 1, attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 };

  it('plays oscillator A as a wavetable frame, snapped to the position grid', () => {
    const plan = planVoice({ ...base, tableA: 'vowel', posA: 0.5 }, 60, 150);
    expect(plan.oscs[0].table).toEqual({ id: 'vowel', pos: 0.5 });
    expect(planVoice(base, 60, 150).oscs[0].table).toBeUndefined();
  });

  it('plays oscillator B as a wavetable only when it has one', () => {
    const plan = planVoice({ ...base, oscB: { wave: 'square', octave: 0, detune: 0, level: 1, table: 'fold', pos: 1 } }, 60, 150);
    expect(plan.oscs.find((o) => o.osc === 'B')!.table).toEqual({ id: 'fold', pos: 1 });
    expect(plan.oscs.find((o) => o.osc === 'A')!.table).toBeUndefined();
  });

  it('keeps the unison level the same for wavetable oscillators', () => {
    const sum = (o: { gain: number }[]) => o.reduce((a, x) => a + x.gain * x.gain, 0);
    expect(sum(planVoice({ ...base, tableA: 'basic', unison: 5, spread: 30 }, 60, 150).oscs)).toBeCloseTo(1, 5);
  });

  it('drops mod slots that do nothing and caps them at eight', () => {
    const mods = [
      { source: 'lfo1' as const, target: 'cutoff' as const, amount: 0.5 },
      { source: 'lfo1' as const, target: 'pitch' as const, amount: 0 },
      { source: 'lfo2' as const, target: 'posA' as const, amount: 0.5 }, // no wavetable: silent
      { source: 'env2' as const, target: 'nonsense' as never, amount: 1 },
      ...Array.from({ length: 12 }, () => ({ source: 'lfo2' as const, target: 'pan' as const, amount: 0.3 })),
    ];
    const plan = planVoice({ ...base, mods }, 60, 150);
    expect(plan.mod.slots[0]).toEqual({ source: 'lfo1', target: 'cutoff', amount: 0.5 });
    expect(plan.mod.slots).toHaveLength(8);
    expect(plan.mod.slots.every((m) => m.target !== 'posA' && m.target !== 'pitch')).toBe(true);
  });

  it('starts an LFO only when a slot uses it, tempo-synced in cycles per bar', () => {
    const plan = planVoice({ ...base, lfoRate: 2, mods: [{ source: 'lfo1', target: 'cutoff', amount: 1 }] }, 60, 120);
    expect(plan.mod.lfos).toEqual([{ source: 'lfo1', shape: 'sine', hz: 1 }]); // 120 BPM = 2 s per bar, 2 cycles per bar = 1 Hz
    expect(plan.mod.env2).toBeNull();
    expect(planVoice(base, 60, 120).mod.lfos).toEqual([]);
  });

  it('gives an envelope 2 default shape when a slot uses it', () => {
    const plan = planVoice({ ...base, mods: [{ source: 'env2', target: 'cutoff', amount: 0.6 }] }, 60, 150);
    expect(plan.mod.env2).toEqual({ attack: 0.01, decay: 0.4, sustain: 0, release: 0.2 });
  });

  it('morphRange orders the two frames and stays inside the table', () => {
    expect(morphRange(0.5, 0.25)).toEqual({ lo: 0.5, hi: 0.75 });
    expect(morphRange(0.5, -0.25)).toEqual({ lo: 0.25, hi: 0.5 });
    expect(morphRange(0.9, 0.5)).toEqual({ lo: 0.90625, hi: 1 }); // the grid is 1/64
  });
});
