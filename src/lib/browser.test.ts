import { createProject, createMidiTrack, createTrack } from './project';
import { shortKey, fxGroups, fxTarget, matchesAll, midiFxGroups, midiTarget, sampleMatches, searchWords, soundGroups, stepSelection } from './browser';
import type { Sample } from '../types';
import type { UserDevicePreset } from './userPresets';

const sample = (patch: Partial<Sample>): Sample => ({ id: 'a', name: 'Rumble Kick 01.wav', category: 'kick', addedAt: 0, ...patch });

describe('search', () => {
  it('splits into lower-case words', () => {
    expect(searchWords('  Hard  KICK ')).toEqual(['hard', 'kick']);
  });
  it('needs every word somewhere, in any order', () => {
    expect(matchesAll(['Hard Kick', 'SSE Pack'], ['kick', 'sse'])).toBe(true);
    expect(matchesAll(['Hard Kick'], ['kick', 'snare'])).toBe(false);
    expect(matchesAll(['x'], [])).toBe(true);
  });
  it('finds samples by name, folder, tempo, key and loop / one-shot', () => {
    const loop = sample({ bpm: 150, key: 'Fm', folder: 'SSE Pack/Loops' });
    expect(sampleMatches(loop, searchWords('rumble 150'))).toBe(true);
    expect(sampleMatches(loop, searchWords('sse fm'))).toBe(true);
    expect(sampleMatches(loop, searchWords('loop'))).toBe(true);
    expect(sampleMatches(loop, searchWords('one-shot'))).toBe(false);
    expect(sampleMatches(sample({}), searchWords('oneshot kick'))).toBe(true);
    expect(sampleMatches(loop, searchWords('155'))).toBe(false);
  });
});

describe('lists', () => {
  it('keeps drum sounds apart from the synth sounds', () => {
    const synth = soundGroups([], false);
    const drums = soundGroups([], true);
    expect(synth.map((g) => g.title)).not.toContain('Drums');
    expect(drums.map((g) => g.title)).toEqual(['Drums']);
    expect(synth.reduce((n, g) => n + g.items.length, 0)).toBeGreaterThan(40);
  });
  it('filters sounds by the search', () => {
    const reese = soundGroups(searchWords('reese'), false);
    expect(reese.length).toBeGreaterThan(0);
    expect(reese.every((g) => g.items.every((p) => /reese/i.test(`${p.name} ${p.hint}`)))).toBe(true);
    expect(soundGroups(searchWords('zzzz'), false)).toEqual([]);
  });
  it('lists every effect but Splice, with all presets when the device itself matches', () => {
    const all = fxGroups([]).flatMap((g) => g.items);
    expect(all.some((x) => x.type === 'splice')).toBe(false);
    expect(all.some((x) => x.type === 'eq')).toBe(true);
    const comp = fxGroups(searchWords('compressor')).flatMap((g) => g.items);
    expect(comp.map((x) => x.type)).toEqual(['comp']);
    expect(comp[0].presets.length).toBeGreaterThan(1);
  });
  it('lists only the matching presets when the search names a preset', () => {
    const hits = fxGroups(searchWords('trance gate')).flatMap((g) => g.items);
    expect(hits.map((x) => x.type)).toEqual(['shaper']);
    expect(hits[0].presets.map((p) => p.name)).toEqual(['Trance Gate']);
  });
  it('puts the user’s own presets first', () => {
    const mine: UserDevicePreset = { id: 'u1', type: 'eq', name: 'Mein Kick EQ', params: {}, user: true };
    const eq = fxGroups([], [mine]).flatMap((g) => g.items).find((x) => x.type === 'eq')!;
    expect(eq.presets[0]).toBe(mine);
    expect(fxGroups(searchWords('mein kick'), [mine]).flatMap((g) => g.items).map((x) => x.type)).toEqual(['eq']);
  });
  it('lists arpeggiator and sequencer presets', () => {
    const groups = midiFxGroups([]);
    expect(groups.map((g) => g.kind)).toEqual(['arp', 'seq']);
    expect(midiFxGroups(searchWords('arpeggiator')).map((g) => g.kind)).toEqual(['arp']);
  });
});

describe('targets', () => {
  const project = createProject();
  const midi = createMidiTrack(project.sceneCount);
  const audio = createTrack('kick', project.sceneCount);
  const p = { ...project, tracks: [audio, midi] };
  it('sends sounds to the selected MIDI track, or to a new one', () => {
    expect(midiTarget(p, midi.id)).toBe(midi.id);
    expect(midiTarget(p, audio.id)).toBeNull();
    expect(midiTarget(p, null)).toBeNull();
  });
  it('sends effects to the selected track of any kind', () => {
    expect(fxTarget(p, audio.id)).toBe(audio.id);
    expect(fxTarget(p, 'gone')).toBeNull();
  });
});

describe('arrow keys', () => {
  it('moves through the list and stops at its ends', () => {
    const ids = ['a', 'b', 'c'];
    expect(stepSelection(ids, null, 1)).toBe('a');
    expect(stepSelection(ids, null, -1)).toBe('c');
    expect(stepSelection(ids, 'b', 1)).toBe('c');
    expect(stepSelection(ids, 'c', 1)).toBe('c');
    expect(stepSelection(ids, 'a', -1)).toBe('a');
    expect(stepSelection(ids, 'gone', 1)).toBe('a');
    expect(stepSelection([], 'a', 1)).toBeNull();
  });
});

describe('key column', () => {
  it('shortens keys like Live', () => {
    expect(shortKey('F minor')).toBe('Fm');
    expect(shortKey('A# major')).toBe('A#');
    expect(shortKey('Am')).toBe('Am');
    expect(shortKey('C#')).toBe('C#');
    expect(shortKey('Eb min')).toBe('Ebm');
    expect(shortKey(undefined)).toBe('');
    expect(shortKey('weird')).toBe('weird');
  });
});
