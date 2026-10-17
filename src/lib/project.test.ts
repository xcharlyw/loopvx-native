import type { Project } from '../types';
import { addDevice, moveDevice, removeDevice, updateDevice, addClip, addNote, canHoldClip, createMidiTrack, setTrackKind, trackKind, arrangementSampleIds, duplicateNote, findNote, MIN_NOTE, noteIndexAt, quantizeNotes, transposeNotes, updateNote, mapTrack, moveTrack, moveTrackTo, createTrack, groupTracks, setTrackGroup, ungroup, groupMembers, groupOf, audibleGains, createGroupTrack, playClips, playProject, thawProject, invalidateFrozen, frozenClip, audibleGain, createMidiClip, scaleClip, createProject, isMidiClip, toggleNote, editClip, isProject, removeClip, splitClip, removeTrack, renameTrack, repairProject, setSlot, trackForSample, updateClip, toggleClipsMuted, duplicateTrack, copyProject, copyDevices, MASTER_ID } from './project';

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

describe('piano roll note editing', () => {
  const notes = [
    { pitch: 36, start: 0, length: 0.25, velocity: 0.8 },
    { pitch: 43, start: 0.25, length: 0.125, velocity: 0.5 },
  ];

  it('finds notes by position and by identity', () => {
    expect(noteIndexAt(notes, 36, 0.1)).toBe(0);
    expect(noteIndexAt(notes, 36, 0.25)).toBe(-1);
    expect(findNote(notes, 43, 0.25)).toBe(1);
    expect(findNote(notes, 43, 0.3)).toBe(-1);
  });

  it('keeps edited notes inside the clip and the MIDI range, and re-sorts', () => {
    const moved = updateNote(notes, 0, { start: 0.5, pitch: 200, velocity: 5 }, 1);
    expect(moved.note).toEqual({ pitch: 127, start: 0.5, length: 0.25, velocity: 1 });
    expect(moved.notes.map((n) => n.start)).toEqual([0.25, 0.5]);
    const long = updateNote(notes, 1, { length: 9 }, 1);
    expect(long.note.length).toBeCloseTo(0.75);
    const tiny = updateNote(notes, 1, { length: 0 }, 1);
    expect(tiny.note.length).toBe(MIN_NOTE);
    const late = updateNote(notes, 0, { start: 5 }, 1);
    expect(late.note.start + late.note.length).toBeLessThanOrEqual(1 + 1e-9);
    expect(updateNote(notes, 0, { velocity: 0 }, 1).note.velocity).toBe(0.05);
  });

  it('duplicates a note behind itself while there is room', () => {
    const d = duplicateNote(notes, 0, 1)!;
    expect(d.note).toEqual({ pitch: 36, start: 0.25, length: 0.25, velocity: 0.8 });
    expect(d.notes).toHaveLength(3);
    expect(duplicateNote([{ pitch: 40, start: 0.75, length: 0.25, velocity: 1 }], 0, 1)).toBeNull();
  });

  it('transposes all notes but never out of range', () => {
    expect(transposeNotes(notes, 12).map((n) => n.pitch)).toEqual([48, 55]);
    expect(transposeNotes(notes, -100).map((n) => n.pitch)).toEqual([0, 7]);
    expect(transposeNotes(notes, 100).map((n) => n.pitch)).toEqual([120, 127]);
    expect(transposeNotes([], 5)).toEqual([]);
  });

  it('quantizes to 16ths and merges collisions', () => {
    const loose = [
      { pitch: 36, start: 0.02, length: 0.07, velocity: 1 },
      { pitch: 36, start: 0.03, length: 0.2, velocity: 0.4 },
      { pitch: 40, start: 0.26, length: 0.01, velocity: 1 },
    ];
    const q = quantizeNotes(loose);
    expect(q).toHaveLength(2);
    expect(q[0]).toMatchObject({ pitch: 36, start: 0, length: 0.0625 });
    expect(q[1]).toMatchObject({ pitch: 40, start: 0.25, length: 0.0625 });
  });

  it('addNote keeps the list sorted', () => {
    expect(addNote(notes, { pitch: 30, start: 0, length: 0.1, velocity: 1 }).map((n) => n.pitch)).toEqual([30, 36, 43]);
  });
});

