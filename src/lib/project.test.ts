import { addClip, audibleGain, createProject, editClip, removeClip, splitClip, removeTrack, repairProject, setSlot, trackForSample, updateClip } from './project';

describe('project helpers', () => {
  it('creates the default stack layout', () => {
    const p = createProject();
    expect(p.tracks.map((t) => t.category)).toEqual(['kick', 'top', 'synth', 'vocal']);
    expect(p.tracks.every((t) => t.slots.length === p.sceneCount)).toBe(true);
  });

  it('repairs clips saved with a NaN position (stored as null)', () => {
    const p = createProject();
    const broken = addClip(
      addClip(p, p.tracks[3].id, { id: 'v', sampleId: 's', start: null as unknown as number, length: 8, offset: NaN }),
      p.tracks[0].id,
      { id: 'k', sampleId: 's', start: 4, length: null as unknown as number, offset: 0 },
    );
    const fixed = repairProject(broken);
    expect(fixed.tracks[3].clips).toEqual([{ id: 'v', sampleId: 's', start: 0, length: 8, offset: 0 }]);
    expect(fixed.tracks[0].clips).toEqual([]);
    expect(repairProject(p)).toBe(p);
  });

  it('removes a track and leaves the others untouched', () => {
    const p = createProject();
    const next = removeTrack(p, p.tracks[1].id);
    expect(next.tracks.map((t) => t.category)).toEqual(['kick', 'synth', 'vocal']);
    expect(next.tracks[0]).toBe(p.tracks[0]);
    expect(p.tracks).toHaveLength(4);
  });

  it('splits a clip at a bar inside it', () => {
    const p = createProject();
    const kick = p.tracks[0];
    const withClip = addClip(p, kick.id, { id: 'c', sampleId: 's', start: 4, length: 8, offset: 1 });
    const split = splitClip(withClip, 'c', 6.5, 'r');
    expect(split.tracks[0].clips).toEqual([
      { id: 'c', sampleId: 's', start: 4, length: 2.5, offset: 1 },
      { id: 'r', sampleId: 's', start: 6.5, length: 5.5, offset: 3.5 },
    ]);
    expect(splitClip(withClip, 'c', 4, 'r')).toBe(withClip);
    expect(splitClip(withClip, 'c', 12, 'r')).toBe(withClip);
  });

  it('moves and trims clips on the grid', () => {
    const clip = { id: 'c', sampleId: 's', start: 4, length: 8, offset: 0 };
    expect(editClip(clip, 'move', 1.4, 1)).toEqual({ start: 5, length: 8, offset: 0 });
    expect(editClip(clip, 'move', -9, 1)).toEqual({ start: 0, length: 8, offset: 0 });
    expect(editClip(clip, 'end', -2.6, 0.25)).toEqual({ start: 4, length: 5.5, offset: 0 });
    expect(editClip(clip, 'end', -20, 1)).toEqual({ start: 4, length: 1, offset: 0 });
    // Trimming the start keeps the audio where it was.
    expect(editClip(clip, 'start', 2, 1)).toEqual({ start: 6, length: 6, offset: 2 });
    expect(editClip(clip, 'start', -1, 1)).toEqual({ start: 3, length: 9, offset: -1 });
    expect(editClip(clip, 'start', 30, 1)).toEqual({ start: 11, length: 1, offset: 7 });
  });

  it('adds, updates and removes clips immutably', () => {
    const p = createProject();
    const kick = p.tracks[0];
    const p2 = addClip(p, kick.id, { id: 'c1', sampleId: 's', start: 0, length: 4, offset: 0 });
    expect(p.tracks[0].clips).toHaveLength(0);
    expect(p2.tracks[0].clips).toHaveLength(1);
    const p3 = updateClip(p2, 'c1', { start: 2 });
    expect(p3.tracks[0].clips[0].start).toBe(2);
    expect(removeClip(p3, 'c1').tracks[0].clips).toHaveLength(0);
  });

  it('routes samples to the matching track', () => {
    const p = createProject();
    const s = { id: 's', name: 'x', category: 'synth' as const, addedAt: 0 };
    expect(trackForSample(p, s)?.category).toBe('synth');
  });

  it('fills session slots', () => {
    const p = createProject();
    const p2 = setSlot(p, p.tracks[1].id, 3, 'abc');
    expect(p2.tracks[1].slots[3]).toEqual({ sampleId: 'abc' });
  });

  it('respects mute and solo', () => {
    const p = createProject();
    const [a, b] = p.tracks;
    expect(audibleGain({ ...a, solo: true }, true)).toBe(a.volume);
    expect(audibleGain(b, true)).toBe(0);
    expect(audibleGain({ ...a, muted: true }, false)).toBe(0);
  });
});
