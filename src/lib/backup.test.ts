import { packProject, unpackProject, usedSampleIds } from './backup';
import { addClip, createProject, setSlot } from './project';

describe('project backup files', () => {
  const sample = (id: string, name: string) => ({ id, name, category: 'kick' as const, addedAt: 1, uri: 'file:///device/only' });

  it('round-trips the project and its audio', () => {
    let p = createProject('Rave');
    p = addClip(p, p.tracks[0].id, { id: 'c', sampleId: 'a', start: 0, length: 4, offset: 0 });
    const packed = packProject(p, [
      { sample: sample('a', 'kick.wav'), data: new Uint8Array([1, 2, 3]) },
      { sample: sample('b', 'vox.mp3'), data: new Uint8Array([9]) },
    ]);
    const { project, samples } = unpackProject(packed);
    expect(project).toEqual(p);
    expect(samples.map((s) => [s.sample.id, s.sample.uri, [...s.data]])).toEqual([
      ['a', undefined, [1, 2, 3]],
      ['b', undefined, [9]],
    ]);
  });

  it('finds samples used in the arrangement and the session grid', () => {
    let p = createProject();
    p = addClip(p, p.tracks[0].id, { id: 'c', sampleId: 'a', start: 0, length: 4, offset: 0 });
    p = setSlot(p, p.tracks[1].id, 2, 'b');
    expect([...usedSampleIds(p)].sort()).toEqual(['a', 'b']);
  });

  it('rejects files that are not LOOPVX projects', () => {
    expect(() => unpackProject(new Uint8Array([1, 2, 3]))).toThrow('keine LOOPVX-Projektdatei');
  });
});