describe('track kinds', () => {
  const audioClip = { id: 'a', sampleId: 's', start: 0, length: 4, offset: 0 };
  const midiClip = { id: 'm', sampleId: '', start: 0, length: 4, offset: 0, notes: [] };

  it('new default tracks are audio tracks', () => {
    for (const t of createProject().tracks) expect(trackKind(t)).toBe('audio');
  });

  it('infers the kind of older tracks from what they hold', () => {
    const p = createProject();
    const [t0] = p.tracks;
    const { kind: _kind, ...old } = t0;
    expect(trackKind(old)).toBe('audio');
    expect(trackKind({ ...old, clips: [midiClip] })).toBe('midi');
    expect(trackKind({ ...old, synth: { wave: 'sawtooth', cutoff: 1000, resonance: 1, attack: 0, decay: 0, sustain: 1, release: 0 } })).toBe('midi');
    expect(trackKind({ ...old, kind: 'midi' })).toBe('midi'); // an explicit kind wins
  });

  it('a MIDI track takes MIDI clips and an audio track takes audio clips, never the other way round', () => {
    const audio = createProject().tracks[0];
    const midi = createMidiTrack(8);
    expect(canHoldClip(audio, audioClip)).toBe(true);
    expect(canHoldClip(audio, midiClip)).toBe(false);
    expect(canHoldClip(midi, midiClip)).toBe(true);
    expect(canHoldClip(midi, audioClip)).toBe(false);
  });

  it('a MIDI track is created blue and named MIDI', () => {
    const t = createMidiTrack(8);
    expect(t.kind).toBe('midi');
    expect(t.name).toBe('MIDI');
    expect(t.slots).toHaveLength(8);
  });

  it('only an empty track can change its kind', () => {
    let p = createProject();
    const id = p.tracks[0].id;
    p = setTrackKind(p, id, 'midi');
    expect(trackKind(p.tracks[0])).toBe('midi');
    p = addClip(p, id, midiClip);
    expect(setTrackKind(p, id, 'audio')).toBe(p); // has a clip: refused
    const empty = createProject();
    expect(setTrackKind(empty, empty.tracks[1].id, 'audio')).toBe(empty); // already audio: unchanged
    expect(setTrackKind(empty, 'nope', 'midi')).toBe(empty);
  });

  it('switching back to audio drops the instrument', () => {
    let p = createProject();
    const id = p.tracks[0].id;
    p = setTrackKind(p, id, 'midi');
    p = mapTrack(p, id, (t) => ({ ...t, synth: { wave: 'sine', cutoff: 1000, resonance: 1, attack: 0, decay: 0, sustain: 1, release: 0 } }));
    p = setTrackKind(p, id, 'audio');
    expect(p.tracks[0].synth).toBeUndefined();
    expect(trackKind(p.tracks[0])).toBe('audio');
  });

  it('samples are placed on audio tracks only, even when a MIDI track is selected or has the category', () => {
    let p = createProject();
    p = { ...p, tracks: [createMidiTrack(8), ...p.tracks] };
    const midiId = p.tracks[0].id;
    const sample = { id: 's', name: 'x', category: 'synth', addedAt: 0 } as never;
    const target = trackForSample(p, sample, midiId)!;
    expect(trackKind(target)).toBe('audio');
    expect(target.category).toBe('synth'); // the audio "Synth / Lead" track, not the MIDI one
  });
});

