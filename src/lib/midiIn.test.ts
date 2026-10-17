import { createMidiClip, createMidiTrack, createProject } from './project';
import type { Project } from '../types';
import { DEFAULT_CC_MAP, NoteRecorder, applyCc, ccOf, cleanCcMap, learnCc, parseMidiMessage, placeMidiTake } from './midiIn';

describe('parseMidiMessage', () => {
  it('reads note on and off with the velocity as 0..1', () => {
    expect(parseMidiMessage([0x90, 60, 127])).toEqual({ type: 'noteOn', channel: 0, note: 60, velocity: 1 });
    expect(parseMidiMessage([0x93, 36, 64])).toMatchObject({ type: 'noteOn', channel: 3, note: 36 });
    expect(parseMidiMessage([0x80, 60, 40])).toEqual({ type: 'noteOff', channel: 0, note: 60 });
  });
  it('treats a note on with velocity 0 as a note off', () => {
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({ type: 'noteOff', channel: 0, note: 60 });
  });
  it('reads control changes', () => {
    expect(parseMidiMessage([0xb0, 74, 127])).toEqual({ type: 'cc', channel: 0, controller: 74, value: 1 });
    expect((parseMidiMessage([0xb1, 7, 64]) as { value: number }).value).toBeCloseTo(0.504, 2);
  });
  it('ignores clock, pitch bend and short messages', () => {
    expect(parseMidiMessage([0xf8]).type).toBe('other');
    expect(parseMidiMessage([0xe0, 0, 64]).type).toBe('other');
    expect(parseMidiMessage([0x90]).type).toBe('other');
    expect(parseMidiMessage([]).type).toBe('other');
  });
});

describe('cc map', () => {
  it('learn makes it one-to-one', () => {
    const m = learnCc(DEFAULT_CC_MAP, 21, 'filter');
    expect(m[21]).toBe('filter');
    expect(m[74]).toBeUndefined(); // the filter left its old CC
    expect(ccOf(m, 'filter')).toBe(21);
    const swapped = learnCc(m, 7, 'reverb'); // CC 7 was the volume
    expect(swapped[7]).toBe('reverb');
    expect(ccOf(swapped, 'volume')).toBeUndefined();
  });
  it('cleans stored data and falls back to the defaults', () => {
    expect(cleanCcMap(null)).toEqual(DEFAULT_CC_MAP);
    expect(cleanCcMap({ 200: 'pan', 5: 'nope', 12: 'drive', x: 'pan' })).toEqual({ 12: 'drive' });
    expect(cleanCcMap({})).toEqual(DEFAULT_CC_MAP);
  });
});

describe('applyCc', () => {
  const base = (): { p: Project; id: string } => {
    const p = createProject('T', 150, 'F minor');
    return { p, id: p.tracks[0].id };
  };
  it('moves the fader over 0..1.5', () => {
    const { p, id } = base();
    expect(applyCc(p, id, 'volume', 1).tracks[0].volume).toBe(1.5);
    expect(applyCc(p, id, 'volume', 0).tracks[0].volume).toBe(0);
  });
  it('maps the filter and pan to -1..1 with a dead zone in the middle', () => {
    const { p, id } = base();
    expect(applyCc(p, id, 'filter', 0).tracks[0].fx?.filter).toBe(-1);
    expect(applyCc(p, id, 'filter', 1).tracks[0].fx?.filter).toBe(1);
    expect(applyCc(p, id, 'filter', 0.51).tracks[0].fx?.filter ?? 0).toBe(0);
    expect(applyCc(p, id, 'pan', 0.25).tracks[0].fx?.pan).toBe(-0.5);
  });
  it('maps drive, reverb, delay and pump to 0..1 and keeps the other effects', () => {
    const { p, id } = base();
    const t = applyCc(applyCc(p, id, 'reverb', 0.4), id, 'drive', 0.7).tracks[0];
    expect(t.fx).toMatchObject({ reverb: 0.4, drive: 0.7 });
  });
  it('returns the same project when nothing changes', () => {
    const { p, id } = base();
    const once = applyCc(p, id, 'reverb', 0.4);
    expect(applyCc(once, id, 'reverb', 0.4).tracks[0]).toBe(once.tracks[0]);
  });
});

describe('NoteRecorder', () => {
  it('records notes relative to the clip start with their length and velocity', () => {
    const r = new NoteRecorder(4);
    r.noteOn(60, 0.8, 4.5);
    r.noteOff(60, 5);
    r.noteOn(64, 0.5, 5.25);
    r.noteOff(64, 5.5);
    expect(r.finish(6)).toEqual([
      { pitch: 60, start: 0.5, length: 0.5, velocity: 0.8 },
      { pitch: 64, start: 1.25, length: 0.25, velocity: 0.5 },
    ]);
  });
  it('closes held notes at the end and ends a retriggered note', () => {
    const r = new NoteRecorder(0);
    r.noteOn(60, 1, 1);
    r.noteOn(60, 1, 2);
    expect(r.finish(3).map((n) => [n.start, n.length])).toEqual([[1, 1], [2, 1]]);
  });
  it('ignores a note off without a note on and clamps early notes to the start', () => {
    const r = new NoteRecorder(2);
    r.noteOff(60, 3);
    r.noteOn(62, 1, 1.9);
    expect(r.count).toBe(1);
    expect(r.finish(3)[0].start).toBe(0);
  });
  it('can snap to sixteenths', () => {
    const r = new NoteRecorder(0);
    r.noteOn(60, 1, 0.07);
    r.noteOff(60, 0.3);
    const [n] = r.finish(1, true);
    expect(n.start).toBeCloseTo(0.0625, 6);
    expect(n.length).toBeCloseTo(0.25, 6);
  });
});

describe('placeMidiTake', () => {
  const setup = () => {
    const p = createProject('T', 150, 'F minor');
    const track = createMidiTrack(8);
    return { p: { ...p, tracks: [track] } as Project, id: track.id };
  };
  const notes = [{ pitch: 60, start: 0, length: 0.5, velocity: 1 }];
  it('makes a new clip', () => {
    const { p, id } = setup();
    const r = placeMidiTake(p, id, notes, 2, 2, 'c1');
    expect(r.project.tracks[0].clips).toEqual([{ id: 'c1', sampleId: '', start: 2, length: 2, offset: 0, notes }]);
  });
  it('overdubs into the clip that starts at the same bar and keeps the longer length', () => {
    const { p, id } = setup();
    const clip = { ...createMidiClip(2, 1), id: 'old', notes: [{ pitch: 36, start: 0, length: 0.25, velocity: 1 }] };
    const r = placeMidiTake({ ...p, tracks: [{ ...p.tracks[0], clips: [clip] }] }, id, notes, 2, 2, 'new');
    expect(r.clipId).toBe('old');
    expect(r.project.tracks[0].clips).toHaveLength(1);
    expect(r.project.tracks[0].clips[0].length).toBe(2);
    expect(r.project.tracks[0].clips[0].notes!.map((n) => n.pitch)).toEqual([36, 60]);
  });
  it('does nothing without notes or for an unknown track', () => {
    const { p, id } = setup();
    expect(placeMidiTake(p, id, [], 0, 1, 'x').project).toBe(p);
    expect(placeMidiTake(p, 'zzz', notes, 0, 1, 'x').project).toBe(p);
  });
});
