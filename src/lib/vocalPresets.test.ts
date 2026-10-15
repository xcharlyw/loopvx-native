import { FACTORY_PRESETS, presetVoice, removePreset, upsertPreset, type VocalPreset } from './vocalPresets';

const make = (id: string, name: string, prompt = 'x'): VocalPreset => ({ id, name, prompt, lyrics: '', bars: 8, vocalsOnly: true, gender: null, style: null, language: null, speed: 1, expression: 0.3, stability: 0.5, voiceId: null });

describe('vocal presets', () => {
  it('adds a new preset at the end', () => {
    expect(upsertPreset([make('1', 'A')], make('2', 'B')).map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('replaces a preset of the same name (any case) and keeps its id and place', () => {
    const out = upsertPreset([make('1', 'Rave Hook'), make('2', 'B')], make('9', ' rave hook ', 'new'));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: '1', name: 'rave hook', prompt: 'new' });
  });

  it('removes by id', () => {
    expect(removePreset([make('1', 'A'), make('2', 'B')], '1').map((p) => p.id)).toEqual(['2']);
  });

  it('only keeps the voice while it exists', () => {
    const p = { ...make('1', 'A'), voiceId: 'voice_a' };
    expect(presetVoice(p, ['voice_a'])).toBe('voice_a');
    expect(presetVoice(p, ['voice_b'])).toBeNull();
    expect(presetVoice(make('2', 'B'), ['voice_a'])).toBeNull();
  });
});

describe('factory presets', () => {
  it('has the ten named styles with unique ids, in range', () => {
    expect(FACTORY_PRESETS).toHaveLength(10);
    expect(new Set(FACTORY_PRESETS.map((p) => p.id)).size).toBe(10);
    expect(FACTORY_PRESETS[0].name).toBe('Alexa (Dark Seductive Rap)');
    for (const p of FACTORY_PRESETS) {
      expect(p.prompt).toContain('no singing');
      expect(p.speed).toBeGreaterThanOrEqual(0.7);
      expect(p.speed).toBeLessThanOrEqual(1.2);
    }
  });
});