describe('device chain', () => {
  it('adds devices in order, at an index, up to the limit', () => {
    let p = createProject();
    const id = p.tracks[0].id;
    p = addDevice(p, id, 'eq');
    p = addDevice(p, id, 'comp');
    p = addDevice(p, id, 'sat', 1);
    expect(p.tracks[0].devices!.map((d) => d.type)).toEqual(['eq', 'sat', 'comp']);
    expect(new Set(p.tracks[0].devices!.map((d) => d.id)).size).toBe(3);
    for (let i = 0; i < 20; i++) p = addDevice(p, id, 'echo');
    expect(p.tracks[0].devices!.length).toBe(8);
    expect(p.tracks[1].devices).toBeUndefined();
  });

  it('removes and reorders; an empty chain leaves no devices field', () => {
    let p = createProject();
    const id = p.tracks[0].id;
    for (const t of ['eq', 'comp', 'sat'] as const) p = addDevice(p, id, t);
    const [eq, comp, sat] = p.tracks[0].devices!;
    p = moveDevice(p, id, sat.id, -2);
    expect(p.tracks[0].devices!.map((d) => d.type)).toEqual(['sat', 'eq', 'comp']);
    p = moveDevice(p, id, sat.id, -1);
    expect(p.tracks[0].devices!.map((d) => d.type)).toEqual(['sat', 'eq', 'comp']);
    p = moveDevice(p, id, comp.id, 1);
    expect(p.tracks[0].devices!.map((d) => d.type)).toEqual(['sat', 'eq', 'comp']);
    p = removeDevice(removeDevice(removeDevice(p, id, eq.id), id, comp.id), id, sat.id);
    expect(p.tracks[0].devices).toBeUndefined();
  });

  it('switches devices off and clamps parameters', () => {
    let p = createProject();
    const id = p.tracks[0].id;
    p = addDevice(p, id, 'comp');
    const dev = p.tracks[0].devices![0];
    p = updateDevice(p, id, dev.id, { on: false, params: { threshold: -200, ratio: 8 } });
    const after = p.tracks[0].devices![0];
    expect(after.on).toBe(false);
    expect(after.params.threshold).toBe(-60);
    expect(after.params.ratio).toBe(8);
    expect(after.params.release).toBe(120);
    p = updateDevice(p, id, dev.id, { params: { attack: 30 } });
    expect(p.tracks[0].devices![0].params).toMatchObject({ ratio: 8, attack: 30 });
    expect(p.tracks[0].devices![0].on).toBe(false);
  });
});

describe('moveTrack', () => {
  const base = () => {
    const p = createProject('T', 150, 'F minor');
    return { ...p, tracks: ['a', 'b', 'c'].map((id) => ({ ...createTrack('synth', 8, id, 'midi'), id })) };
  };
  const order = (p: ReturnType<typeof base>) => p.tracks.map((t) => t.id).join('');
  it('moves a track up and down', () => {
    expect(order(moveTrack(base(), 'b', -1))).toBe('bac');
    expect(order(moveTrack(base(), 'b', 1))).toBe('acb');
    expect(order(moveTrack(base(), 'a', 2))).toBe('bca');
  });
  it('stops at the ends and ignores unknown ids', () => {
    const p = base();
    expect(moveTrack(p, 'a', -1)).toBe(p);
    expect(moveTrack(p, 'c', 1)).toBe(p);
    expect(moveTrack(p, 'zzz', 1)).toBe(p);
    expect(order(moveTrack(p, 'c', -9))).toBe('cab');
  });
  it('keeps the tracks themselves (clips, slots) as they are', () => {
    const p = base();
    const moved = moveTrack(p, 'a', 1);
    expect(moved.tracks.find((t) => t.id === 'a')).toBe(p.tracks[0]);
  });
});

describe('moveTrackTo', () => {
  const base = () => {
    const p = createProject('T', 150, 'F minor');
    return { ...p, tracks: ['a', 'b', 'c'].map((id) => ({ ...createTrack('synth', 8, id, 'midi'), id })) };
  };
  const order = (p: ReturnType<typeof base>) => p.tracks.map((t) => t.id).join('');
  it('puts a track at a list position', () => {
    expect(order(moveTrackTo(base(), 'a', 2))).toBe('bca');
    expect(order(moveTrackTo(base(), 'c', 0))).toBe('cab');
    expect(order(moveTrackTo(base(), 'b', 7))).toBe('acb');
  });
  it('is unchanged for the same place or an unknown id', () => {
    const p = base();
    expect(moveTrackTo(p, 'b', 1)).toBe(p);
    expect(moveTrackTo(p, 'zzz', 0)).toBe(p);
  });
});

