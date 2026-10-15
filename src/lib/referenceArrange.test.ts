import { activeBars, barLevels, stemKindOf, structureFromStems, structureText } from './referenceArrange';

const run = (pattern: [number, number][]) => pattern.flatMap(([bars, level]) => Array.from({ length: bars }, () => level));

describe('reference arrangement from stems', () => {
  it('knows the stem files', () => {
    expect(stemKindOf('Tune - Drums.mp3')).toBe('drums');
    expect(stemKindOf('Tune - Synth + FX.mp3')).toBe('synth');
    expect(stemKindOf('Tune - Keys.mp3')).toBe('synth');
    expect(stemKindOf('Tune - Vocal.wav')).toBe('vocal');
    expect(stemKindOf('Kick 1.wav')).toBeUndefined();
  });

  it('measures bar levels at the tempo', () => {
    const sr = 1000;
    const bpm = 240; // one bar = 1 s = 1000 samples
    const data = new Float32Array(3000);
    data.fill(0.5, 1000, 2000);
    const lv = barLevels(data, sr, bpm);
    expect(lv).toHaveLength(3);
    expect(lv[0]).toBe(0);
    expect(lv[1]).toBeCloseTo(0.5);
  });

  it('a silent stem never plays', () => {
    expect(activeBars([0.001, 0.002, 0.001]).some(Boolean)).toBe(false);
  });

  it('finds intro, build, drop, break, build, drop, outro of a classic hard techno tune', () => {
    // bars:          intro 16 | build 8 | drop 32 | break 16 | build 8 | drop 32 | outro 16
    const drums = run([[16, 0.5], [8, 0.5], [32, 0.6], [16, 0], [8, 0.5], [32, 0.6], [16, 0.4]]);
    const bass = run([[16, 0], [8, 0], [32, 0.5], [16, 0], [8, 0], [32, 0.5], [16, 0]]);
    const synth = run([[16, 0], [8, 0.3], [32, 0.4], [16, 0.4], [8, 0.4], [32, 0.4], [16, 0]]);
    const vocal = run([[16, 0], [8, 0], [32, 0], [16, 0.5], [8, 0], [32, 0], [16, 0]]);
    const s = structureFromStems({ drums, bass, synth, vocal });
    expect(structureText(s)).toBe('Intro 16 · Build-up 8 · Drop 32 · Break 16 · Build-up 8 · Drop 32 · Outro 16');
    expect(s[0].mute).toEqual(expect.arrayContaining(['bass', 'lead', 'vocal']));
    expect(s[0].mute).not.toContain('drums');
    expect(s[3].mute).toEqual(expect.arrayContaining(['drums', 'bass']));
    expect(s[3].mute).not.toContain('vocal');
    expect(s[2].mute).not.toContain('bass');
  });

  it('splits drops longer than 64 bars and needs at least one phrase', () => {
    const drums = run([[96, 0.5]]);
    const bass = run([[96, 0.5]]);
    expect(structureFromStems({ drums, bass }).map((x) => x.bars)).toEqual([64, 32]);
    expect(structureFromStems({ drums: [0.5, 0.5] })).toEqual([]);
  });
});

import { arrange } from './arranger';
import { planSections } from './arrangePlan';
import { createProject } from './project';

describe('rebuilding a project on the found structure', () => {
  it('lays the project out with the tune sections as markers and no bass where the tune had none', () => {
    const drums = run([[16, 0.5], [32, 0.6], [16, 0], [32, 0.6]]);
    const bass = run([[16, 0], [32, 0.5], [16, 0], [32, 0.5]]);
    const sections = structureFromStems({ drums, bass });
    const r = arrange(createProject(), [], { seed: 1, addMissingTracks: true, automation: false, sections: planSections({ sections }), addRoles: ['drums', 'bass'] });
    expect(r.project.markers?.map((m) => [m.bar, m.name])).toEqual([[0, 'Intro'], [16, 'Drop 1'], [48, 'Break'], [64, 'Drop 2']]);
    const bassTrack = r.project.tracks.find((t) => t.name === 'Rumble Bass')!;
    expect(bassTrack.clips.length).toBeGreaterThan(0);
    expect(bassTrack.clips.every((c) => c.start >= 16 && !(c.start >= 48 && c.start < 64))).toBe(true);
  });
});

import { stemClipRanges } from './referenceArrange';
describe('original stems on the structure', () => {
  it('puts a stem only where it plays, merged over neighbouring sections', () => {
    const sections = [{ type: 'intro' as const, bars: 16 }, { type: 'drop' as const, bars: 32 }, { type: 'break' as const, bars: 16 }, { type: 'drop' as const, bars: 32 }];
    const bass = run([[16, 0], [32, 0.5], [16, 0], [32, 0.5]]);
    expect(stemClipRanges(bass, sections)).toEqual([{ start: 16, length: 32 }, { start: 64, length: 32 }]);
    const drums = run([[16, 0.5], [32, 0.6], [16, 0], [32, 0.6]]);
    expect(stemClipRanges(drums, sections)).toEqual([{ start: 0, length: 48 }, { start: 64, length: 32 }]);
    expect(stemClipRanges(run([[96, 0]]), sections)).toEqual([]);
  });
});

import { drumPartLabel } from './referenceArrange';
describe('drum part files', () => {
  it('knows the parts of the own split and of files from other tools', () => {
    expect(drumPartLabel('Tune - Kick.wav')).toBe('Kick');
    expect(drumPartLabel('Tune - Clap + Snare.wav')).toBe('Clap + Snare');
    expect(drumPartLabel('Tune - HiHats.wav')).toBe('HiHats');
    expect(drumPartLabel('Tune (Hi-Hat).wav')).toBe('HiHats');
    expect(drumPartLabel('Tune_snare.wav')).toBe('Snare');
    expect(drumPartLabel('Tune - Toms.wav')).toBe('Toms');
  });
  it('is not fooled by normal stems', () => {
    expect(drumPartLabel('Tune - Drums.mp3')).toBeUndefined();
    expect(drumPartLabel('Tune - Bass.mp3')).toBeUndefined();
    expect(drumPartLabel('Tune - Vocal.mp3')).toBeUndefined();
  });
});
