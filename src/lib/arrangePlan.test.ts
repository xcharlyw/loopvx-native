import { normalizeKey, parsePlan, planSections } from './arrangePlan';

describe('arrange plan', () => {
  it('normalizes keys', () => {
    expect(normalizeKey('f minor')).toBe('F minor');
    expect(normalizeKey('Fm')).toBe('F minor');
    expect(normalizeKey('F#')).toBe('F# minor');
    expect(normalizeKey('Bb minor')).toBe('A# minor');
    expect(normalizeKey('a moll')).toBe('A minor');
    expect(normalizeKey('C Dur')).toBe('C major');
    expect(normalizeKey('H minor')).toBeUndefined();
    expect(normalizeKey(5)).toBeUndefined();
  });

  it('repairs a model answer', () => {
    const plan = parsePlan({
      summary: 'Düster, langer Break.',
      bpm: 160.4,
      key: 'f minor',
      sections: [
        { type: 'intro', bars: 15, name: 'Start' },
        { type: 'drop', bars: 33, mute: ['pad', 'nonsense'] },
        { type: 'solo', bars: 8 },
        { type: 'break', bars: 2 },
        { type: 'drop', bars: 999 },
      ],
      styles: { bass: 'acid', lead: 'dubstep', drums: 'kit-rolling' },
      addRoles: ['bass', 'choir'],
      automation: false,
    })!;
    expect(plan.bpm).toBe(160);
    expect(plan.key).toBe('F minor');
    expect(plan.sections).toEqual([
      { type: 'intro', bars: 16, name: 'Start' },
      { type: 'drop', bars: 32, mute: ['pad'] },
      { type: 'break', bars: 4 },
      { type: 'drop', bars: 64 },
    ]);
    expect(plan.styles).toEqual({ bass: 'acid', drums: 'kit-rolling' });
    expect(plan.addRoles).toEqual(['bass']);
    expect(plan.automation).toBe(false);
    expect(plan.summary).toBe('Düster, langer Break.');
  });

  it('caps the length and needs a drop', () => {
    expect(parsePlan({ sections: [{ type: 'intro', bars: 16 }] })).toBeNull();
    expect(parsePlan('x')).toBeNull();
    const long = parsePlan({ sections: Array.from({ length: 20 }, () => ({ type: 'drop', bars: 64 })) })!;
    expect(long.sections.reduce((n, s) => n + s.bars, 0)).toBe(256);
    expect(long.bpm).toBeUndefined();
    // the plan decides: what it does not mention is not added
    expect(long.addRoles).toEqual([]);
    expect(long.automation).toBe(false);
    expect(parsePlan({ sections: [{ type: 'drop', bars: 8 }], addRoles: ['pad'], automation: true })).toMatchObject({ addRoles: ['pad'], automation: true });
  });

  it('lays sections out and numbers repeats', () => {
    const secs = planSections({ sections: [{ type: 'intro', bars: 16 }, { type: 'build', bars: 8 }, { type: 'drop', bars: 32 }, { type: 'build', bars: 8 }, { type: 'drop', bars: 32, name: 'Finale' }] });
    expect(secs.map((s) => [s.id, s.label, s.start, s.bars])).toEqual([
      ['intro', 'Intro', 0, 16],
      ['build', 'Build-up 1', 16, 8],
      ['drop', 'Drop 1', 24, 32],
      ['build2', 'Build-up 2', 56, 8],
      ['drop2', 'Finale', 64, 32],
    ]);
  });
});

describe('plan effects', () => {
  const base = { sections: [{ type: 'drop', bars: 32 }] };
  it('keeps valid effects (bar 1-based in, 0-based out) and drops nonsense', () => {
    const plan = parsePlan({
      ...base,
      fx: [
        { kind: 'impact', bar: 65, track: ' Impact FX ', search: ['impact', 'hit', '', 7], sample: 'SSE Pattern 05 Perc FX', length: null },
        { kind: 'riser', bar: 57.4, length: 7.9 },
        { kind: 'laser', bar: 3 },
        { kind: 'crash', bar: 0 },
        { kind: 'crash', bar: 'x' },
        'no',
      ],
      notes: ['Keine Gesangsspur möglich', 4, ' '],
    })!;
    expect(plan.fx).toEqual([
      { kind: 'impact', bar: 64, track: 'Impact FX', search: ['impact', 'hit'], sample: 'SSE Pattern 05 Perc FX' },
      { kind: 'riser', bar: 56, length: 8 },
      { kind: 'other', bar: 2 },
    ]);
    expect(plan.notes).toEqual(['Keine Gesangsspur möglich']);
  });
  it('has no effects without a list', () => {
    expect(parsePlan(base)!.fx).toEqual([]);
    expect(parsePlan({ ...base, fx: 'impact' })!.fx).toEqual([]);
  });
});
