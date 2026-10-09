import { addClip, audibleGain, createProject, removeClip, setSlot, trackForSample, updateClip } from './project';

describe('project helpers', () => {
  it('creates the default stack layout', () => {
    const p = createProject();
    expect(p.tracks.map((t) => t.category)).toEqual(['kick', 'top', 'synth', 'vocal']);
    expect(p.tracks.every((t) => t.slots.length === p.sceneCount)).toBe(true);
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
