import type { Project, Sample, Track } from '../types';
import { laneOf, laneValue } from './automation';
import { arrange, candidates, findFxSample, roleOf, sectionsFor } from './arranger';
import { planSections, withUserWords } from './arrangePlan';
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
  it('names the sections as markers', () => {
    expect(r.project.markers!.map((m) => [m.bar, m.name])).toEqual(r.sections.map((s) => [s.start, s.label]));
  });
  it('can skip the automation and the extra tracks', () => {
    const plain = arrange(base(), [], { ...opts, automation: false, addMissingTracks: false });
    expect(plain.added).toEqual([]);
    expect(plain.project.tracks.every((t) => !t.automation)).toBe(true);
  });
  it('gives the bass a pump on the 909 kick and keeps instruments', () => {
    const res = arrange(base(), [], opts).project;
    const bass = res.tracks.find((t) => t.name === 'Rumble Bass')!;
    expect(bass.fx?.pump).toBeGreaterThan(0);
    expect(bass.fx?.pumpFrom).toBe(res.tracks.find((t) => t.name === 'Drums 909')!.id);
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

describe('arrange from a plan', () => {
  const sections = planSections({
    sections: [
      { type: 'intro', bars: 8 },
      { type: 'drop', bars: 16 },
      { type: 'break', bars: 16, mute: ['pad'] },
      { type: 'drop', bars: 16, name: 'Finale' },
      { type: 'outro', bars: 8 },
    ],
  });
  const r = arrange(base(), [], { ...opts, sections, styles: { bass: 'acid' }, addRoles: ['drums', 'bass', 'pad'] });
  const track = (name: string) => r.project.tracks.find((t) => t.name === name)!;

  it('uses the plan length, its markers and only the roles asked for', () => {
    expect(r.added).toEqual(['Drums 909', 'Rumble Bass', 'Pad']);
    expect(r.project.markers?.map((m) => m.name)).toEqual(['Intro', 'Drop 1', 'Break', 'Finale', 'Outro']);
    const end = Math.max(...r.project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.length)));
    expect(end).toBeLessThanOrEqual(64);
  });

  it('keeps a muted role out of its section', () => {
    expect(track('Pad').clips.some((c) => c.start < 40 && c.start + c.length > 24)).toBe(false);
  });

  it('plays the planned bass style', () => {
    const bass = track('Rumble Bass');
    expect(bass.clips.length).toBeGreaterThan(0);
    const plain = arrange(base(), [], { ...opts, sections, addRoles: ['bass'] }).project.tracks.find((t) => t.name === 'Rumble Bass')!;
    expect(JSON.stringify(bass.clips.map((c) => c.notes))).not.toEqual(JSON.stringify(plain.clips.map((c) => c.notes)));
  });
});

