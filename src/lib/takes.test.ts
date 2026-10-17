import type { Clip, Project, Track } from '../types';
import { createProject, createTrack, createMidiTrack } from './project';
import { placeTake, recordTarget, recordingTrack, trimTake } from './takes';

const clip = (id: string, start: number, length: number, extra: Partial<Clip> = {}): Clip => ({ id, sampleId: id, start, length, offset: 0, ...extra });
const base = (tracks: Track[]): Project => ({ ...createProject('T', 150, 'F minor'), tracks });
const audio = (id: string, name: string, clips: Clip[] = [], category: Track['category'] = 'top'): Track => ({ ...createTrack(category, 8, name), id, clips });

describe('recordTarget', () => {
  it('takes the selected audio track', () => {
    const p = base([audio('a', 'Top'), audio('v', 'Vocals', [], 'vocal')]);
    expect(recordTarget(p, 'a').trackId).toBe('a');
  });
  it('falls back to the vocals track when a MIDI track or nothing is selected', () => {
    const p = base([{ ...createMidiTrack(8), id: 'm' }, audio('v', 'Vocals', [], 'vocal')]);
    expect(recordTarget(p, 'm').trackId).toBe('v');
    expect(recordTarget(p, null).trackId).toBe('v');
  });
  it('wants a new track when there is no audio track at all', () => {
    expect(recordTarget(base([{ ...createMidiTrack(8), id: 'm' }]), 'm').trackId).toBeNull();
  });
});

describe('trimTake', () => {
  const x = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  it('cuts the start (count-in, latency)', () => {
    expect([...trimTake(x, 4, 1)]).toEqual([5, 6, 7, 8]);
    expect(trimTake(x, 4, 0)).toBe(x);
  });
  it('is empty when the whole take is cut', () => {
    expect(trimTake(x, 4, 5)).toHaveLength(0);
  });
  it('a negative trim adds silence in front', () => {
    expect([...trimTake(x, 4, -0.5)]).toEqual([0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('placeTake', () => {
  it('puts the clip on the track when the spot is free', () => {
    const p = base([audio('a', 'Vocals', [clip('old', 0, 4)])]);
    const r = placeTake(p, 'a', clip('new', 4, 2));
    expect(r.trackId).toBe('a');
    expect(r.project.tracks[0].clips.map((c) => c.id)).toEqual(['old', 'new']);
  });
  it('makes a take track below when it lands on a clip, and mutes the covered clip', () => {
    const p = base([audio('a', 'Vocals', [clip('old', 0, 4)]), audio('b', 'Synth')]);
    const r = placeTake(p, 'a', clip('new', 2, 4), 'take2');
    expect(r.trackId).toBe('take2');
    expect(r.project.tracks.map((t) => t.name)).toEqual(['Vocals', 'Vocals Take 2', 'Synth']);
    expect(r.project.tracks[0].clips[0].muted).toBe(true);
    expect(r.project.tracks[1].clips.map((c) => [c.id, c.muted])).toEqual([['new', undefined]]);
  });
  it('the third take goes below the second and mutes the clip it covers there', () => {
    const p = base([audio('a', 'Vocals', [clip('c1', 0, 4)])]);
    const two = placeTake(p, 'a', clip('c2', 0, 4), 't2').project;
    const three = placeTake(two, 'a', clip('c3', 1, 2), 't3');
    expect(three.project.tracks.map((t) => t.name)).toEqual(['Vocals', 'Vocals Take 2', 'Vocals Take 3']);
    expect(three.project.tracks.map((t) => t.clips.map((c) => c.muted ?? false))).toEqual([[true], [true], [false]]);
  });
  it('recording on a take track continues the family of its base name', () => {
    const p = base([audio('a', 'Vocals', [clip('c1', 0, 4, { muted: true })]), audio('t2', 'Vocals Take 2', [clip('c2', 0, 4)])]);
    const r = placeTake(p, 't2', clip('c3', 0, 4));
    expect(r.project.tracks.map((t) => t.name)).toEqual(['Vocals', 'Vocals Take 2', 'Vocals Take 3']);
  });
  it('does not mute clips that are not covered', () => {
    const p = base([audio('a', 'Vocals', [clip('c1', 0, 2), clip('c2', 8, 2)])]);
    const r = placeTake(p, 'a', clip('n', 1, 2));
    expect(r.project.tracks[0].clips.map((c) => c.muted ?? false)).toEqual([true, false]);
  });
  it('is unchanged for an unknown track', () => {
    const p = base([audio('a', 'Vocals')]);
    expect(placeTake(p, 'zzz', clip('n', 0, 1)).project).toBe(p);
  });
});

describe('recordingTrack', () => {
  it('is an empty audio track called Aufnahme', () => {
    const t = recordingTrack(base([]), 'x');
    expect(t).toMatchObject({ id: 'x', name: 'Aufnahme', kind: 'audio', clips: [] });
  });
});
