import { cleanUserPresets, freePresetName, removeUserPreset, saveUserPreset, userPresetOf } from './userPresets';
import { deviceParams } from '../audio/devices';

const eq = { type: 'eq' as const, params: { hp: 120, lsG: 3 } };

describe('user device presets', () => {
  it('stores the full parameter set', () => {
    const list = saveUserPreset([], eq, ' Kick EQ ', 'p1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'p1', type: 'eq', name: 'Kick EQ', user: true });
    expect(list[0].params).toEqual(deviceParams(eq));
  });
  it('replaces the same name of the same device, keeps its id', () => {
    let list = saveUserPreset([], eq, 'Kick EQ', 'p1');
    list = saveUserPreset(list, { type: 'eq', params: { hp: 200 } }, 'kick eq', 'p2');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('p1');
    expect(list[0].params.hp).toBe(200);
    list = saveUserPreset(list, { type: 'comp', params: {} }, 'Kick EQ', 'p3');
    expect(list).toHaveLength(2);
  });
  it('ignores an empty name', () => {
    expect(saveUserPreset([], eq, '   ', 'x')).toEqual([]);
  });
  it('removes by id', () => {
    const list = saveUserPreset([], eq, 'A', 'p1');
    expect(removeUserPreset(list, 'p1')).toEqual([]);
  });
  it('recognises the preset a device matches', () => {
    const list = saveUserPreset([], eq, 'A', 'p1');
    expect(userPresetOf(list, eq)?.id).toBe('p1');
    expect(userPresetOf(list, { type: 'eq', params: { hp: 121, lsG: 3 } })).toBeUndefined();
  });
  it('drops malformed stored entries', () => {
    expect(cleanUserPresets(null)).toEqual([]);
    expect(cleanUserPresets([{ id: 'a' }, { id: 'b', type: 'eq', name: 'B', params: { hp: 30 } }])).toEqual([{ id: 'b', type: 'eq', name: 'B', params: { hp: 30 }, user: true }]);
  });
  it('finds a free name', () => {
    const list = saveUserPreset([], eq, 'EQ 1', 'p1');
    expect(freePresetName(list, 'eq', 'EQ')).toBe('EQ 2');
    expect(freePresetName(list, 'comp', 'Compressor')).toBe('Compressor 1');
  });
});
