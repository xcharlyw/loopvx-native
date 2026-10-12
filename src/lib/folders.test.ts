import type { Sample } from '../types';
import { allFolders, childFolders, countIn, dissolveFolder, freeName, moveSamples, nameError, normPath, parentOf, prettyPath, renameFolder, samplesIn } from './folders';

const sample = (id: string, folder?: string): Sample => ({ id, name: `${id}.wav`, category: 'other', addedAt: 1, folder });
const lib = [sample('a', 'Loops'), sample('b', 'Loops/Kicks'), sample('c', 'Loops/Kicks/Rumble'), sample('d', 'Splice/Pack'), sample('e'), sample('f', 'Loops')];

describe('folder tree', () => {
  it('derives every folder with its parents, plus the empty ones', () => {
    expect(allFolders(lib)).toEqual(['Loops', 'Loops/Kicks', 'Loops/Kicks/Rumble', 'Splice', 'Splice/Pack']);
    expect(allFolders(lib, ['Leer', 'Loops/Neu'])).toEqual(['Leer', 'Loops', 'Loops/Kicks', 'Loops/Kicks/Rumble', 'Loops/Neu', 'Splice', 'Splice/Pack']);
  });
  it('lists the children of a folder and its samples', () => {
    const all = allFolders(lib);
    expect(childFolders(all, '')).toEqual(['Loops', 'Splice']);
    expect(childFolders(all, 'Loops')).toEqual(['Loops/Kicks']);
    expect(samplesIn(lib, 'Loops').map((s) => s.id)).toEqual(['a', 'f']);
    expect(samplesIn(lib, '').map((s) => s.id)).toEqual(['e']);
  });
  it('counts with and without sub-folders (and does not confuse similar names)', () => {
    expect(countIn(lib, 'Loops')).toEqual({ direct: 2, total: 4 });
    expect(countIn([...lib, sample('g', 'Loops2')], 'Loops').total).toBe(4);
  });
  it('tidies paths and names', () => {
    expect(normPath(' a / b//c ')).toBe('a/b/c');
    expect(parentOf('a/b/c')).toBe('a/b');
    expect(prettyPath('a/b')).toBe('a / b');
    expect(nameError('')).toBeTruthy();
    expect(nameError('a/b')).toBeTruthy();
    expect(nameError('x'.repeat(41))).toBeTruthy();
    expect(nameError('Rumble Kicks')).toBeNull();
  });
});

describe('changing folders', () => {
  it('moves samples into a folder and out to the top level, touching only those that change', () => {
    expect(moveSamples(lib, ['e', 'a'], 'Loops').map((s) => s.id)).toEqual(['e']);
    expect(moveSamples(lib, ['a', 'b'], '').map((s) => [s.id, s.folder])).toEqual([['a', undefined], ['b', undefined]]);
  });
  it('renames a folder with everything below it, keeps empty folders in step', () => {
    const r = renameFolder(lib, ['Loops/Leer', 'Andere'], 'Loops', 'Mein Zeug');
    expect(r.changed.map((s) => `${s.id}:${s.folder}`)).toEqual(['a:Mein Zeug', 'b:Mein Zeug/Kicks', 'c:Mein Zeug/Kicks/Rumble', 'f:Mein Zeug']);
    expect(r.extra).toEqual(['Mein Zeug/Leer', 'Andere']);
  });
  it('merges into an existing folder when renamed to its name', () => {
    expect(renameFolder(lib, [], 'Loops/Kicks', 'Splice/Pack').changed.map((s) => `${s.id}:${s.folder}`)).toEqual(['b:Splice/Pack', 'c:Splice/Pack/Rumble']);
  });
  it('dissolves a folder: contents move up, nothing is lost', () => {
    const r = dissolveFolder(lib, ['Loops/Kicks/Leer'], 'Loops/Kicks');
    expect(r.changed.map((s) => `${s.id}:${s.folder}`)).toEqual(['b:Loops', 'c:Loops/Rumble']);
    expect(r.extra).toEqual(['Loops/Leer']);
    const top = dissolveFolder(lib, [], 'Loops');
    expect(top.changed.map((s) => `${s.id}:${s.folder}`)).toEqual(['a:undefined', 'b:Kicks', 'c:Kicks/Rumble', 'f:undefined']);
  });
  it('finds a free name', () => {
    expect(freeName(['Neuer Ordner', 'Neuer Ordner 2'], '')).toBe('Neuer Ordner 3');
    expect(freeName([], '')).toBe('Neuer Ordner');
    expect(freeName(['A/Neuer Ordner'], 'A')).toBe('Neuer Ordner 2');
  });
});