describe('effect sounds', () => {
  const fxSample = (name: string, extra: Partial<Sample> = {}): Sample => ({ id: name, name: `${name}.wav`, category: 'other', addedAt: 1, ...extra });
  const lib = [
    fxSample('Dark Impact 03', { duration: 2.4 }),
    fxSample('Long Impact Tail', { duration: 20 }),
    fxSample('SSE Pattern 05 Perc FX', { bpm: 155, duration: 3.1 }),
    fxSample('Rise Sweep 8 Bars', { duration: 12 }),
    sample('vocal-impact', 'vocal', { name: 'Impact Shout.wav' }),
    sample('kick1', 'kick'),
  ];

  it('finds a sample by its name, then by words, and never a vocal', () => {
    expect(findFxSample(lib, { kind: 'impact', sample: 'sse pattern 05 perc fx' })?.id).toBe('SSE Pattern 05 Perc FX');
    expect(findFxSample(lib, { kind: 'impact', search: ['impact'] })?.name).toBe('Dark Impact 03.wav');
    expect(findFxSample(lib, { kind: 'riser' })?.id).toBe('Rise Sweep 8 Bars');
    expect(findFxSample(lib, { kind: 'crash' })).toBeUndefined();
    // vocals stay out of the fallback by the kind's words, but not when the user's own word names them
    expect(findFxSample([sample('vocal-impact', 'vocal', { name: 'Impact Shout.wav' })], { kind: 'impact' })).toBeUndefined();
    expect(findFxSample([sample('vocal-impact', 'vocal', { name: 'Impact Shout.wav' })], { kind: 'impact', search: ['impact'] })?.id).toBe('vocal-impact');
  });

  it('puts the effect on a new audio track at the bar, the length of the sample', () => {
    const r = arrange(base(), lib.filter((x) => x.category !== 'vocal'), { ...opts, addMissingTracks: false, fx: [{ kind: 'impact', bar: 64, search: ['impact'] }] });
    const track = r.project.tracks.find((t) => t.name === 'Impact FX')!;
    expect(r.added).toContain('Impact FX');
    expect(track.kind).toBe('audio');
    expect(track.clips).toHaveLength(1);
    expect(track.clips[0].start).toBe(64);
    expect(track.clips[0].sampleId).toBe('Dark Impact 03');
    expect(track.clips[0].length).toBeGreaterThan(0.25);
    expect(r.fx).toEqual([{ track: 'Impact FX', bar: 65, sample: 'Dark Impact 03' }]);
    expect(r.fxMissing).toEqual([]);
  });

  it('says what it could not find instead of pretending', () => {
    const r = arrange(base(), [sample('kick1', 'kick')], { ...opts, addMissingTracks: false, fx: [{ kind: 'impact', bar: 64 }] });
    expect(r.fxMissing).toEqual(['Impact FX (Takt 65, gesucht: impact, hit, boom, slam)']);
    expect(r.project.tracks.some((t) => t.name === 'Impact FX')).toBe(false);
  });

  it('rolling again replaces the effect at that bar and keeps the track\'s other clips', () => {
    const fx = [{ kind: 'impact' as const, bar: 64, search: ['impact'] }];
    const first = arrange(base(), lib, { ...opts, addMissingTracks: false, fx });
    const withOwn = { ...first.project, tracks: first.project.tracks.map((t) => (t.name === 'Impact FX' ? { ...t, clips: [...t.clips, { id: 'mine', sampleId: 'x', start: 8, length: 1, offset: 0 }] } : t)) };
    const again = arrange(withOwn, lib, { ...opts, seed: 99, addMissingTracks: false, fx });
    expect(again.project.tracks.filter((t) => t.name === 'Impact FX')).toHaveLength(1);
    expect(again.added).not.toContain('Impact FX');
    const clips = again.project.tracks.find((t) => t.name === 'Impact FX')!.clips;
    expect(clips.map((c) => c.start).sort((a, b) => a - b)).toEqual([8, 64]);
  });

  it('fxOnly leaves the whole arrangement as it is', () => {
    const start = arrange(base(), lib, { ...opts, addMissingTracks: true });
    const before = JSON.stringify(start.project);
    const r = arrange(start.project, lib, { ...opts, seed: 5, fxOnly: true, fx: [{ kind: 'impact', bar: 64, search: ['impact'] }] });
    const kept = r.project.tracks.filter((t) => t.name !== 'Impact FX');
    expect(JSON.stringify({ ...r.project, tracks: kept })).toBe(before);
    expect(r.project.tracks.find((t) => t.name === 'Impact FX')!.clips[0].start).toBe(64);
    expect(r.added).toEqual(['Impact FX']);
    expect(r.sections).toEqual([]);
  });

  it('searches the words the user asked for, whole words only, and never guesses another sound', () => {
    const karl = [
      fxSample('SSE Pattern 05 Perc FX', { bpm: 155, duration: 3.1 }),
      fxSample('SSE Clap FX', { duration: 1 }),
      ...[1, 2, 3].map((n) => fxSample(`SSE Impact Shot ${n}`, { folder: '06 Impact Shots', duration: 2 })),
      fxSample('White Noise Hit Loop', { bpm: 155, duration: 8 }),
    ];
    for (let seed = 0; seed < 10; seed++) {
      const r = arrange(base(), karl, { ...opts, seed, addMissingTracks: false, fxOnly: true, fx: [{ kind: 'impact', bar: 64, search: ['impact'] }] });
      expect(r.fx[0].sample).toMatch(/^SSE Impact Shot \d$/);
    }
    // a word nothing matches is "not found", not some other effect
    expect(findFxSample(karl, { kind: 'impact', search: ['boomerang'] })).toBeUndefined();
    // "hit" is a whole word: it finds "Hit Loop" but not a "white" sample
    expect(findFxSample([fxSample('Whitenoise Sweep')], { kind: 'impact', search: ['hit'] })).toBeUndefined();
  });

  it('finds Karl\'s impact shots although the import tagged them as vocals', () => {
    const lib2 = [...[1, 2, 3, 4, 5].map((n) => fxSample(`SSE Impact Shot ${n}`, { category: 'vocal', folder: '06 Impact Shots' })), fxSample('SSE Pattern 05 Perc FX')];
    const hit = withUserWords([{ kind: 'other', bar: 64 }], "'Impact' Sample bei Takt 65 auf neuer Spur", lib2)[0];
    expect(hit.search).toEqual(['impact']);
    const r = arrange(base(), lib2, { ...opts, addMissingTracks: false, fxOnly: true, fx: [hit] });
    expect(r.fx[0].sample).toMatch(/^SSE Impact Shot \d$/);
    expect(r.fxMissing).toEqual([]);
  });
});
