import type { Clip } from '../types';
import { consolidateGroups, contiguousRun, mergeMidiClips, runSpan } from './consolidate';

const clip = (id: string, start: number, length: number, notes?: Clip['notes']): Clip => ({ id, sampleId: notes ? '' : 's', start, length, offset: 0, notes });

describe('contiguousRun', () => {
  const clips = [clip('c', 8, 4), clip('a', 0, 4), clip('b', 4, 4), clip('far', 20, 4)];
  it('takes the clips that touch the selected one, in both directions', () => {
    expect(contiguousRun(clips, 'b').map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(contiguousRun(clips, 'a').map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
  it('stops at a gap and handles a lone clip', () => {
    expect(contiguousRun(clips, 'far').map((c) => c.id)).toEqual(['far']);
    expect(contiguousRun(clips, 'nope')).toEqual([]);
  });
  it('counts overlapping clips as touching', () => {
    expect(contiguousRun([clip('a', 0, 5), clip('b', 4, 4)], 'a')).toHaveLength(2);
  });
});

describe('mergeMidiClips', () => {
  it('moves the notes into one clip and cuts what ran past its own clip', () => {
    const a = clip('a', 4, 2, [{ pitch: 36, start: 0, length: 0.5, velocity: 1 }, { pitch: 38, start: 1.5, length: 2, velocity: 1 }]);
    const b = clip('b', 6, 2, [{ pitch: 40, start: 0.25, length: 0.25, velocity: 0.5 }]);
    const m = mergeMidiClips([a, b], 'm');
    expect(runSpan([a, b])).toEqual({ start: 4, length: 4 });
    expect(m).toMatchObject({ id: 'm', start: 4, length: 4, sampleId: '' });
    expect(m.notes!.map((n) => [n.pitch, n.start, n.length])).toEqual([[36, 0, 0.5], [38, 1.5, 0.5], [40, 2.25, 0.25]]);
  });
});

describe('consolidateGroups', () => {
  const tracks = [
    { id: 't1', clips: [clip('a', 0, 4), clip('b', 4, 4), clip('c', 12, 4)] },
    { id: 't2', clips: [clip('x', 0, 2), clip('y', 8, 2)] },
  ];
  it('takes the touching clips for a single selection', () => {
    expect(consolidateGroups(tracks, ['a']).map((g) => [g.trackId, g.run.map((c) => c.id)])).toEqual([['t1', ['a', 'b']]]);
  });
  it('takes the range from the first to the last selected clip per track for several', () => {
    const g = consolidateGroups(tracks, ['a', 'c', 'y']);
    expect(g.map((x) => [x.trackId, x.run.map((c) => c.id)])).toEqual([['t1', ['a', 'b', 'c']], ['t2', ['y']]]); // b lies inside the range
    expect(runSpan(g[0].run)).toEqual({ start: 0, length: 16 });
  });
});
