import type { Clip, Project, Track } from '../types';
import { applyGroupEdit, clipsInRange, clipsSpan, copyClips, duplicateClips, groupEdit, pasteClips, splitClips } from './clipgroup';
import { createProject } from './project';

const clip = (id: string, start: number, length = 2, midi = false): Clip => ({ id, sampleId: midi ? '' : 's', start, length, offset: 0, ...(midi ? { notes: [{ pitch: 36, start: 0, length: 0.25, velocity: 1 }] } : {}) });
function project(): Project {
  const p = createProject();
  const t = p.tracks;
  return {
    ...p,
    tracks: [
      { ...t[0], clips: [clip('a', 4), clip('b', 8)] },
      { ...t[1], clips: [clip('c', 6)] },
      { ...t[2], kind: 'midi', clips: [clip('m', 0, 2, true)] } as Track,
      { ...t[3], clips: [] },
    ],
  };
}
const where = (p: Project) => Object.fromEntries(p.tracks.flatMap((t, i) => t.clips.map((c) => [c.id, `${i}@${c.start}+${c.length}`])));

describe('groupEdit', () => {
  it('moves the whole selection by the lead clip’s snapped distance', () => {
    const p = project();
    const r = applyGroupEdit(p, groupEdit(p, ['a', 'b', 'c'], 'a', 'move', 2.1, 0, 1));
    expect(where(r)).toMatchObject({ a: '0@6+2', b: '0@10+2', c: '1@8+2', m: '2@0+2' });
  });
  it('never moves a clip before bar 1', () => {
    const p = project();
    const r = applyGroupEdit(p, groupEdit(p, ['a', 'c'], 'c', 'move', -10, 0, 1));
    expect(where(r)).toMatchObject({ a: '0@0+2', c: '1@2+2' });
  });
  it('changes tracks only when every clip fits its target track', () => {
    const p = project();
    expect(where(applyGroupEdit(p, groupEdit(p, ['a', 'c'], 'a', 'move', 0, 2, 1)))).toMatchObject({ a: '0@4+2', c: '1@6+2' }); // c would land on the MIDI track
    expect(where(applyGroupEdit(p, groupEdit(p, ['a'], 'a', 'move', 0, 1, 1)))).toMatchObject({ a: '1@4+2' });
    expect(where(applyGroupEdit(p, groupEdit(p, ['c'], 'c', 'move', 0, 2, 1)))).toMatchObject({ c: '3@6+2' });
  });
  it('trims every selected clip alike', () => {
    const p = project();
    expect(where(applyGroupEdit(p, groupEdit(p, ['a', 'b'], 'b', 'end', 1, 0, 1)))).toMatchObject({ a: '0@4+3', b: '0@8+3' });
  });
  it('takes the lead clip alone when it is not in the selection', () => {
    const p = project();
    expect(where(applyGroupEdit(p, groupEdit(p, ['b'], 'a', 'move', 1, 0, 1)))).toMatchObject({ a: '0@5+2', b: '0@8+2' });
  });
});

describe('duplicateClips and splitClips', () => {
  it('copies the selection as a block right after it', () => {
    const r = duplicateClips(project(), ['a', 'c']);
    expect(r.ids).toHaveLength(2);
    const starts = r.project.tracks.map((t) => t.clips.map((c) => c.start).sort((x, y) => x - y));
    expect(starts[0]).toEqual([4, 8, 8]); // a (4..6) and c (6..8): the block is 4 bars long
    expect(starts[1]).toEqual([6, 10]);
  });
  it('splits every selected clip under the playhead and skips the others', () => {
    const r = splitClips(project(), ['a', 'c', 'b'], 5);
    expect(r.ids).toHaveLength(1);
    expect(where(r.project)).toMatchObject({ a: '0@4+1', b: '0@8+2', c: '1@6+2' });
  });
});

describe('copy and paste', () => {
  it('pastes the copied block at the playhead on the same tracks', () => {
    const p = project();
    const items = copyClips(p, ['a', 'c']);
    const r = pasteClips(p, items, 20);
    expect(r.ids).toHaveLength(2);
    const starts = r.project.tracks.map((t) => t.clips.map((c) => c.start).sort((x, y) => x - y));
    expect(starts[0]).toEqual([4, 8, 20]);
    expect(starts[1]).toEqual([6, 22]);
  });
  it('moves the block to the selected track when every clip fits, else keeps the tracks', () => {
    const p = project();
    const one = pasteClips(p, copyClips(p, ['c']), 0, 3);
    expect(one.project.tracks[3].clips).toHaveLength(1);
    const midi = pasteClips(p, copyClips(p, ['c']), 0, 2); // an audio clip on the MIDI track: stays on its own track
    expect(midi.project.tracks[2].clips).toHaveLength(1);
    expect(midi.project.tracks[1].clips).toHaveLength(2);
  });
  it('gives the span of a selection', () => {
    expect(clipsSpan(project(), ['a', 'c'])).toEqual({ start: 4, end: 8 });
    expect(clipsSpan(project(), [])).toBeNull();
  });
});

describe('clipsInRange', () => {
  it('takes the clips the band touches on the tracks it spans, in any drag direction', () => {
    const p = project();
    expect(clipsInRange(p, 5, 7, 0, 1).sort()).toEqual(['a', 'c']);
    expect(clipsInRange(p, 7, 5, 1, 0).sort()).toEqual(['a', 'c']);
    expect(clipsInRange(p, 0, 20, 2, 3)).toEqual(['m']);
    expect(clipsInRange(p, 6, 8, 0, 0)).toEqual([]); // a ends at 6, b starts at 8
  });
});