describe('toggleClipsMuted', () => {
  const withClips = () => {
    const p = createProject();
    const clip = (id: string, start: number) => ({ id, sampleId: 's', start, length: 4, offset: 0 });
    return mapTrack(mapTrack(p, p.tracks[0].id, (t) => ({ ...t, clips: [clip('a', 0), clip('b', 4)] })), p.tracks[1].id, (t) => ({ ...t, clips: [clip('c', 0)] }));
  };
  const muted = (p: ReturnType<typeof createProject>) => p.tracks.flatMap((t) => t.clips).filter((c) => c.muted).map((c) => c.id).sort();

  it('mutes the selected clips only', () => {
    expect(muted(toggleClipsMuted(withClips(), ['a', 'c']))).toEqual(['a', 'c']);
  });
  it('a mixed selection is muted, an all-muted one unmuted (and the field dropped)', () => {
    const once = toggleClipsMuted(withClips(), ['a']);
    expect(muted(toggleClipsMuted(once, ['a', 'b']))).toEqual(['a', 'b']);
    const off = toggleClipsMuted(toggleClipsMuted(once, ['a', 'b']), ['a', 'b']);
    expect(muted(off)).toEqual([]);
    expect('muted' in off.tracks[0].clips[0]).toBe(false);
  });
  it('unknown ids change nothing', () => {
    const p = withClips();
    expect(toggleClipsMuted(p, ['nope'])).toBe(p);
  });
});

describe('duplicateTrack', () => {
  const setup = () => {
    let p = createProject();
    const id = p.tracks[0].id;
    p = mapTrack(p, id, (t) => ({ ...t, solo: true, volume: 0.7, clips: [{ id: 'c1', sampleId: 's', start: 0, length: 4, offset: 0, gainDb: -3 }] }));
    p = addDevice(p, id, 'eq');
    const dev = p.tracks[0].devices![0].id;
    p = mapTrack(p, id, (t) => ({ ...t, automation: [{ param: `dev:${dev}:low` as const, points: [{ bar: 0, value: 0.2 }] }, { param: 'volume', points: [{ bar: 4, value: 0.5 }] }] }));
    return { p, id, dev };
  };

  it('puts a full copy right below with new ids', () => {
    const { p, id, dev } = setup();
    const r = duplicateTrack(p, id);
    const [orig, copy] = r.project.tracks;
    expect(r.project.tracks).toHaveLength(p.tracks.length + 1);
    expect(copy.id).toBe(r.trackId);
    expect(copy.id).not.toBe(orig.id);
    expect(copy.name).toBe(`${orig.name} Kopie`);
    expect(copy.solo).toBe(false);
    expect(copy.volume).toBe(0.7);
    expect(copy.clips).toHaveLength(1);
    expect(copy.clips[0].id).not.toBe('c1');
    expect(copy.clips[0].gainDb).toBe(-3);
    expect(copy.devices![0].id).not.toBe(dev);
    expect(copy.devices![0].type).toBe('eq');
    // device automation follows the copy's own device, track lanes stay as they are
    expect(copy.automation!.map((l) => l.param)).toEqual([`dev:${copy.devices![0].id}:low`, 'volume']);
    expect(r.project.tracks[2]).toBe(p.tracks[1]);
  });

  it('the copy is independent of the original', () => {
    const { p, id } = setup();
    const r = duplicateTrack(p, id);
    r.project.tracks[1].clips[0].start = 8;
    r.project.tracks[1].automation![1].points[0].value = 1;
    expect(r.project.tracks[0].clips[0].start).toBe(0);
    expect(r.project.tracks[0].automation![1].points[0].value).toBe(0.5);
  });

  it('an unknown track changes nothing', () => {
    const { p } = setup();
    expect(duplicateTrack(p, 'nope').project).toBe(p);
  });
});

describe('copyProject', () => {
  it('is an independent copy under a new id and name', () => {
    const p = createProject();
    const c = copyProject(p, 123);
    expect(c.id).not.toBe(p.id);
    expect(c.name).toBe(`${p.name} (Kopie)`);
    expect(c.updatedAt).toBe(123);
    expect(c.tracks).toEqual(p.tracks);
    c.tracks[0].volume = 0.1;
    expect(p.tracks[0].volume).not.toBe(0.1);
  });
});

