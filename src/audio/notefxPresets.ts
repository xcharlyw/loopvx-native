import type { ArpSettings, SeqSettings, SeqStep } from '../types';
import { SEQ_STEPS } from './notefx';

// Factory presets of the arpeggiator and the step sequencer. A preset replaces every setting except the on switch.

export interface ArpPreset {
  id: string;
  name: string;
  hint: string;
  arp: Omit<ArpSettings, 'on' | 'preset'>;
}

export interface SeqPreset {
  id: string;
  name: string;
  hint: string;
  seq: Omit<SeqSettings, 'on' | 'preset'>;
}

const a = (id: string, name: string, hint: string, arp: ArpPreset['arp']): ArpPreset => ({ id, name, hint, arp });

export const ARP_PRESETS: ArpPreset[] = [
  a('trance-up', 'Trance Up', 'Akkord aufwärts in 16teln über zwei Oktaven', { pattern: 'up', rate: 16, octaves: 2, gate: 0.6, swing: 0 }),
  a('rolling-down', 'Rolling Down', 'Abwärts, kurz und treibend', { pattern: 'down', rate: 16, octaves: 1, gate: 0.5, swing: 0 }),
  a('up-down', 'Up & Down', 'Hoch und wieder runter, zwei Oktaven', { pattern: 'updown', rate: 16, octaves: 2, gate: 0.7, swing: 0 }),
  a('random-acid', 'Random Acid', 'Zufällige Töne des Akkords, leicht swingend', { pattern: 'random', rate: 16, octaves: 2, gate: 0.45, swing: 0.15 }),
  a('stab-gate', 'Stab Gate', 'Ganzer Akkord auf Achteln, kurz abgehackt', { pattern: 'chord', rate: 8, octaves: 1, gate: 0.35, swing: 0 }),
  a('rave-stabs', 'Rave Stabs', 'Akkord-Schläge in 16teln, sehr kurz', { pattern: 'chord', rate: 16, octaves: 1, gate: 0.25, swing: 0 }),
  a('triplet-bounce', 'Triplet Bounce', 'Triolen hoch und runter', { pattern: 'updown', rate: 24, octaves: 1, gate: 0.6, swing: 0 }),
  a('run-32', '32nd Run', 'Schneller Lauf über drei Oktaven', { pattern: 'up', rate: 32, octaves: 3, gate: 0.8, swing: 0 }),
  a('pluck-cascade', 'Pluck Cascade', 'Abwärts-Kaskade über drei Oktaven', { pattern: 'down', rate: 16, octaves: 3, gate: 0.4, swing: 0 }),
  a('slow-pad', 'Slow Pad Arp', 'Langsame Achtel mit langen Tönen für Flächen', { pattern: 'up', rate: 8, octaves: 2, gate: 1, swing: 0 }),
  a('as-played', 'As Played', 'In der Reihenfolge, in der die Noten gespielt sind', { pattern: 'played', rate: 16, octaves: 1, gate: 0.55, swing: 0 }),
  a('swing-groove', 'Swing Groove', 'Aufwärts mit starkem Swing', { pattern: 'up', rate: 16, octaves: 2, gate: 0.5, swing: 0.3 }),
  a('triplet-chords', 'Triplet Chords', 'Akkord auf Triolen, luftig', { pattern: 'chord', rate: 12, octaves: 1, gate: 0.4, swing: 0 }),
];

/** A pattern as a list: a number is a step on with that many semitones, null a rest, [n, true] an accent. */
type Cell = number | null | [number, true];
function steps(cells: Cell[]): SeqStep[] {
  const out: SeqStep[] = cells.map((c) => (c === null ? { on: false, semi: 0 } : Array.isArray(c) ? { on: true, semi: c[0], accent: true } : { on: true, semi: c }));
  while (out.length < SEQ_STEPS) out.push({ on: false, semi: 0 });
  return out;
}
const q = (rate: number, cells: Cell[], gate = 0.6, swing = 0): SeqPreset['seq'] => ({ rate, length: cells.length, gate, swing, steps: steps(cells) });
const s = (id: string, name: string, hint: string, seq: SeqPreset['seq']): SeqPreset => ({ id, name, hint, seq });
const _ = null;

