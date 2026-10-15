import type { ArpSettings, Note, SeqSettings } from '../types';
import { applyNoteFx, arpNotes, DEFAULT_ARP, emptySteps, seqNotes } from './notefx';

const chord = (len = 1, start = 0): Note[] => [48, 52, 55].map((pitch) => ({ pitch, start, length: len, velocity: 0.8 }));
const arp = (patch: Partial<ArpSettings>): ArpSettings => ({ ...DEFAULT_ARP, on: true, ...patch });
const pitches = (n: Note[]) => n.map((x) => x.pitch);

describe('arpNotes', () => {
  it('walks up through the held chord, one note per step', () => {
    const out = arpNotes(chord(), arp({ rate: 8 }), 1);
    expect(pitches(out)).toEqual([48, 52, 55, 48, 52, 55, 48, 52]);
    expect(out[1].start).toBeCloseTo(1 / 8);
  });

  it('plays down, up-down (ends not doubled) and in the order played', () => {
    expect(pitches(arpNotes(chord(), arp({ pattern: 'down', rate: 8 }), 0.5))).toEqual([55, 52, 48, 55]);
    expect(pitches(arpNotes(chord(), arp({ pattern: 'updown', rate: 8 }), 0.75))).toEqual([48, 52, 55, 52, 48, 52]);
    const played: Note[] = [{ pitch: 55, start: 0, length: 1, velocity: 1 }, { pitch: 48, start: 0, length: 1, velocity: 1 }, { pitch: 52, start: 0, length: 1, velocity: 1 }];
    expect(pitches(arpNotes(played, arp({ pattern: 'played', rate: 8 }), 0.5))).toEqual([55, 48, 52, 55]);
  });

  it('climbs octaves', () => {
    expect(pitches(arpNotes(chord(), arp({ octaves: 2, rate: 8 }), 0.75))).toEqual([48, 52, 55, 60, 64, 67]);
  });

  it('plays the whole chord every step in chord mode, with the gate as note length', () => {
    const out = arpNotes(chord(), arp({ pattern: 'chord', rate: 4, gate: 0.5 }), 0.5);
    expect(out).toHaveLength(6);
    expect(out[0].length).toBeCloseTo(0.5 / 4);
  });

  it('random is repeatable and stays inside the chord', () => {
    const a = arpNotes(chord(), arp({ pattern: 'random' }), 1);
    expect(pitches(a)).toEqual(pitches(arpNotes(chord(), arp({ pattern: 'random' }), 1)));
    expect(a.every((n) => [48, 52, 55].includes(n.pitch))).toBe(true);
    expect(new Set(pitches(a)).size).toBeGreaterThan(1);
  });

  it('is silent where no note is held and restarts the run on a new chord', () => {
    const notes = [...chord(0.25, 0), ...chord(0.25, 0.5).map((n) => ({ ...n, pitch: n.pitch + 5 }))];
    const out = arpNotes(notes, arp({ rate: 16 }), 1);
    expect(out.map((n) => +n.start.toFixed(4))).toEqual([0, 0.0625, 0.125, 0.1875, 0.5, 0.5625, 0.625, 0.6875]);
    expect(pitches(out.slice(4, 6))).toEqual([53, 57]); // starts from the lowest note again
  });

  it('swings every second step and stops at the clip end', () => {
    const out = arpNotes(chord(4), arp({ rate: 4, swing: 0.5 }), 1);
    expect(out.map((n) => +n.start.toFixed(4))).toEqual([0, 0.375, 0.5, 0.875]);
    expect(arpNotes(chord(4), arp({ rate: 16 }), 0.5)).toHaveLength(8);
  });

  it('keeps the velocity of the note it plays', () => {
    const notes: Note[] = [{ pitch: 48, start: 0, length: 1, velocity: 0.4 }, { pitch: 55, start: 0, length: 1, velocity: 1 }];
    expect(arpNotes(notes, arp({ rate: 4 }), 0.5).map((n) => n.velocity)).toEqual([0.4, 1]);
  });
});

describe('seqNotes', () => {
  const seq = (steps: { on: boolean; semi?: number; accent?: boolean }[], patch: Partial<SeqSettings> = {}): SeqSettings => ({
    on: true,
    rate: 16,
    length: steps.length,
    gate: 0.5,
    swing: 0,
    steps: [...steps.map((s) => ({ semi: 0, ...s })), ...emptySteps().slice(steps.length)],
    ...patch,
  });
  const root: Note[] = [{ pitch: 36, start: 0, length: 1, velocity: 1 }];

  it('plays the pattern on the held note, transposed, and loops it', () => {
    const out = seqNotes(root, seq([{ on: true }, { on: false }, { on: true, semi: 12 }, { on: true, semi: 7 }]), 0.5);
    expect(pitches(out)).toEqual([36, 48, 43, 36, 48, 43]);
    expect(out.map((n) => +n.start.toFixed(4))).toEqual([0, 0.125, 0.1875, 0.25, 0.375, 0.4375]);
  });

  it('accents are louder than plain steps', () => {
    const out = seqNotes(root, seq([{ on: true, accent: true }, { on: true }]), 0.125);
    expect(out[0].velocity).toBe(1);
    expect(out[1].velocity).toBeCloseTo(0.7);
  });

  it('follows the note that is held, and plays nothing where none is', () => {
    const notes: Note[] = [{ pitch: 36, start: 0, length: 0.25, velocity: 1 }, { pitch: 41, start: 0.5, length: 0.25, velocity: 1 }];
    const out = seqNotes(notes, seq([{ on: true }]), 1);
    expect(pitches(out)).toEqual([36, 36, 36, 36, 41, 41, 41, 41]);
  });

  it('plays only as many steps as the length says', () => {
    const steps = seq([{ on: true, semi: 0 }, { on: true, semi: 5 }, { on: true, semi: 9 }], { length: 2 });
    expect(pitches(seqNotes(root, steps, 0.25))).toEqual([36, 41, 36, 41]);
  });
});

describe('applyNoteFx', () => {
  it('returns the notes untouched when nothing is on', () => {
    const notes = chord();
    expect(applyNoteFx(notes, { arp: { ...DEFAULT_ARP, on: false } }, 1)).toBe(notes);
  });

  it('caches the result for the same notes and settings', () => {
    const notes = chord();
    const a = arp({});
    expect(applyNoteFx(notes, { arp: a }, 1)).toBe(applyNoteFx(notes, { arp: a }, 1));
    expect(applyNoteFx(notes, { arp: arp({ pattern: 'down' }) }, 1)).not.toBe(applyNoteFx(notes, { arp: a }, 1));
  });
});
