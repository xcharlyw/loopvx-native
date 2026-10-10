import { addClip, arrangementSampleIds, mapTrack, audibleGain, createMidiClip, scaleClip, createProject, isMidiClip, toggleNote, editClip, isProject, removeClip, splitClip, removeTrack, renameTrack, repairProject, setSlot, trackForSample, updateClip } from './project';

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

  it('renames only the given track and caps the length', () => {
    const p = createProject();
    const next = renameTrack(p, p.tracks[3].id, 'Lead Vocals');
    expect(next.tracks.map((t) => t.name)).toEqual(['Kick + Bass', 'Top Loop', 'Synth / Lead', 'Lead Vocals']);
    expect(renameTrack(p, p.tracks[0].id, 'x'.repeat(100)).tracks[0].name).toHaveLength(40);
    expect(p.tracks[3].name).toBe('Vocals');
  });

  it('toggles piano-roll notes', () => {
    let notes = toggleNote([], 36, 0.25, 0.25);
    notes = toggleNote(notes, 36, 0, 0.25);
    expect(notes.map((n) => n.start)).toEqual([0, 0.25]);
    // Tapping anywhere on a note removes it.
    expect(toggleNote([{ pitch: 40, start: 0, length: 1, velocity: 1 }], 40, 0.5, 0.25)).toEqual([]);
    expect(isMidiClip(createMidiClip(2))).toBe(true);
    expect(isMidiClip({ id: 'c', sampleId: 's', start: 0, length: 1, offset: 0 })).toBe(false);
  });

  it('splits, trims and doubles MIDI clips with their notes', () => {
    const n = (start: number, length = 0.25) => ({ pitch: 36, start, length, velocity: 1 });
    const p = createProject();
    const clip = { ...createMidiClip(4, 2), id: 'm', notes: [n(0), n(0.75, 0.5), n(1.5)] };
    const [left, right] = splitClip(addClip(p, p.tracks[0].id, clip), 'm', 5, 'r').tracks[0].clips;
    expect(left.notes).toEqual([n(0), n(0.75, 0.25)]); // the note crossing the cut ends there
    expect(right.notes).toEqual([n(0.5)]);
    // Trimming the start keeps notes where they sound.
    expect(editClip(clip, 'start', 1, 0.25).notes).toEqual([n(0.5)]);
    // Doubling repeats the pattern; halving keeps what fits.
    expect(scaleClip(clip, 2).notes).toEqual([n(0), n(0.75, 0.5), n(1.5), n(2), n(2.75, 0.5), n(3.5)]);
    expect(scaleClip(clip, 0.5)).toEqual({ length: 1, notes: [n(0), n(0.75, 0.25)] });
    expect(scaleClip({ ...clip, notes: undefined }, 2)).toEqual({ length: 4 });
  });

  it('recognises damaged project data', () => {
    const p = createProject();
    expect(isProject(p)).toBe(true);
    expect(isProject(null)).toBe(false);
    expect(isProject({ ...p, tracks: null })).toBe(false);
    expect(isProject({ ...p, tracks: [{ ...p.tracks[0], clips: undefined }] })).toBe(false);
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
    const faded = updateClip(withClip, 'c', { fadeIn: 1, fadeOut: 2, gainDb: -3 });
    const [left, right] = splitClip(faded, 'c', 8, 'r').tracks[0].clips;
    expect([left.fadeIn, left.fadeOut, left.gainDb]).toEqual([1, undefined, -3]);
    expect([right.fadeIn, right.fadeOut, right.gainDb]).toEqual([undefined, 2, -3]);
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

describe('arrangementSampleIds', () => {
  it('includes a sample instrument only while its track has MIDI clips', () => {
    let p = createProject();
    const [t0, t1] = p.tracks;
    p = addClip(p, t0.id, { id: 'c1', sampleId: 's-loop', start: 0, length: 4, offset: 0 });
    p = mapTrack(p, t1.id, (t) => ({ ...t, synth: { wave: 'sample', sampleId: 's-kick', cutoff: 16000, resonance: 0.7, attack: 0, decay: 1, sustain: 1, release: 0.05 } }));
    expect([...arrangementSampleIds(p)]).toEqual(['s-loop']);
    p = mapTrack(p, t1.id, (t) => ({ ...t, clips: [createMidiClip(0)] }));
    expect([...arrangementSampleIds(p)].sort()).toEqual(['s-kick', 's-loop']);
  });
});
