import { dupKey, libraryDuplicates, splitDuplicates, usedSampleIds } from './duplicates';
import type { Sample } from '../types';

const f = (id: string, name: string, size?: string) => ({ file: { id, name, size } });
const smp = (id: string, name: string, size: number | undefined, addedAt = 1): Sample => ({ id, name, size, addedAt, driveId: id } as Sample);

describe('duplicates', () => {
  it('needs a size to call something a duplicate', () => {
    expect(dupKey('A.wav')).toBeNull();
    expect(dupKey(' Kick.WAV ', 10)).toBe(dupKey('kick.wav', '10'));
  });

  it('splits files already in the library and repeats inside the list', () => {
    const lib = [smp('x', 'Kick 1.wav', 100)];
    const items = [f('a', 'kick 1.WAV', '100'), f('b', 'Kick 2.wav', '200'), f('c', 'Kick 2.wav', '200'), f('d', 'Kick 2.wav', '201'), f('e', 'Nosize.wav')];
    const r = splitDuplicates(items, lib);
    expect(r.dupes.map((i) => i.file.id)).toEqual(['a', 'c']);
    expect(r.unique.map((i) => i.file.id)).toEqual(['b', 'd', 'e']);
  });

  it('leaves a file with a known Drive id alone', () => {
    const lib = [smp('a', 'Kick.wav', 5)];
    expect(splitDuplicates([f('a', 'Kick.wav', '5')], lib).dupes).toHaveLength(0);
  });

  it('keeps the used copy and offers only unused ones', () => {
    const s = [smp('1', 'K.wav', 9, 1), smp('2', 'K.wav', 9, 2), smp('3', 'K.wav', 9, 3), smp('4', 'Other.wav', 9)];
    const g = libraryDuplicates(s, new Set(['2', '3']));
    expect(g).toHaveLength(1);
    expect(g[0].keep.id).toBe('2');
    expect(g[0].pinned.map((x) => x.id)).toEqual(['3']);
    expect(g[0].drop.map((x) => x.id)).toEqual(['1']);
  });

  it('collects used ids from clips, slots and sample instruments', () => {
    const ids = usedSampleIds([{ tracks: [{ clips: [{ sampleId: 'a' }, { sampleId: '' }], slots: [null, { sampleId: 'b' }], synth: { sampleId: 'c' } }] }]);
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('finds same-name entries when a size is missing or they share a folder', () => {
    const a = { ...smp('1', 'Version 34 Hard Kicks 01 (F) (160BPM).wav', undefined, 1), folder: 'V34' };
    const b = { ...smp('2', 'version 34 hard kicks 01 (F) (160BPM).wav', 5000, 2), folder: 'V34' };
    const c = { ...smp('3', 'Kick.wav', 10, 1), folder: 'A' };
    const d = { ...smp('4', 'Kick.wav', 20, 2), folder: 'B' };
    const g = libraryDuplicates([a, b, c, d], new Set());
    expect(g).toHaveLength(1);
    expect(g[0].drop.map((x) => x.id)).toEqual(['2']);
  });
});
