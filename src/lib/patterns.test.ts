import { DRUM_STYLES, generatePattern, PATTERN_STYLES, seededRandom } from './patterns';

describe('generatePattern', () => {
  it('is deterministic per seed and varies across seeds', () => {
    const a = generatePattern('acid', { root: 5, bars: 4, seed: 1 });
    expect(generatePattern('acid', { root: 5, bars: 4, seed: 1 })).toEqual(a);
    expect(generatePattern('acid', { root: 5, bars: 4, seed: 2 })).not.toEqual(a);
  });

  it('keeps every style inside the clip with valid notes', () => {
    for (const { id } of [...PATTERN_STYLES, ...DRUM_STYLES]) {
      for (const bars of [1, 2, 3, 4, 8]) {
        const notes = generatePattern(id, { root: 9, bars, seed: 7 });
        expect(notes.length).toBeGreaterThan(0);
        for (const n of notes) {
          expect(n.start).toBeGreaterThanOrEqual(0);
          expect(n.start + n.length).toBeLessThanOrEqual(bars + 1e-9);
          expect(n.length).toBeGreaterThan(0);
          expect(n.pitch).toBeGreaterThanOrEqual(0);
          expect(n.pitch).toBeLessThanOrEqual(127);
          expect(n.velocity).toBeGreaterThan(0);
          expect(n.velocity).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('rumble plays three 16ths after every kick, on the root', () => {
    const notes = generatePattern('rumble', { root: 0, bars: 1, seed: 3 });
    expect(notes.map((n) => n.start * 16)).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15]);
    expect(notes.every((n) => n.pitch === 36)).toBe(true);
  });

  it('acid stays in the minor pentatonic of the key', () => {
    const allowed = new Set([0, 3, 5, 7, 10]);
    const notes = generatePattern('acid', { root: 2, bars: 2, seed: 11 });
    expect(notes.every((n) => allowed.has((n.pitch - 2 + 120) % 12))).toBe(true);
    expect(notes.some((n) => n.start === 0)).toBe(true);
  });

  it('repeats the phrase across longer clips', () => {
    const notes = generatePattern('stabs', { root: 0, bars: 4, seed: 5 });
    const bar = (i: number) => notes.filter((n) => Math.floor(n.start) === i).map((n) => [n.pitch, n.start - i]);
    expect(bar(3)).toEqual(bar(0));
  });

  it('seededRandom returns values in [0, 1)', () => {
    const r = seededRandom(42);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('drum patterns', () => {
  it('put every hit on C3, the sample instrument root', () => {
    for (const { id } of DRUM_STYLES) expect(generatePattern(id, { root: 7, bars: 2, seed: 9 }).every((n) => n.pitch === 60)).toBe(true);
  });

  it('kick is four on the floor', () => {
    const beats = generatePattern('kick', { root: 0, bars: 1, seed: 1 }).filter((n) => n.velocity === 1).map((n) => n.start);
    expect(beats).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('offbeat hat sits between the kicks', () => {
    expect(generatePattern('hat', { root: 0, bars: 1, seed: 1 }).map((n) => n.start)).toEqual([0.125, 0.375, 0.625, 0.875]);
  });
});
