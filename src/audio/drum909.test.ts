import { KIT_PADS, chokes, padAt, planHit } from './drum909';

describe('the 909 kit', () => {
  it('puts every pad on its own drum-rack note', () => {
    expect(new Set(KIT_PADS.map((p) => p.pitch)).size).toBe(KIT_PADS.length);
    expect(padAt(36)?.id).toBe('kick');
    expect(padAt(38)?.id).toBe('snare');
    expect(padAt(42)?.id).toBe('hatClosed');
    expect(padAt(46)?.id).toBe('hatOpen');
    expect(padAt(60)).toBeUndefined();
  });

  it('has a recipe for every pad, and none for a note without one', () => {
    for (const pad of KIT_PADS) {
      const plan = planHit(pad.pitch)!;
      expect(plan.parts.length).toBeGreaterThan(0);
      expect(plan.length).toBeGreaterThan(0);
    }
    expect(planHit(61)).toBeUndefined();
  });

  it('builds the kick as a falling sine with a click', () => {
    const { parts } = planHit(36)!;
    const body = parts.find((p) => p.kind === 'osc')!;
    expect(body).toMatchObject({ kind: 'osc', type: 'sine' });
    if (body.kind === 'osc') expect(body.from).toBeGreaterThan(body.to * 3);
    expect(parts.some((p) => p.kind === 'noise')).toBe(true);
  });

  it('makes the clap three quick bursts and a tail', () => {
    const delays = planHit(39)!.parts.map((p) => ('delay' in p ? p.delay : undefined));
    expect(delays).toEqual([0, 0.011, 0.022, 0.033]);
  });

  it('keeps the open hat longer than the closed one, and the closed one chokes it', () => {
    const decay = (pitch: number) => planHit(pitch)!.parts[0].decay;
    expect(decay(46)).toBeGreaterThan(decay(42) * 4);
    expect(chokes('hatClosed', 'hatOpen')).toBe(true);
    expect(chokes('hatOpen', 'hatClosed')).toBe(false);
    expect(chokes('snare', 'hatOpen')).toBe(false);
  });

  it('tunes pitched parts by cents and scales every decay', () => {
    const plain = planHit(41)!.parts[0];
    const tuned = planHit(41, { tune: 1200, decay: 2 })!.parts[0];
    if (plain.kind !== 'osc' || tuned.kind !== 'osc') throw new Error('osc expected');
    expect(tuned.from / plain.from).toBeCloseTo(2, 5);
    expect(tuned.decay / plain.decay).toBeCloseTo(2, 5);
  });
});
