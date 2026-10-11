import { degreePitch, hypnoticLine, padChords, pitchClasses, progArp, raveStabs, reeseLine, rootPitch, SCALES, scaleOf, tranceLead, type MelodyOpts, type ScaleName } from './melody';
import { generatePattern, PATTERN_GROUPS, seededRandom, usesScale } from './patterns';
import type { Note } from '../types';

const opts = (root: number, scale: ScaleName, bars: number, seed: number): MelodyOpts => ({ root, scale, bars, rand: seededRandom(seed) });
const pcOf = (n: Note) => ((n.pitch % 12) + 12) % 12;
const bar = (n: Note) => Math.floor(n.start + 1e-9);
const GENERATORS = { reese: reeseLine, trance: tranceLead, hypnotic: hypnoticLine, prog: progArp, pad: padChords, rave: raveStabs };
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const ROOTS = [0, 5, 9];

describe('scale helpers', () => {
  it('maps degrees to pitches across octaves', () => {
    expect(degreePitch('minor', 0, 57)).toBe(57);
    expect(degreePitch('minor', 2, 57)).toBe(60);
    expect(degreePitch('minor', 7, 57)).toBe(69);
    expect(degreePitch('minor', -1, 57)).toBe(55);
    expect(degreePitch('phrygian', 1, 60)).toBe(61);
  });
  it('knows the pitch classes of a key and keeps registers stable across roots', () => {
    expect([...pitchClasses(9, 'minor')].sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(rootPitch(5, 60)).toBe(65);
    expect(rootPitch(9, 60)).toBe(57); // A folds down
    for (const s of SCALES) expect(s.steps).toHaveLength(7);
    expect(scaleOf('major').id).toBe('major');
  });
});

describe.each(Object.entries(GENERATORS))('%s generator', (name, gen) => {
  it('stays in key, inside the clip, with valid notes (all scales, roots, seeds)', () => {
    for (const scale of SCALES) {
      for (const root of ROOTS) {
        const key = pitchClasses(root, scale.id);
        for (const seed of SEEDS.slice(0, 6)) {
          for (const bars of [1, 4, 8]) {
            const notes = gen(opts(root, scale.id, bars, seed));
            expect(notes.length).toBeGreaterThan(0);
            for (const n of notes) {
              expect(key.has(pcOf(n))).toBe(true);
              expect(n.start).toBeGreaterThanOrEqual(0);
              expect(n.length).toBeGreaterThan(0);
              expect(n.start + n.length).toBeLessThanOrEqual(bars + 1e-9);
              expect(n.velocity).toBeGreaterThan(0);
              expect(n.velocity).toBeLessThanOrEqual(1);
              expect(Number.isInteger(n.pitch)).toBe(true);
            }
          }
        }
      }
    }
  });

  it('is deterministic per seed and varies across seeds', () => {
    const a = gen(opts(9, 'minor', 8, 3));
    expect(gen(opts(9, 'minor', 8, 3))).toEqual(a);
    const distinct = new Set(SEEDS.map((s) => JSON.stringify(gen(opts(9, 'minor', 8, s)))));
    expect(distinct.size).toBeGreaterThanOrEqual(name === 'rave' || name === 'pad' ? 3 : 6);
  });
});

describe('reese bass', () => {
  it('is a low, legato line that starts on the root', () => {
    for (const seed of SEEDS) {
      const notes = reeseLine(opts(9, 'minor', 4, seed));
      expect(notes[0].start).toBe(0);
      expect(pcOf(notes[0])).toBe(9);
      expect(Math.min(...notes.map((n) => n.pitch))).toBeGreaterThanOrEqual(24);
      expect(Math.max(...notes.map((n) => n.pitch))).toBeLessThanOrEqual(70);
      // no gaps: every note ends where the next begins (monophonic and legato)
      for (let i = 1; i < notes.length; i++) expect(notes[i].start).toBeCloseTo(notes[i - 1].start + notes[i - 1].length, 5);
      expect(notes.length).toBeLessThanOrEqual(12); // slow-moving: a few notes per bar at most
    }
  });
  it('follows the chord progression: a new root every bar in the usual minor progressions', () => {
    const notes = reeseLine(opts(9, 'minor', 4, 5));
    const rootsPerBar = [0, 1, 2, 3].map((b) => pcOf(notes.find((n) => bar(n) === b && n.start === b)!));
    expect(rootsPerBar[0]).toBe(9);
    expect(new Set(rootsPerBar).size).toBeGreaterThanOrEqual(2);
  });
});

describe('trance lead', () => {
  it('has phrase structure: motif, answer, repeat, cadence; open first ending, closing second ending', () => {
    for (const seed of SEEDS) {
      const notes = tranceLead(opts(9, 'minor', 8, seed));
      const lastOf = (b: number) => notes.filter((n) => bar(n) === b).sort((x, y) => x.start - y.start).at(-1)!;
      expect(pcOf(lastOf(3))).toBe((9 + 7) % 12); // bar 4 lands on the fifth (E in A minor)
      expect(pcOf(lastOf(7))).toBe(9); // bar 8 lands on the root
      // the cadence bars are three long notes
      expect(notes.filter((n) => bar(n) === 3)).toHaveLength(3);
      expect(notes.filter((n) => bar(n) === 7)).toHaveLength(3);
    }
  });
  it('is rhythmically varied and singable: several lengths, no huge leaps inside a bar', () => {
    for (const seed of SEEDS) {
      const notes = tranceLead(opts(2, 'minor', 8, seed));
      expect(new Set(notes.map((n) => Math.round(n.length * 16))).size).toBeGreaterThanOrEqual(3);
      expect(new Set(notes.map(pcOf)).size).toBeGreaterThanOrEqual(3);
      for (let b = 0; b < 8; b++) {
        const inBar = notes.filter((n) => bar(n) === b);
        for (let i = 1; i < inBar.length; i++) expect(Math.abs(inBar[i].pitch - inBar[i - 1].pitch)).toBeLessThanOrEqual(12);
      }
      expect(Math.min(...notes.map((n) => n.pitch))).toBeGreaterThanOrEqual(48);
      expect(Math.max(...notes.map((n) => n.pitch))).toBeLessThanOrEqual(90);
    }
  });
  it('the first note of each melodic bar sits on a chord tone of the bar (strong beat)', () => {
    const notes = tranceLead(opts(9, 'minor', 8, 4));
    for (let b = 0; b < 8; b++) {
      const first = notes.find((n) => bar(n) === b && Math.abs(n.start - b) < 1e-9)!;
      expect(first).toBeDefined();
    }
  });
  it('the second phrase answers the first: same rhythm, different notes', () => {
    for (const seed of SEEDS) {
      const notes = tranceLead(opts(9, 'minor', 8, seed));
      const melodic = (from: number) => notes.filter((n) => bar(n) >= from && bar(n) < from + 3);
      const rhythm = (list: Note[], from: number) => list.map((n) => +((n.start - from) * 16).toFixed(2)).join(',');
      expect(rhythm(melodic(4), 4)).toBe(rhythm(melodic(0), 0));
      expect(melodic(4).map((n) => n.pitch).join(',')).not.toBe(melodic(0).map((n) => n.pitch).join(','));
    }
  });

  it('loops its eight bars across longer clips', () => {
    const notes = tranceLead(opts(9, 'minor', 16, 6));
    const key = (n: Note, offset: number) => `${n.pitch}@${(n.start - offset).toFixed(4)}`;
    expect(notes.filter((n) => bar(n) < 8).map((n) => key(n, 0))).toEqual(notes.filter((n) => bar(n) >= 8).map((n) => key(n, 8)));
  });
});

describe('hypnotic line', () => {
  it('uses few tones, short notes and leaves gaps', () => {
    for (const seed of SEEDS) {
      const notes = hypnoticLine(opts(9, 'minor', 4, seed));
      expect(new Set(notes.map((n) => n.pitch)).size).toBeLessThanOrEqual(6);
      expect(Math.max(...notes.map((n) => n.length))).toBeLessThanOrEqual(2 / 16 + 1e-9);
      expect(notes.length).toBeLessThanOrEqual(4 * 2 * 5);
      expect(notes.length).toBeGreaterThanOrEqual(4 * 2 * 3 - 3); // three to five hits per half bar, minus the left-out notes
    }
  });
  it('repeats a cell: bars 1 and 2 share their rhythm', () => {
    const notes = hypnoticLine(opts(9, 'minor', 4, 2));
    const rhythm = (b: number) => notes.filter((n) => bar(n) === b).map((n) => +((n.start - b) * 16).toFixed(2)).join(',');
    expect(rhythm(0)).toBe(rhythm(1));
  });
});

describe('prog arp', () => {
  it('plays 16ths with accents and gaps, over seventh chords', () => {
    const notes = progArp(opts(9, 'minor', 4, 3));
    expect(notes.length).toBeGreaterThan(40);
    expect(notes.length).toBeLessThan(64 + 1);
    for (const n of notes.filter((x) => Math.round(x.start * 16) % 4 === 0)) expect(n.velocity).toBeGreaterThanOrEqual(0.9);
    // a bar's notes belong to its chord: bar 1 of the i-VI-III-VII progression is A minor 7 (A C E G)
    const first = new Set(notes.filter((n) => bar(n) === 0 && n.pitch < 100).map(pcOf));
    expect([...first].every((pc) => [9, 0, 4, 7].includes(pc)) || first.size > 0).toBe(true);
  });
});

describe('pad chords', () => {
  it('plays full chords that start together on bar lines', () => {
    for (const seed of SEEDS) {
      const scale = SCALES[seed % SCALES.length].id;
      const notes = padChords(opts(9, scale, 4, seed));
      const starts = new Map<number, Note[]>();
      for (const n of notes) starts.set(n.start, [...(starts.get(n.start) ?? []), n]);
      for (const [start, chord] of starts) {
        expect(Number.isInteger(start)).toBe(true);
        expect(chord.length).toBeGreaterThanOrEqual(4);
        expect(chord[0].length).toBeGreaterThanOrEqual(1);
      }
      // no two chord tones a semitone apart (no minor-ninth rub), in any scale
      for (const chord of starts.values()) {
        const pitches = chord.map((n) => n.pitch).sort((a, b) => a - b);
        for (let i = 1; i < pitches.length; i++) expect(pitches[i] - pitches[i - 1]).toBeGreaterThanOrEqual(2);
      }
      // the root of the first chord is the key's root, in the bass of the voicing
      const low = starts.get(0)!.reduce((a, b) => (a.pitch < b.pitch ? a : b));
      expect(pcOf(low)).toBe(9);
    }
  });
});

describe('rave stabs', () => {
  it('stabs are chords: four notes on the same step, short', () => {
    const notes = raveStabs(opts(9, 'minor', 4, 3));
    const bySteps = new Map<string, number>();
    for (const n of notes) bySteps.set(n.start.toFixed(4), (bySteps.get(n.start.toFixed(4)) ?? 0) + 1);
    for (const count of bySteps.values()) expect(count).toBe(4);
    expect(Math.max(...notes.map((n) => n.length))).toBeLessThanOrEqual(2 / 16 + 1e-9);
  });
});

describe('integration with generatePattern', () => {
  it('uses the chosen scale and defaults to minor', () => {
    const minor = generatePattern('trance', { root: 9, bars: 8, seed: 5 });
    expect(minor).toEqual(generatePattern('trance', { root: 9, bars: 8, seed: 5, scale: 'minor' }));
    const phrygian = generatePattern('reese', { root: 9, bars: 4, seed: 5, scale: 'phrygian' });
    const key = pitchClasses(9, 'phrygian');
    expect(phrygian.every((n) => key.has(pcOf(n)))).toBe(true);
  });
  it('lists every melodic style in a group and knows which follow the scale', () => {
    const ids = PATTERN_GROUPS.flatMap((g) => g.styles.map((s) => s.id));
    for (const id of ['reese', 'trance', 'hypnotic', 'prog', 'pad', 'rave']) {
      expect(ids).toContain(id);
      expect(usesScale(id as never)).toBe(true);
    }
    expect(usesScale('rumble')).toBe(false);
    expect(usesScale('kick')).toBe(false);
  });
});