describe('copyDevices', () => {
  const setup = () => {
    let p = createProject('x');
    const [a, b] = [p.tracks[0].id, p.tracks[1].id];
    p = addDevice(p, a, 'eq');
    p = addDevice(p, a, 'comp');
    p = addDevice(p, b, 'reverb');
    return { p, a, b };
  };
  it('appends copies with fresh ids and the same settings', () => {
    const { p, a, b } = setup();
    const q = copyDevices(p, a, b, 'append');
    const from = q.tracks.find((t) => t.id === a)!.devices!;
    const to = q.tracks.find((t) => t.id === b)!.devices!;
    expect(to.map((d) => d.type)).toEqual(['reverb', 'eq', 'comp']);
    expect(to[1].params).toEqual(from[0].params);
    expect(to[1].id).not.toBe(from[0].id);
  });
  it('replaces the target chain, can go to the master, and ignores itself', () => {
    const { p, a, b } = setup();
    expect(copyDevices(p, a, b, 'replace').tracks.find((t) => t.id === b)!.devices!.map((d) => d.type)).toEqual(['eq', 'comp']);
    expect(copyDevices(p, a, MASTER_ID).master?.devices).toHaveLength(2);
    expect(copyDevices(p, a, a)).toBe(p);
  });
  it('is a no-op for an empty source', () => {
    const { p, b } = setup();
    const empty = p.tracks[2].id;
    expect(copyDevices(p, empty, b)).toBe(p);
  });
});

describe('copyDevices with automation', () => {
  it('copies the knob curves of the copied devices onto the copies', () => {
    let p = createProject();
    const [a, b] = [p.tracks[0].id, p.tracks[1].id];
    p = addDevice(p, a, 'eq');
    const dev = p.tracks[0].devices![0].id;
    p = mapTrack(p, a, (t) => ({ ...t, automation: [{ param: `dev:${dev}:hp` as never, points: [{ bar: 0, value: 0.3 }] }] }));
    const q = copyDevices(p, a, b, 'append');
    const tb = q.tracks.find((t) => t.id === b)!;
    expect(tb.automation).toEqual([{ param: `dev:${tb.devices![0].id}:hp`, points: [{ bar: 0, value: 0.3 }] }]);
  });
});

