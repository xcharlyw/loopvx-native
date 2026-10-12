import type { Project, Sample, Track } from '../types';
import { laneOf, laneValue } from './automation';
import { arrange, candidates, roleOf, sectionsFor } from './arranger';
import { createProject, createTrack, trackSynth } from './project';

const sample = (id: string, category: Sample['category'], extra: Partial<Sample> = {}): Sample => ({ id, name: `${id}.wav`, category, addedAt: 1, ...extra });
const base = (): Project => createProject('T', 150, 'F minor');
const opts = { length: 128 as const, seed: 7, addMissingTracks: true, automation: true };
const overlaps = (t: Track) => t.clips.some((a, i) => t.clips.some((b, j) => i < j && a.start < b.start + b.length - 1e-9 && b.start < a.start + a.length - 1e-9));

describe('sectionsFor', () => {
  for (const length of [64, 128] as const) {
    it(`${length} bars: contiguous sections that fill the arrangement`, () => {
      const s = sectionsFor(length);
      expect(s[0].start).toBe(0);
      s.slice(1).forEach((sec, i) => expect(sec.start).toBe(s[i].start + s[i].bars));
      const last = s[s.length - 1];
      expect(last.start + last.bars).toBe(length);
      expect(s.map((x) => x.id)).toEqual(['intro', 'build', 'drop', 'break', 'build2', 'drop2', 'outro']);
    });
  }
});

describe('roleOf', () => {
  it('reads audio roles from the category and MIDI roles from the instrument', () => {
    expect(roleOf(createTrack('kick', 8))).toBe('kickLoop');
    expect(roleOf(createTrack('vocal', 8))).toBe('vocal');
    const drums = { ...createTrack('kick', 8, 'D', 'midi'), synth: { wave: 'kit909', cutoff: 1, resonance: 1, attack: 0, decay: 0, sustain: 0, release: 0 } as Track['synth'] };
    expect(roleOf(drums as Track)).toBe('drums');
    expect(roleOf({ ...createTrack('synth', 8, 'Rumble Bass', 'midi') })).toBe('bass');
    expect(roleOf({ ...createTrack('synth', 8, 'Pad', 'midi') })).toBe('pad');
  });
});