export const SEQ_PRESETS: SeqPreset[] = [
  s('rolling-bass', 'Rolling Bass', 'Hard-Techno-Bass zwischen den Kicks: drei 16tel pro Schlag', q(16, [_, 0, 0, [0, true], _, 0, 0, [0, true], _, 0, 0, [0, true], _, 0, 0, [0, true]], 0.55)),
  s('rumble-gallop', 'Rumble Gallop', 'Galopp-Rhythmus für den Rumble', q(16, [_, 0, 0, _, _, 0, 0, _, _, 0, 0, _, _, 0, 0, _], 0.7)),
  s('offbeat-bass', 'Offbeat Bass', 'Der klassische Bass auf dem Off-Beat', q(16, [_, _, [0, true], _, _, _, [0, true], _, _, _, [0, true], _, _, _, [0, true], _], 0.8)),
  s('acid-303', 'Acid 303', 'Acid-Linie mit Oktaven und Akzenten', q(16, [[0, true], 0, 12, 0, 3, _, [7, true], 0, 12, 0, _, 10, [7, true], 5, 0, _], 0.5)),
  s('octave-bounce', 'Octave Bounce', 'Grundton und Oktave im Wechsel', q(16, [0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12], 0.5)),
  s('trance-gate', 'Trance Gate', 'Durchgehende 16tel mit Akzent auf jedem Schlag', q(16, [[0, true], 0, 0, 0, [0, true], 0, 0, 0, [0, true], 0, 0, 0, [0, true], 0, 0, 0], 0.5)),
  s('dark-motif', 'Dark Motif', 'Düsteres Moll-Motiv, jede zweite 16tel', q(16, [0, _, 3, _, 7, _, 3, _, 0, _, 3, _, 10, _, 7, _], 0.8)),
  s('minor-arp-line', 'Minor Arp Line', 'Moll-Dreiklang auf und ab als Linie', q(16, [0, 3, 7, 12, 7, 3, 0, 3, 7, 12, 15, 12, 7, 3, 0, _], 0.6)),
  s('sparse-pulse', 'Sparse Pulse', 'Achtel-Puls, ruhig und treibend', q(8, [[0, true], 0, 0, 0, [0, true], 0, 0, 0], 0.5)),
  s('triplet-roll', 'Triplet Roll', 'Triolen-Rolle mit Oktav-Sprüngen', q(24, [0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 12, 12], 0.5)),
  s('hard-gallop', 'Hard Gallop', 'Hart: zwei kurze, eine Pause', q(16, [[0, true], 0, _, 0, _, 0, [0, true], _, 0, _, 0, _, [0, true], 0, _, 0], 0.4)),
  s('screech-riff', 'Screech Riff', 'Riff für den Screech-Lead mit Quinte und Septime', q(16, [[0, true], _, 12, _, 10, _, 7, _, [0, true], _, 12, _, 15, _, 12, 10], 0.7)),
  s('reese-roll', 'Reese Roll', 'Reese mit Lücken, tief und rollend', q(16, [[0, true], 0, _, 0, 0, 0, _, 0, [0, true], 0, _, 0, 0, _, 0, 0], 0.75)),
  s('stutter-32', 'Stutter 32', 'Schnelles 32stel-Stottern', q(32, [[0, true], 0, 0, 0, 0, 0, 0, 0, [12, true], 12, 12, 12, 0, 0, 0, 0], 0.5)),
  s('swing-pulse', 'Swing Pulse', 'Swingender Puls für Tech-House-Feeling', q(16, [0, _, 0, _, [0, true], _, 0, _, 0, _, 0, _, [0, true], _, 0, 12], 0.5, 0.3)),
  s('rave-hook', 'Rave Hook', 'Kurzer Rave-Hook über 8 Schritte', q(16, [0, 0, 7, _, 12, _, 10, _], 0.6)),
];

export const arpPresetById = (id?: string) => ARP_PRESETS.find((p) => p.id === id);
export const seqPresetById = (id?: string) => SEQ_PRESETS.find((p) => p.id === id);