describe('group tracks', () => {
  const base = () => {
    const p = createProject('T', 150, 'F minor');
    return { ...p, tracks: ['a', 'b', 'c'].map((id) => ({ ...createTrack('synth', 8, id, 'audio'), id })) };
  };
  const order = (p: ReturnType<typeof base>) => p.tracks.map((t) => (t.kind === 'group' ? 'G' : t.id)).join('');

  it('groupTracks puts a group where the first member is and routes the members into it', () => {
    const { project, groupId } = groupTracks(base(), ['b', 'c']);
    expect(order(project)).toBe('aGbc');
    expect(groupMembers(project, groupId!).map((t) => t.id)).toEqual(['b', 'c']);
    expect(project.tracks.find((t) => t.id === groupId)).toMatchObject({ kind: 'group', clips: [] });
  });
  it('does nothing for no tracks, unknown ids or groups', () => {
    const p = base();
    expect(groupTracks(p, []).project).toBe(p);
    expect(groupTracks(p, ['zzz']).groupId).toBeNull();
    const { project, groupId } = groupTracks(p, ['a']);
    expect(groupTracks(project, [groupId!]).project).toBe(project);
  });
  it('a group takes no clips', () => {
    const g = createGroupTrack(8);
    expect(canHoldClip(g, { id: 'x', sampleId: 's', start: 0, length: 1, offset: 0 })).toBe(false);
    expect(canHoldClip(g, { id: 'x', sampleId: '', notes: [], start: 0, length: 1, offset: 0 })).toBe(false);
  });
  it('setTrackGroup moves a track between groups and back, refusing bad targets', () => {
    const { project, groupId } = groupTracks(base(), ['a']);
    const two = setTrackGroup(project, 'b', groupId);
    expect(groupOf(two, two.tracks.find((t) => t.id === 'b')!)?.id).toBe(groupId);
    expect(setTrackGroup(two, 'b', null).tracks.find((t) => t.id === 'b')?.groupId).toBeUndefined();
    expect(setTrackGroup(project, 'b', 'c')).toBe(project); // c is no group
    expect(setTrackGroup(project, groupId!, groupId)).toBe(project); // groups do not nest
    expect(setTrackGroup(project, 'b', 'zzz')).toBe(project);
  });
  it('ungroup and removing the group route the members into the master again', () => {
    const { project, groupId } = groupTracks(base(), ['a', 'b']);
    for (const next of [ungroup(project, groupId!), removeTrack(project, groupId!)]) {
      expect(order(next)).toBe('abc');
      expect(next.tracks.every((t) => t.groupId === undefined)).toBe(true);
    }
    expect(ungroup(project, 'a')).toBe(project); // a is no group
  });
  it('a track and an audio track never turn into a group by setTrackKind', () => {
    const p = base();
    expect(setTrackKind(p, 'a', 'group')).toBe(p);
    const { project, groupId } = groupTracks(p, ['a']);
    expect(setTrackKind(project, groupId!, 'audio')).toBe(project);
  });
  it('repairProject drops a groupId that points nowhere', () => {
    const p = base();
    const broken = { ...p, tracks: p.tracks.map((t) => (t.id === 'a' ? { ...t, groupId: 'gone' } : t)) };
    expect(repairProject(broken).tracks[0].groupId).toBeUndefined();
    expect(repairProject(p)).toBe(p);
  });

  describe('audibleGains', () => {
    const grouped = () => {
      const { project, groupId } = groupTracks(base(), ['a', 'b']);
      return { project, groupId: groupId! };
    };
    const gain = (p: ReturnType<typeof base>, id: string) => audibleGains(p).get(id);
    it('is the volume of every track without mute or solo', () => {
      const { project, groupId } = grouped();
      expect(gain(project, 'a')).toBe(0.8);
      expect(gain(project, groupId)).toBe(1);
    });
    it('keeps a group audible while one of its tracks is soloed, and silences the others', () => {
      const { project, groupId } = grouped();
      const solo = mapTrack(project, 'a', (t) => ({ ...t, solo: true }));
      expect(gain(solo, 'a')).toBe(0.8);
      expect(gain(solo, groupId)).toBe(1);
      expect(gain(solo, 'b')).toBe(0);
      expect(gain(solo, 'c')).toBe(0);
    });
    it('soloing a group lets all its tracks through', () => {
      const { project, groupId } = grouped();
      const solo = mapTrack(project, groupId, (t) => ({ ...t, solo: true }));
      expect(gain(solo, 'a')).toBe(0.8);
      expect(gain(solo, 'b')).toBe(0.8);
      expect(gain(solo, 'c')).toBe(0);
    });
    it('muting the group mutes only the group strip, the tracks stay as they are', () => {
      const { project, groupId } = grouped();
      const muted = mapTrack(project, groupId, (t) => ({ ...t, muted: true }));
      expect(gain(muted, groupId)).toBe(0);
      expect(gain(muted, 'a')).toBe(0.8);
    });
  });
});

