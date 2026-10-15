import { createProject } from '../lib/project';
import { applyInstrument, applyPreset, withSamplerSample, PRESET_CATEGORIES, PRESETS, presetById, SUGGESTED_PRESET } from './presets';
import { planVoice } from './synth';

describe('sound presets', () => {
  it('have unique ids and names, and every category is used', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(PRESETS.length);
    for (const c of PRESET_CATEGORIES) expect(PRESETS.some((p) => p.category === c)).toBe(true);
  });

  it('contain the sounds that were asked for', () => {
    for (const id of ['reese', 'reese-hard', 'supersaw', 'trance-pluck', 'screech', 'hoover', 'warm-pad', 'acid']) expect(presetById(id)).toBeDefined();
  });

  it('are sane: playable ranges, safe envelopes, a real note to audition', () => {
    for (const p of PRESETS) {
      const s = p.synth;
      expect(s.cutoff).toBeGreaterThanOrEqual(20);
      expect(s.cutoff).toBeLessThanOrEqual(20000);
      expect(s.resonance).toBeGreaterThan(0);
      expect(s.resonance).toBeLessThanOrEqual(20);
      expect(s.sustain).toBeGreaterThanOrEqual(0);
      expect(s.sustain).toBeLessThanOrEqual(1);
      expect(p.note).toBeGreaterThanOrEqual(24);
      expect(p.note).toBeLessThanOrEqual(84);
      for (const v of Object.values(p.fx ?? {})) expect(v).toBeLessThanOrEqual(1);
      if (['sawtooth', 'square', 'sine', 'triangle'].includes(s.wave)) {
        // an oscillator preset plans into audible voices that keep their level
        const plan = planVoice(s, p.note, 150);
        const power = plan.oscs.reduce((a, o) => a + o.gain * o.gain, 0);
        expect(power).toBeCloseTo(1, 5);
      }
    }
  });

  it('the Reese is two detuned saws with slow movement, the supersaw has seven voices', () => {
    const reese = presetById('reese')!.synth;
    const plan = planVoice(reese, 36, 150);
    expect(plan.oscs.filter((o) => o.wave === 'sawtooth').length).toBe(4); // unison 2 x (A + B)
    expect(plan.filter.lfoHz).toBeGreaterThan(0);
    expect(plan.filter.lfoHz).toBeLessThan(0.5); // slow
    expect(plan.sub).not.toBeNull();
    expect(planVoice(presetById('supersaw')!.synth, 60, 150).oscs).toHaveLength(7);
  });

  it('applying a preset replaces the instrument and sound effects but keeps filter and pan', () => {
    const base = createProject().tracks[0];
    const t = applyPreset({ ...base, fx: { filter: -0.4, pan: 0.2, reverb: 0.9, pump: 0.3 } }, presetById('reese')!);
    expect(t.synth?.preset).toBe('reese');
    expect(t.synth?.oscB?.detune).toBe(14);
    expect(t.fx).toEqual({ filter: -0.4, pan: 0.2, drive: 0.18, reverb: 0, delay: 0, pump: 0 });
    // a preset without effects clears the sound effects entirely when nothing else is set
    expect(applyPreset(base, presetById('sub')!).fx).toBeUndefined();
    // and does not leave parts of the previous sound behind
    const back = applyPreset(applyPreset(base, presetById('hoover')!), presetById('sub')!);
    expect(back.synth?.unison).toBeUndefined();
    expect(back.synth?.lfoRate).toBeUndefined();
  });

  it('every suggested preset exists', () => {
    for (const id of Object.values(SUGGESTED_PRESET)) expect(presetById(id)).toBeDefined();
  });
});

describe('applyInstrument', () => {
  it('switches the instrument and clears the old sound effects, keeping filter and pan', () => {
    const base = createProject().tracks[0];
    const t = applyInstrument({ ...base, fx: { filter: 0.5, pan: -0.3, reverb: 0.4, delay: 0.2, drive: 0.1, pump: 0.2 } }, { ...base.synth!, wave: 'kick' } as never);
    expect(t.fx).toEqual({ filter: 0.5, pan: -0.3, drive: 0, reverb: 0, delay: 0, pump: 0 });
    expect(applyInstrument({ ...base, fx: { reverb: 0.4 } }, {} as never).fx).toBeUndefined();
  });
});

describe('withSamplerSample', () => {
  it('keeps a sampler and swaps only its sample', () => {
    const t = createProject().tracks[2];
    const sampler = { ...t, synth: { ...t.synth!, wave: 'sample' as const, sampleId: 'a', tune: 30, gainDb: -3 }, fx: { reverb: 0.4 } };
    const next = withSamplerSample(sampler, 'b');
    expect(next.synth).toEqual({ ...sampler.synth, sampleId: 'b' });
    expect(next.fx).toEqual({ reverb: 0.4 });
  });

  it('turns any other instrument into a fresh sampler', () => {
    const t = createProject().tracks[2];
    const lead = applyPreset(t, PRESETS.find((p) => p.category === 'Lead')!);
    const next = withSamplerSample(lead, 'kick');
    expect(next.synth?.wave).toBe('sample');
    expect(next.synth?.sampleId).toBe('kick');
    expect(next.synth?.preset).toBeUndefined();
  });
});

describe('wavetable presets', () => {
  const ids = ['wt-screech', 'wt-vowel', 'wt-morph-pad', 'wt-fold-bass', 'wt-acid', 'wt-fm-bell'];

  it('play a real wavetable and keep every modulation they ask for', () => {
    for (const id of ids) {
      const s = presetById(id)!.synth;
      const plan = planVoice(s, 60, 150);
      expect(plan.oscs[0].table?.id).toBe(s.tableA);
      expect(plan.mod.slots).toHaveLength((s.mods ?? []).length); // none dropped as silent
    }
  });
});

describe('the 40 genre presets', () => {
  it('bring the library to at least 70 sounds with the families Karl asked for', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(70);
    const named = (re: RegExp) => PRESETS.filter((p) => re.test(p.name)).length;
    expect(named(/reese/i)).toBeGreaterThanOrEqual(8);
    expect(named(/hoover|mentasm/i)).toBeGreaterThanOrEqual(5);
    expect(named(/screech/i)).toBeGreaterThanOrEqual(6);
    expect(named(/trance lead|uplifting|pluck lead|voice lead/i)).toBeGreaterThanOrEqual(5);
    expect(named(/stab/i)).toBeGreaterThanOrEqual(7);
    expect(named(/pluck|pizzicato|kalimba/i)).toBeGreaterThanOrEqual(8);
  });
});
