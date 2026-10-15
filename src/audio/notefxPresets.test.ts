import { arpNotes, seqNotes } from './notefx';
import { ARP_PRESETS, SEQ_PRESETS } from './notefxPresets';

const chord = [48, 52, 55].map((pitch) => ({ pitch, start: 0, length: 1, velocity: 0.8 }));

describe('arp and sequencer presets', () => {
  it('have unique ids and names', () => {
    expect(new Set(ARP_PRESETS.map((p) => p.id)).size).toBe(ARP_PRESETS.length);
    expect(new Set(SEQ_PRESETS.map((p) => p.id)).size).toBe(SEQ_PRESETS.length);
    expect(new Set(SEQ_PRESETS.map((p) => p.name)).size).toBe(SEQ_PRESETS.length);
  });

  it('every arp preset plays a run from a chord inside sane ranges', () => {
    for (const p of ARP_PRESETS) {
      expect(p.arp.octaves).toBeGreaterThanOrEqual(1);
      expect(p.arp.octaves).toBeLessThanOrEqual(4);
      expect(p.arp.gate).toBeGreaterThan(0);
      expect(p.arp.gate).toBeLessThanOrEqual(1);
      const out = arpNotes(chord, { on: true, ...p.arp }, 1);
      expect(out.length).toBeGreaterThanOrEqual(8);
      expect(out.every((n) => n.pitch >= 48 && n.pitch <= 48 + 55 - 48 + 36 && n.start < 1)).toBe(true);
    }
  });

  it('every sequencer preset has 16 steps, a valid length and plays something', () => {
    for (const p of SEQ_PRESETS) {
      expect(p.seq.steps).toHaveLength(16);
      expect(p.seq.length).toBeGreaterThanOrEqual(1);
      expect(p.seq.length).toBeLessThanOrEqual(16);
      expect(p.seq.steps.slice(0, p.seq.length).some((s) => s.on)).toBe(true);
      const out = seqNotes([{ pitch: 36, start: 0, length: 1, velocity: 1 }], { on: true, ...p.seq }, 1);
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((n) => n.pitch >= 36 && n.pitch <= 36 + 24)).toBe(true);
    }
  });

  it('the rolling bass leaves the kick beats free', () => {
    const p = SEQ_PRESETS.find((x) => x.id === 'rolling-bass')!;
    const out = seqNotes([{ pitch: 36, start: 0, length: 1, velocity: 1 }], { on: true, ...p.seq }, 1);
    expect(out).toHaveLength(12);
    expect(out.some((n) => Math.abs(n.start) < 1e-6)).toBe(false); // nothing on the downbeat
  });
});