describe('freezing a track', () => {
  const frozenTrack = (): ReturnType<typeof createMidiTrack> => ({
    ...createMidiTrack(8, 'Lead'),
    id: 'lead',
    clips: [{ ...createMidiClip(0, 4), notes: [{ pitch: 60, start: 0, length: 1, velocity: 1 }] }],
    devices: [{ id: 'd', type: 'eq', on: true, params: {} }],
    automation: [{ param: 'filter', points: [{ bar: 0, value: 0 }] }],
    fx: { filter: 0.4, reverb: 0.3, pan: -0.5 },
    frozen: { sampleId: 'freeze:lead', bars: 6 },
  });
  const proj = (...tracks: ReturnType<typeof frozenTrack>[]): Project => ({ ...createProject('T', 150, 'E minor'), tracks });

  it('plays the render instead of the clips', () => {
    const t = frozenTrack();
    expect(playClips(t)).toEqual([frozenClip(t.frozen!)]);
    expect(frozenClip(t.frozen!)).toMatchObject({ sampleId: 'freeze:lead', start: 0, length: 6, offset: 0 });
    expect(playClips({ ...t, frozen: undefined })).toBe(t.clips);
  });
  it('arrangementSampleIds lists the render, not what it was made from', () => {
    const ids = arrangementSampleIds(proj(frozenTrack()));
    expect([...ids]).toEqual(['freeze:lead']);
  });
  it('playProject switches off the baked effects and pan but keeps the fader and the notes for the sidechain', () => {
    const p = proj(frozenTrack());
    const out = playProject(p).tracks[0];
    expect(out.devices).toBeUndefined();
    expect(out.automation).toBeUndefined();
    expect(out.fx).toBeUndefined();
    expect(out.clips).toBe(p.tracks[0].clips);
    expect(out.volume).toBe(p.tracks[0].volume);
  });
  it('playProject and thawProject return the same project when nothing is frozen', () => {
    const p = proj({ ...frozenTrack(), frozen: undefined });
    expect(playProject(p)).toBe(p);
    expect(thawProject(p)).toBe(p);
  });
  it('thawProject removes every freeze and keeps the rest', () => {
    const p = proj(frozenTrack());
    const t = thawProject(p).tracks[0];
    expect(t.frozen).toBeUndefined();
    expect(t.devices).toBe(p.tracks[0].devices);
  });

  describe('invalidateFrozen', () => {
    const edit = (p: Project, fn: (t: ReturnType<typeof frozenTrack>) => ReturnType<typeof frozenTrack>) => ({ ...p, tracks: p.tracks.map(fn) }) as Project;
    it('keeps the freeze for fader, mute, solo, name and colour', () => {
      const p = proj(frozenTrack());
      const after = edit(p, (t) => ({ ...t, volume: 0.3, muted: true, solo: true, name: 'X', color: '#fff' }));
      expect(invalidateFrozen(p, after)).toEqual({ project: after, thawed: [] });
    });
    it.each([
      ['clips', (t: ReturnType<typeof frozenTrack>) => ({ ...t, clips: [...t.clips] })],
      ['instrument', (t: ReturnType<typeof frozenTrack>) => ({ ...t, synth: { ...(t.synth as object) } as never })],
      ['devices', (t: ReturnType<typeof frozenTrack>) => ({ ...t, devices: [] })],
      ['automation', (t: ReturnType<typeof frozenTrack>) => ({ ...t, automation: [] })],
      ['reverb send', (t: ReturnType<typeof frozenTrack>) => ({ ...t, fx: { ...t.fx, reverb: 0.9 } })],
      ['filter', (t: ReturnType<typeof frozenTrack>) => ({ ...t, fx: { ...t.fx, filter: 0 } })],
      ['pan (it is baked in)', (t: ReturnType<typeof frozenTrack>) => ({ ...t, fx: { ...t.fx, pan: 0.9 } })],
    ])('thaws when the %s change', (_name, change) => {
      const p = proj(frozenTrack());
      const r = invalidateFrozen(p, edit(p, change));
      expect(r.thawed).toEqual(['Lead']);
      expect(r.project.tracks[0].frozen).toBeUndefined();
    });
    it('thaws every frozen track when the tempo changes', () => {
      const p = proj(frozenTrack());
      const r = invalidateFrozen(p, { ...p, bpm: 160 });
      expect(r.thawed).toEqual(['Lead']);
    });
    it('leaves other tracks alone and does nothing for an unchanged project', () => {
      const p = proj(frozenTrack(), { ...frozenTrack(), id: 'b', name: 'B', frozen: { sampleId: 'freeze:b', bars: 2 } });
      const after = edit(p, (t) => (t.id === 'b' ? { ...t, devices: [] } : t));
      const r = invalidateFrozen(p, after);
      expect(r.thawed).toEqual(['B']);
      expect(r.project.tracks[0].frozen).toBeDefined();
      expect(invalidateFrozen(p, p).project).toBe(p);
    });
  });
});
