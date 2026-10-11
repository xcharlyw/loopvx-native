import { DEVICE_DEFS, DEVICE_TYPES, deviceParams } from './devices';
import { DEVICE_PRESETS, presetOf, presetParams } from './devicepresets';

describe('device presets', () => {
  it('every type has a Standard preset first and a handful of useful ones', () => {
    for (const type of DEVICE_TYPES) {
      const list = DEVICE_PRESETS[type];
      expect(list[0].id).toBe('default');
      expect(list[0].params).toEqual({});
      expect(list.length).toBeGreaterThanOrEqual(5);
      expect(new Set(list.map((p) => p.id)).size).toBe(list.length);
      expect(new Set(list.map((p) => p.name)).size).toBe(list.length);
    }
  });

  it('only names real parameters and values inside their range (no silent clamping)', () => {
    for (const type of DEVICE_TYPES) {
      const keys = new Map(DEVICE_DEFS[type].params.map((p) => [p.key, p]));
      for (const preset of DEVICE_PRESETS[type]) {
        for (const [k, v] of Object.entries(preset.params)) {
          const def = keys.get(k);
          expect(def).toBeDefined();
          expect(v).toBeGreaterThanOrEqual(def!.min);
          expect(v).toBeLessThanOrEqual(def!.max);
          // survives snapping to the knob's step unchanged
          expect(deviceParams({ type, params: { [k]: v } })[k]).toBeCloseTo(v, 9);
        }
      }
    }
  });

  it('presets of a type are all different from each other', () => {
    for (const type of DEVICE_TYPES) {
      const seen = new Set<string>();
      for (const preset of DEVICE_PRESETS[type]) {
        const sig = JSON.stringify(presetParams(type, preset));
        expect(seen.has(sig)).toBe(false);
        seen.add(sig);
      }
    }
  });

  it('recognises the preset a device is set to', () => {
    expect(presetOf({ type: 'comp', params: {} })?.id).toBe('default');
    const glue = DEVICE_PRESETS.comp.find((p) => p.id === 'glue')!;
    expect(presetOf({ type: 'comp', params: presetParams('comp', glue) })?.id).toBe('glue');
    expect(presetOf({ type: 'comp', params: { ...presetParams('comp', glue), ratio: 9 } })).toBeUndefined();
    // @ts-expect-error not a known type
    expect(presetOf({ type: 'wobbler', params: {} })).toBeUndefined();
  });

  it('a preset replaces every parameter, not just the ones it lists', () => {
    const punchy = DEVICE_PRESETS.comp.find((p) => p.id === 'punchy')!;
    const full = presetParams('comp', punchy);
    expect(Object.keys(full).sort()).toEqual(DEVICE_DEFS.comp.params.map((p) => p.key).sort());
    expect(full.mix).toBe(1); // default
    expect(full.ratio).toBe(4);
  });

  it('the kick EQ cuts mud and adds punch', () => {
    const eq = DEVICE_PRESETS.eq.find((p) => p.id === 'kick-punch')!;
    expect(eq.params.p1G).toBeLessThan(0);
    expect(eq.params.p2G).toBeGreaterThan(0);
  });
});
