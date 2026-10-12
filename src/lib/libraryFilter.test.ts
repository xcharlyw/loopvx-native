import type { Sample } from '../types';
import { keyPitch, keysFit, sortSamples } from './libraryFilter';

const sample = (name: string, extra: Partial<Sample> = {}): Sample => ({ id: name, name, category: 'other', addedAt: 1, ...extra });

describe('keyPitch', () => {
  it('reads sharps, flats and an optional mode', () => {
    expect(keyPitch('A# minor')).toEqual({ root: 10, mode: 'minor' });
    expect(keyPitch('Bb major')).toEqual({ root: 10, mode: 'major' });
    expect(keyPitch('F#')).toEqual({ root: 6, mode: undefined });
    expect(keyPitch('nonsense')).toBeNull();
    expect(keyPitch(undefined)).toBeNull();
  });
});

describe('keysFit', () => {
  it('takes the same key, its relative key and the neighbours on the circle of fifths', () => {
    expect(keysFit('F minor', 'F minor')).toBe(true);
    expect(keysFit('G# major', 'F minor')).toBe(true); // relative major
    expect(keysFit('C minor', 'F minor')).toBe(true); // fifth
    expect(keysFit('A# minor', 'F minor')).toBe(true); // fourth
    expect(keysFit('E minor', 'F minor')).toBe(false); // a semitone away clashes
    expect(keysFit('F major', 'F minor')).toBe(false);
  });
  it('lets a key without a mode match on its root', () => {
    expect(keysFit('F', 'F minor')).toBe(true);
    expect(keysFit('E', 'F minor')).toBe(false);
  });
  it('never rules out a sample without a readable key', () => {
    expect(keysFit(undefined, 'F minor')).toBe(true);
    expect(keysFit('???', 'F minor')).toBe(true);
  });
  it('works from a major project key too', () => {
    expect(keysFit('A minor', 'C major')).toBe(true);
    expect(keysFit('G major', 'C major')).toBe(true);
    expect(keysFit('C# major', 'C major')).toBe(false);
  });
});

describe('sortSamples', () => {
  const list = [sample('b', { bpm: 160, key: 'G minor', addedAt: 3 }), sample('a', { bpm: 150, key: 'C major', addedAt: 1 }), sample('c', { addedAt: 2 })];
  it('sorts by name with numbers in order', () => {
    expect(sortSamples([sample('Kick 10'), sample('Kick 2')], 'name').map((s) => s.name)).toEqual(['Kick 2', 'Kick 10']);
  });
  it('sorts by tempo, key and age with the unknown ones last', () => {
    expect(sortSamples(list, 'bpm').map((s) => s.name)).toEqual(['a', 'b', 'c']);
    expect(sortSamples(list, 'key').map((s) => s.name)).toEqual(['a', 'b', 'c']);
    expect(sortSamples(list, 'new').map((s) => s.name)).toEqual(['b', 'c', 'a']);
  });
  it('does not change the list it is given', () => {
    const copy = [...list];
    sortSamples(list, 'bpm');
    expect(list).toEqual(copy);
  });
});
