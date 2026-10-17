import { DEFAULT_SYNTH, createProject } from '../lib/project';
import type { SynthSettings, Track } from '../types';
import { applyInstrument, applyPreset, instrumentKind, withInstrumentKind, withSamplerSample, PRESET_CATEGORIES, PRESETS, presetById, SUGGESTED_PRESET } from './presets';
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

describe('withInstrumentKind', () => {
  const base = (synth?: SynthSettings): Track => ({ id: 't', name: 'T', category: 'synth', color: '#fff', volume: 1, muted: false, solo: false, clips: [], slots: [], synth, fx: { reverb: 0.4, pan: 0.2 } }) as Track;
  it('loads each instrument and resets the sound effects but keeps the pan', () => {
    for (const [kind, wave] of [['sample', 'sample'], ['kick', 'kick'], ['noise', 'noise'], ['kit', 'kit909']] as const) {
      const t = withInstrumentKind(base(), kind, 's1');
      expect(t.synth?.wave).toBe(wave);
      expect(t.fx).toMatchObject({ pan: 0.2, reverb: 0 });
    }
  });
  it('the sampler takes the earlier sample, else the first one given', () => {
    expect(withInstrumentKind(base(), 'sample', 'first').synth?.sampleId).toBe('first');
    expect(withInstrumentKind(base({ ...(DEFAULT_SYNTH as SynthSettings), sampleId: 'mine' }), 'sample', 'first').synth?.sampleId).toBe('mine');
  });
  it('is unchanged for the kind the track already is, and back to the synth works', () => {
    const synth = base({ ...DEFAULT_SYNTH, wave: 'sawtooth' });
    expect(withInstrumentKind(synth, 'synth')).toBe(synth);
    const sampler = withInstrumentKind(base(), 'sample', 's1');
    expect(withInstrumentKind(sampler, 'synth').synth?.wave).toBe('sawtooth');
    expect(instrumentKind('kit909')).toBe('kit');
    expect(instrumentKind('square')).toBe('synth');
  });
});

describe('preset effects (devices)', () => {
  const track = (): Track => ({ ...createProject().tracks[0], devices: [{ id: 'own', type: 'eq', on: true, params: { hp: 80 } }] });
  const withFx = presetById('ht-screech')!;
  it('puts the preset’s devices in front of the user’s own, marked as the sound’s', () => {
    const t = applyPreset(track(), withFx);
    expect(t.devices!.map((d) => d.type)).toEqual([...withFx.devices!.map((d) => d.type), 'eq']);
    expect(t.devices!.slice(0, -1).every((d) => d.preset)).toBe(true);
    expect(t.devices!.at(-1)).toEqual({ id: 'own', type: 'eq', on: true, params: { hp: 80 } });
  });
  it('replaces the previous sound’s devices, keeps the user’s', () => {
    const t = applyPreset(applyPreset(track(), withFx), presetById('ht-reese')!);
    expect(t.devices!.filter((d) => d.preset).map((d) => d.type)).toEqual(presetById('ht-reese')!.devices!.map((d) => d.type));
    expect(t.devices!.filter((d) => !d.preset).map((d) => d.id)).toEqual(['own']);
    // a sound without effects, or another instrument, takes the sound's devices away
    expect(applyPreset(t, presetById('reese')!).devices).toEqual([track().devices![0]]);
    expect(withInstrumentKind(t, 'sample').devices!.map((d) => d.id)).toEqual(['own']);
  });
  it('never pushes the user’s devices out of a full chain', () => {
    const full: Track = { ...track(), devices: Array.from({ length: 7 }, (_, i) => ({ id: `u${i}`, type: 'eq' as const, on: true, params: {} })) };
    const t = applyPreset(full, withFx);
    expect(t.devices).toHaveLength(8);
    expect(t.devices!.filter((d) => !d.preset)).toHaveLength(7);
  });
});

describe('Hard Techno presets', () => {
  const ht = PRESETS.filter((p) => p.category === 'Hard Techno');
  it('cover Reese basses, screeches, rave leads and a hoover', () => {
    const names = ht.map((p) => p.name).join(' ');
    for (const word of ['Reese', 'Screech', 'Lead', 'Hoover', 'Stab']) expect(names).toContain(word);
    expect(ht.length).toBeGreaterThanOrEqual(12);
  });
  it('each brings a saturator in its own effects, and wide unison where it has copies', () => {
    for (const p of ht) {
      expect(p.devices?.some((d) => d.type === 'sat')).toBe(true);
      if ((p.synth.unison ?? 1) > 1) expect(p.synth.width ?? 0).toBeGreaterThan(0);
    }
  });
  it('turn the saturator back down after driving it (levels were matched by renders)', () => {
    for (const p of ht) {
      const sats = p.devices!.filter((d) => d.type === 'sat');
      const last = sats[sats.length - 1].params!;
      expect(last.out ?? 0).toBeLessThanOrEqual(1);
      expect((last.drive ?? 9) + (last.out ?? 0)).toBeLessThanOrEqual(12);
    }
  });
});