describe('arrange without a library', () => {
  const r = arrange(base(), [], opts);
  it('adds drums, bass and lead tracks and fills them', () => {
    expect(r.added).toEqual(['Drums 909', 'Rumble Bass', 'Lead', 'Pad']);
    const names = r.project.tracks.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['Drums 909', 'Rumble Bass', 'Lead', 'Pad']));
    for (const name of ['Drums 909', 'Rumble Bass', 'Lead', 'Pad']) {
      const t = r.project.tracks.find((x) => x.name === name)!;
      expect(t.clips.length).toBeGreaterThan(3);
      expect(t.clips.every((c) => c.notes && c.notes.length > 0 && c.start >= 0 && c.start + c.length <= 128 + 1e-9)).toBe(true);
      expect(overlaps(t)).toBe(false);
    }
    expect(r.missingSamples).toEqual(['Kick + Bass', 'Top Loop', 'Synth / Lead', 'Vocals']);
  });
  it('leaves the break without kick and bass and opens the drops with a crash', () => {
    const drums = r.project.tracks.find((t) => t.name === 'Drums 909')!;
    const bass = r.project.tracks.find((t) => t.name === 'Rumble Bass')!;
    const brk = r.sections.find((s) => s.id === 'break')!;
    const inBreak = (t: Track) => t.clips.some((c) => c.start < brk.start + brk.bars && c.start + c.length > brk.start);
    expect(inBreak(drums)).toBe(false);
    expect(inBreak(bass)).toBe(false);
    const drop = r.sections.find((s) => s.id === 'drop')!;
    const dropClip = drums.clips.find((c) => c.start === drop.start)!;
    expect(dropClip.notes!.some((n) => n.pitch === 49 && n.start === 0)).toBe(true);
  });
  it('rolls the snare in the last bar of each build-up', () => {
    const drums = r.project.tracks.find((t) => t.name === 'Drums 909')!;
    const build = r.sections.find((s) => s.id === 'build')!;
    const roll = drums.clips.find((c) => c.start === build.start + build.bars - 1)!;
    expect(roll.length).toBe(1);
    expect(roll.notes!.length).toBe(16);
    expect(roll.notes![15].velocity).toBeGreaterThan(roll.notes![0].velocity);
  });
  it('is deterministic for a seed and differs between seeds', () => {
    const pitches = (res: typeof r) => JSON.stringify(res.project.tracks.map((t) => t.clips.map((c) => [c.start, c.length, c.notes?.length])));
    expect(pitches(arrange(base(), [], opts))).toBe(pitches(arrange(base(), [], opts)));
    expect(pitches(arrange(base(), [], { ...opts, seed: 99 }))).not.toBe(pitches(r));
  });
  it('builds the automation: a filter that opens into the drop, a reverb throw and a fade-out', () => {
    const lead = r.project.tracks.find((t) => t.name === 'Lead')!;
    const build = r.sections.find((s) => s.id === 'build')!;
    const drop = r.sections.find((s) => s.id === 'drop')!;
    const filter = laneOf(lead, 'filter');
    expect(laneValue(filter, build.start)).toBeLessThan(-0.7);
    expect(laneValue(filter, drop.start)).toBeCloseTo(0, 5);
    const reverb = laneOf(lead, 'reverb');
    expect(laneValue(reverb, drop.start - 1)).toBeGreaterThan(0.2);
    expect(laneValue(reverb, drop.start + 1)).toBeLessThan(0.15);
    const vol = laneOf(r.project.tracks.find((t) => t.name === 'Drums 909')!, 'volume');
    expect(laneValue(vol, 128)).toBe(0);
    expect(laneValue(vol, 100)).toBe(1);
  });
  it('can skip the automation and the extra tracks', () => {
    const plain = arrange(base(), [], { ...opts, automation: false, addMissingTracks: false });
    expect(plain.added).toEqual([]);
    expect(plain.project.tracks.every((t) => !t.automation)).toBe(true);
  });
  it('gives the bass a pump and keeps instruments', () => {
    const bass = arrange(base(), [], opts).project.tracks.find((t) => t.name === 'Rumble Bass')!;
    expect(bass.fx?.pump).toBeGreaterThan(0);
    expect(trackSynth(bass).wave).toBe('sawtooth');
  });
});

describe('arrange with a library', () => {
  const lib = [
    sample('k1', 'kick', { bpm: 150 }),
    sample('far', 'kick', { bpm: 190 }),
    sample('t1', 'top', { bpm: 150 }),
    sample('s1', 'synth', { bpm: 150, key: 'F minor' }),
    sample('s2', 'synth', { bpm: 150, key: 'E minor' }),
    sample('v1', 'vocal'),
  ];
  const r = arrange(base(), lib, opts);
  it('puts the best-matching samples on the audio tracks', () => {
    const by = (name: string) => r.project.tracks.find((t) => t.name === name)!;
    expect(new Set(by('Kick + Bass').clips.map((c) => c.sampleId))).toEqual(new Set(['k1']));
    expect(new Set(by('Synth / Lead').clips.map((c) => c.sampleId))).toEqual(new Set(['s1'])); // E minor clashes with F minor
    expect(by('Vocals').clips.length).toBeGreaterThan(0);
    expect(r.missingSamples).toEqual([]);
    for (const t of r.project.tracks) expect(overlaps(t)).toBe(false);
  });
  it('lets the kick loop carry the kick: the 909 plays no kick pad', () => {
    const drums = r.project.tracks.find((t) => t.name === 'Drums 909')!;
    expect(drums.clips.flatMap((c) => c.notes ?? []).some((n) => n.pitch === 36)).toBe(false);
  });
  it('filters candidates by category, tempo and key', () => {
    expect(candidates(lib, 'kick', { bpm: 150, key: 'F minor' }).map((s) => s.id)).toEqual(['k1']);
    expect(candidates(lib, 'synth', { bpm: 150, key: 'F minor' }).map((s) => s.id)).toEqual(['s1']);
  });
});

describe('the short arrangement', () => {
  it('fits in 64 bars', () => {
    const r = arrange(base(), [], { ...opts, length: 64 });
    for (const t of r.project.tracks) {
      expect(t.clips.every((c) => c.start + c.length <= 64 + 1e-9)).toBe(true);
      expect(overlaps(t)).toBe(false);
    }
  });
});
