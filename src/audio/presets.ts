import { DEFAULT_SYNTH } from '../lib/project';
import type { SynthSettings, Track, TrackFx } from '../types';
import { KICK_PRESET, KIT909_PRESET, NOISE_PRESET, SAMPLER_PRESET } from './synth';

// The sound library of the oscillator synth, drum voices included: what the sound browser lists.
// A preset sets the whole instrument (so nothing of the previous sound lingers) and the "sound" effects
// of the track (drive, reverb, delay, pump); the DJ filter and pan stay as the user left them.

export type PresetCategory = 'Bass' | 'Lead' | 'Pad' | 'Pluck & Stab' | 'Drums';
export const PRESET_CATEGORIES: PresetCategory[] = ['Bass', 'Lead', 'Pad', 'Pluck & Stab', 'Drums'];

export interface SoundPreset {
  id: string;
  name: string;
  category: PresetCategory;
  /** One line for the browser. */
  hint: string;
  /** The pitch to audition it on. */
  note: number;
  synth: SynthSettings;
  fx?: Pick<TrackFx, 'drive' | 'reverb' | 'delay' | 'pump'>;
}

const synth = (patch: Partial<SynthSettings>): SynthSettings => ({ ...DEFAULT_SYNTH, ...patch });
const BASS = 36;
const MID = 60;

export const PRESETS: SoundPreset[] = [
  // ---------------- Bass ----------------
  {
    id: 'reese',
    name: 'Reese Bass',
    category: 'Bass',
    hint: 'Zwei verstimmte Saws, die gegeneinander schweben, mit langsamem Filter',
    note: BASS,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'sawtooth', octave: 0, detune: 14, level: 1 }, unison: 2, spread: 8, sub: 0.5, cutoff: 700, resonance: 2.5, lfoRate: 0.5, lfoDepth: 0.35, attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.25 }),
    fx: { drive: 0.18 },
  },
  {
    id: 'reese-hard',
    name: 'Hard Reese',
    category: 'Bass',
    hint: 'Breiter, aggressiver Reese mit Wobble und Verzerrung',
    note: BASS,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'sawtooth', octave: -1, detune: -9, level: 0.9 }, unison: 3, spread: 24, sub: 0.4, cutoff: 520, resonance: 5, filterEnv: 1.5, filterDecay: 0.18, lfoRate: 2, lfoDepth: 0.5, attack: 0.005, decay: 0.2, sustain: 0.85, release: 0.15 }),
    fx: { drive: 0.45 },
  },
  {
    id: 'rumble-saw',
    name: 'Rumble Saw',
    category: 'Bass',
    hint: 'Kurzer, dunkler Rumble-Bass; mit Pump auf die Kick',
    note: BASS,
    synth: synth({ wave: 'sawtooth', unison: 3, spread: 12, sub: 0.6, cutoff: 380, resonance: 1.5, filterEnv: 0.5, filterDecay: 0.12, attack: 0.003, decay: 0.12, sustain: 0.5, release: 0.06 }),
    fx: { drive: 0.15, pump: 0.7 },
  },
  {
    id: 'sub',
    name: 'Sub Bass',
    category: 'Bass',
    hint: 'Reines, tiefes Sinus-Fundament',
    note: BASS,
    synth: synth({ wave: 'sine', oscB: { wave: 'triangle', octave: 0, detune: 0, level: 0.2 }, cutoff: 400, resonance: 0.7, attack: 0.005, decay: 0.1, sustain: 1, release: 0.15 }),
  },
  {
    id: 'acid',
    name: 'Acid 303',
    category: 'Bass',
    hint: 'Quietschender Resonanz-Filter mit schneller Hüllkurve',
    note: 48,
    synth: synth({ wave: 'sawtooth', cutoff: 500, resonance: 12, filterEnv: 3, filterDecay: 0.22, attack: 0.002, decay: 0.18, sustain: 0.6, release: 0.06 }),
    fx: { drive: 0.3 },
  },
  {
    id: 'pluck-bass',
    name: 'Techno Pluck Bass',
    category: 'Bass',
    hint: 'Knackiger Zupf-Bass für Offbeat-Linien',
    note: BASS,
    synth: synth({ wave: 'square', oscB: { wave: 'sawtooth', octave: 0, detune: 6, level: 0.6 }, sub: 0.4, cutoff: 600, resonance: 3, filterEnv: 3, filterDecay: 0.12, attack: 0.002, decay: 0.15, sustain: 0.25, release: 0.08 }),
    fx: { drive: 0.2 },
  },

  // ---------------- Lead ----------------
  {
    id: 'supersaw',
    name: 'Supersaw Lead',
    category: 'Lead',
    hint: 'Der Trance-Klassiker: sieben verstimmte Saws, breit und hell',
    note: MID,
    synth: synth({ wave: 'sawtooth', unison: 7, spread: 38, cutoff: 7000, resonance: 1.2, attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.35 }),
    fx: { reverb: 0.25, delay: 0.2 },
  },
  {
    id: 'trance-pluck',
    name: 'Trance Pluck',
    category: 'Lead',
    hint: 'Kurze, helle Melodie-Töne mit Echo',
    note: MID,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'square', octave: 1, detune: 4, level: 0.35 }, unison: 5, spread: 22, cutoff: 1800, resonance: 2.5, filterEnv: 3, filterDecay: 0.22, attack: 0.002, decay: 0.22, sustain: 0.15, release: 0.25 }),
    fx: { delay: 0.35, reverb: 0.2 },
  },
  {
    id: 'screech',
    name: 'Screech Lead',
    category: 'Lead',
    hint: 'Schneidender Hard-Techno-Lead mit Resonanz und Drive',
    note: MID,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'sawtooth', octave: 1, detune: 7, level: 0.6 }, unison: 3, spread: 18, cutoff: 3200, resonance: 9, filterEnv: 1.2, filterDecay: 0.3, lfoRate: 8, lfoDepth: 0.25, attack: 0.003, decay: 0.2, sustain: 0.8, release: 0.15 }),
    fx: { drive: 0.5, delay: 0.2 },
  },
  {
    id: 'hoover',
    name: 'Rave Hoover',
    category: 'Lead',
    hint: 'Breiter, schwebender Rave-Sound',
    note: MID,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'square', octave: -1, detune: -20, level: 0.8 }, unison: 7, spread: 80, cutoff: 2400, resonance: 3, filterEnv: 1.5, filterDecay: 0.5, lfoRate: 1, lfoDepth: 0.3, attack: 0.02, decay: 0.3, sustain: 0.85, release: 0.3 }),
    fx: { reverb: 0.2, drive: 0.25 },
  },
  {
    id: 'square-lead',
    name: 'Square Lead',
    category: 'Lead',
    hint: 'Klarer Rechteck-Lead mit Oktav-Sinus',
    note: MID,
    synth: synth({ wave: 'square', oscB: { wave: 'sine', octave: 1, detune: 0, level: 0.25 }, cutoff: 3500, resonance: 2, attack: 0.003, decay: 0.15, sustain: 0.9, release: 0.2 }),
    fx: { delay: 0.15 },
  },

  // ---------------- Pad ----------------
  {
    id: 'warm-pad',
    name: 'Warm Pad',
    category: 'Pad',
    hint: 'Weiche Fläche, langsam einblendend',
    note: MID,
    synth: synth({ wave: 'triangle', oscB: { wave: 'sawtooth', octave: 0, detune: 6, level: 0.4 }, unison: 3, spread: 16, cutoff: 1800, resonance: 0.8, attack: 0.6, decay: 0.5, sustain: 0.85, release: 1.2 }),
    fx: { reverb: 0.45 },
  },
  {
    id: 'dark-pad',
    name: 'Dark Pad',
    category: 'Pad',
    hint: 'Düstere Fläche, die langsam atmet',
    note: 48,
    synth: synth({ wave: 'sawtooth', unison: 5, spread: 30, sub: 0.3, cutoff: 700, resonance: 1.5, lfoRate: 0.25, lfoDepth: 0.5, attack: 1, decay: 0.5, sustain: 1, release: 1.8 }),
    fx: { reverb: 0.5 },
  },
  {
    id: 'trance-pad',
    name: 'Trance Pad',
    category: 'Pad',
    hint: 'Weiche Supersaw-Fläche, pumpt mit der Kick',
    note: MID,
    synth: synth({ wave: 'sawtooth', unison: 7, spread: 30, cutoff: 2800, resonance: 1, attack: 0.35, decay: 0.4, sustain: 0.9, release: 1 }),
    fx: { reverb: 0.4, pump: 0.5 },
  },

  // ---------------- Pluck & Stab ----------------
  {
    id: 'arp-pluck',
    name: 'Arp Pluck',
    category: 'Pluck & Stab',
    hint: 'Kurzer Zupf-Ton für Arpeggios',
    note: MID,
    synth: synth({ wave: 'sawtooth', unison: 2, spread: 10, cutoff: 1200, resonance: 3, filterEnv: 3, filterDecay: 0.14, attack: 0.002, decay: 0.14, sustain: 0, release: 0.1 }),
    fx: { delay: 0.35 },
  },
  {
    id: 'rave-stab',
    name: 'Rave Stab',
    category: 'Pluck & Stab',
    hint: 'Kurzer, breiter Akkord-Schlag',
    note: MID,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'square', octave: 0, detune: 12, level: 0.6 }, unison: 5, spread: 30, cutoff: 2600, resonance: 2, filterEnv: 1.5, filterDecay: 0.15, attack: 0.002, decay: 0.18, sustain: 0.15, release: 0.12 }),
    fx: { reverb: 0.2, delay: 0.15, drive: 0.2 },
  },
  {
    id: 'chord-stab',
    name: 'Trance Chord Stab',
    category: 'Pluck & Stab',
    hint: 'Weicher Akkord-Stab mit kurzem Filter-Öffnen',
    note: MID,
    synth: synth({ wave: 'sawtooth', unison: 3, spread: 14, cutoff: 1500, resonance: 1.5, filterEnv: 2, filterDecay: 0.25, attack: 0.003, decay: 0.3, sustain: 0.3, release: 0.25 }),
    fx: { reverb: 0.3 },
  },
  {
    id: 'bell',
    name: 'Glocke',
    category: 'Pluck & Stab',
    hint: 'Heller, ausklingender Ton',
    note: MID,
    synth: synth({ wave: 'sine', oscB: { wave: 'triangle', octave: 2, detune: 0, level: 0.35 }, cutoff: 9000, resonance: 0.7, attack: 0.002, decay: 0.6, sustain: 0, release: 0.6 }),
    fx: { reverb: 0.35 },
  },

  // ---------------- Drums (synthesized, on C3) ----------------
  { id: 'kick-hard', name: 'Kick Hart', category: 'Drums', hint: 'Kurze, harte Kick', note: MID, synth: synth({ ...KICK_PRESET, decay: 0.32 }), fx: { drive: 0.45 } },
  { id: 'kick-rumble', name: 'Kick Rumble', category: 'Drums', hint: 'Lange Kick mit tiefem Ausklang', note: MID, synth: synth({ ...KICK_PRESET, decay: 0.7 }), fx: { drive: 0.3 } },
  { id: 'hat-closed', name: 'Hat zu', category: 'Drums', hint: 'Geschlossene Hi-Hat', note: MID, synth: synth({ ...NOISE_PRESET, cutoff: 8000, decay: 0.05 }) },
  { id: 'hat-open', name: 'Hat offen', category: 'Drums', hint: 'Offene Hi-Hat', note: MID, synth: synth({ ...NOISE_PRESET, cutoff: 6500, decay: 0.28, release: 0.1 }) },
  { id: 'kit-909', name: '909 Drum Machine', category: 'Drums', hint: 'Ganzes Kit auf Drum-Rack-Noten ab C1: Kick, Snare, Clap, Hats, Toms', note: 36, synth: synth({ ...KIT909_PRESET }), fx: { drive: 0.15 } },
  { id: 'clap', name: 'Clap / Snare', category: 'Drums', hint: 'Rauschiger Clap', note: MID, synth: synth({ ...NOISE_PRESET, cutoff: 1800, resonance: 1.2, decay: 0.17 }), fx: { reverb: 0.2 } },
  // ---------------- Wavetable sounds (Serum / Vital style: a table, its position and the mod matrix) ----------------
  {
    id: 'wt-screech',
    name: 'Screech Table',
    category: 'Lead',
    hint: 'Gefalteter Sync-Saw, öffnet bei jedem Anschlag: der Hard-Techno-Screech',
    note: MID,
    synth: synth({ wave: 'sawtooth', tableA: 'screech', posA: 0.45, unison: 3, spread: 20, cutoff: 9000, resonance: 1.4, attack: 0.003, decay: 0.25, sustain: 0.7, release: 0.2, env2: { attack: 0.002, decay: 0.35, sustain: 0.2, release: 0.2 }, mods: [{ source: 'env2', target: 'posA', amount: 0.4 }, { source: 'lfo2', target: 'pitch', amount: 0.02 }], lfo2Rate: 8 }),
    fx: { drive: 0.3, delay: 0.15 },
  },
  {
    id: 'wt-vowel',
    name: 'Vowel Voice',
    category: 'Lead',
    hint: 'Ein Synth, der A-E-I-O-U „spricht", langsam wandernd',
    note: MID,
    synth: synth({ wave: 'sawtooth', tableA: 'vowel', posA: 0.15, unison: 2, spread: 10, cutoff: 12000, resonance: 0.8, attack: 0.02, decay: 0.3, sustain: 0.85, release: 0.4, lfoRate: 0.25, mods: [{ source: 'lfo1', target: 'posA', amount: 0.7 }] }),
    fx: { reverb: 0.25 },
  },
  {
    id: 'wt-morph-pad',
    name: 'Morph Pad',
    category: 'Pad',
    hint: 'Breites Pad, dessen Obertöne langsam auf- und zugehen, mit leichtem Panorama-Schweben',
    note: MID,
    synth: synth({ wave: 'sawtooth', tableA: 'harm', posA: 0.15, unison: 5, spread: 30, sub: 0.2, cutoff: 7000, resonance: 0.9, attack: 0.7, decay: 0.5, sustain: 0.9, release: 1.4, lfo2Rate: 0.25, lfoRate: 0.5, mods: [{ source: 'lfo2', target: 'posA', amount: 0.6 }, { source: 'lfo1', target: 'pan', amount: 0.3 }] }),
    fx: { reverb: 0.4 },
  },
  {
    id: 'wt-fold-bass',
    name: 'Fold Bass',
    category: 'Bass',
    hint: 'Sinus, der beim Anschlag gefaltet wird und sich beruhigt: knurrender Bass',
    note: BASS,
    synth: synth({ wave: 'sine', tableA: 'fold', posA: 0.1, sub: 0.3, cutoff: 2600, resonance: 1.2, attack: 0.003, decay: 0.2, sustain: 0.85, release: 0.15, env2: { attack: 0.002, decay: 0.18, sustain: 0.1, release: 0.15 }, mods: [{ source: 'env2', target: 'posA', amount: 0.5 }] }),
    fx: { drive: 0.2 },
  },
  {
    id: 'wt-acid',
    name: 'Acid Table',
    category: 'Bass',
    hint: 'Wavetable mit wanderndem Resonanz-Peak und Filter-Hüllkurve: 303-Verwandter',
    note: BASS,
    synth: synth({ wave: 'sawtooth', tableA: 'acid', posA: 0.35, cutoff: 1400, resonance: 7, filter24: true, filterEnv: 2.5, filterDecay: 0.16, attack: 0.002, decay: 0.2, sustain: 0.6, release: 0.08, env2: { attack: 0.002, decay: 0.25, sustain: 0.3, release: 0.1 }, mods: [{ source: 'env2', target: 'posA', amount: 0.4 }] }),
    fx: { drive: 0.35 },
  },
  {
    id: 'wt-fm-bell',
    name: 'FM Bell',
    category: 'Pluck & Stab',
    hint: 'Glockiger FM-Anschlag, der zu einem weichen Ton ausklingt',
    note: MID,
    synth: synth({ wave: 'sine', tableA: 'fm', posA: 0.6, cutoff: 12000, resonance: 0.7, attack: 0.002, decay: 0.7, sustain: 0, release: 0.5, env2: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.3 }, mods: [{ source: 'env2', target: 'posA', amount: -0.55 }] }),
    fx: { reverb: 0.3, delay: 0.2 },
  },

  // ---------------- 40 more: Reese, Hoover, Screech, Trance Leads, Stabs, Plucks, Bass and Pads ----------------
  {
    id: 'reese-dark',
    name: 'Dark Reese',
    category: 'Bass',
    hint: 'Tiefer, düsterer Reese, der langsam atmet',
    note: BASS,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'sawtooth', octave: 0, detune: 10, level: 1 }, unison: 2, spread: 6, sub: 0.5, cutoff: 420, resonance: 3, lfoRate: 0.25, lfoDepth: 0.4, attack: 0.01, decay: 0.2, sustain: 0.95, release: 0.3 }),
    fx: { drive: 0.2 },
  },
  {
    id: 'reese-wide',
    name: 'Wide Reese',
    category: 'Bass',
    hint: 'Breiter Reese mit fünf Stimmen und tiefer zweiter Säge',
    note: BASS,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'sawtooth', octave: -1, detune: -12, level: 0.9 }, unison: 5, spread: 30, sub: 0.3, cutoff: 900, resonance: 2, lfoRate: 0.5, lfoDepth: 0.3, attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.25 }),
    fx: { drive: 0.25, reverb: 0.1 },
  },
  {
    id: 'reese-growl',
    name: 'Growl Reese',
    category: 'Bass',
    hint: 'Gefaltete Wavetable, die im Takt knurrt',
    note: BASS,
    synth: synth({ wave: 'sawtooth', tableA: 'fold', posA: 0.25, oscB: { wave: 'sawtooth', octave: 0, detune: 14, level: 0.8 }, unison: 2, spread: 8, sub: 0.4, cutoff: 1400, resonance: 2.5, lfoRate: 2, mods: [{ source: 'lfo1', target: 'posA', amount: 0.45 }], attack: 0.005, decay: 0.2, sustain: 0.9, release: 0.2 }),
    fx: { drive: 0.4 },
  },
  {
    id: 'reese-neuro',
    name: 'Neuro Reese',
    category: 'Bass',
    hint: 'Aggressiver Neuro-Bass: 24-dB-Filter, Resonanz und schneller Wobble',
    note: BASS,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'square', octave: 0, detune: 18, level: 0.8 }, unison: 3, spread: 14, sub: 0.3, cutoff: 700, resonance: 6, filter24: true, lfo2Rate: 4, mods: [{ source: 'lfo2', target: 'cutoff', amount: 0.35 }], attack: 0.004, decay: 0.2, sustain: 0.9, release: 0.15 }),
    fx: { drive: 0.55 },
  },
  {
    id: 'reese-sub',
    name: 'Sub Reese',
    category: 'Bass',
    hint: 'Reese mit viel Sub: tief genug für den Club',
    note: BASS,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'sawtooth', octave: 0, detune: 8, level: 0.7 }, unison: 2, spread: 4, sub: 0.85, cutoff: 300, resonance: 1.5, attack: 0.008, decay: 0.2, sustain: 1, release: 0.2 }),
    fx: { drive: 0.12 },
  },
  {
    id: 'reese-rave',
    name: 'Rave Reese',
    category: 'Bass',
    hint: 'Sieben Stimmen, schwebend, mit Hall: der Rave-Reese',
    note: BASS,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'square', octave: -1, detune: 6, level: 0.8 }, unison: 7, spread: 40, sub: 0.3, cutoff: 1000, resonance: 2, lfoRate: 1, lfoDepth: 0.35, attack: 0.02, decay: 0.3, sustain: 0.9, release: 0.35 }),
    fx: { drive: 0.2, reverb: 0.2 },
  },

  {
    id: 'hoover-classic',
    name: 'Classic Hoover',
    category: 'Lead',
    hint: 'Der Rave-Hoover: breit, mit Tonhöhen-Kippen am Anfang jeder Note',
    note: MID,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'square', octave: -1, detune: -25, level: 0.8 }, unison: 7, spread: 90, cutoff: 3000, resonance: 2.5, attack: 0.01, decay: 0.3, sustain: 0.85, release: 0.25, env2: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.2 }, mods: [{ source: 'env2', target: 'pitch', amount: 0.3 }] }),
    fx: { drive: 0.3, reverb: 0.15 },
  },
  {
    id: 'hoover-mentasm',
    name: 'Mentasm',
    category: 'Lead',
    hint: 'Hard-Sync-Hoover à la Mentasm, öffnet bei jedem Anschlag',
    note: MID,
    synth: synth({ wave: 'sawtooth', tableA: 'sync', posA: 0.35, unison: 5, spread: 50, cutoff: 6000, resonance: 2, attack: 0.004, decay: 0.3, sustain: 0.8, release: 0.2, env2: { attack: 0.002, decay: 0.3, sustain: 0.2, release: 0.2 }, mods: [{ source: 'env2', target: 'posA', amount: 0.45 }, { source: 'env2', target: 'pitch', amount: 0.15 }] }),
    fx: { drive: 0.35, delay: 0.15 },
  },
  {
    id: 'hoover-gabber',
    name: 'Gabber Hoover',
    category: 'Lead',
    hint: 'Extrem breit und verzerrt, mit Oktave darüber',
    note: MID,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'sawtooth', octave: 1, detune: 20, level: 0.6 }, unison: 7, spread: 120, cutoff: 4500, resonance: 3, lfoRate: 4, mods: [{ source: 'lfo1', target: 'pan', amount: 0.5 }], attack: 0.005, decay: 0.2, sustain: 0.9, release: 0.15 }),
    fx: { drive: 0.6 },
  },
  {
    id: 'hoover-soft',
    name: 'Soft Hoover',
    category: 'Lead',
    hint: 'Weicher, hallender Hoover für Breaks',
    note: MID,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'triangle', octave: -1, detune: -15, level: 0.9 }, unison: 5, spread: 60, cutoff: 1800, resonance: 1.5, attack: 0.05, decay: 0.4, sustain: 0.85, release: 0.6, env2: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.3 }, mods: [{ source: 'env2', target: 'pitch', amount: 0.2 }] }),
    fx: { reverb: 0.4 },
  },

  {
    id: 'screech-sync',
    name: 'Sync Screech',
    category: 'Lead',
    hint: 'Hard-Sync-Screech: schneidend, öffnet bei jedem Anschlag',
    note: MID,
    synth: synth({ wave: 'sawtooth', tableA: 'sync', posA: 0.55, unison: 2, spread: 12, cutoff: 8000, resonance: 5, attack: 0.003, decay: 0.2, sustain: 0.8, release: 0.15, env2: { attack: 0.002, decay: 0.2, sustain: 0.3, release: 0.15 }, mods: [{ source: 'env2', target: 'posA', amount: 0.35 }] }),
    fx: { drive: 0.5, delay: 0.2 },
  },
  {
    id: 'screech-fold',
    name: 'Fold Screech',
    category: 'Lead',
    hint: 'Gefalteter Screech, der im Achtel-Raster wandert',
    note: MID,
    synth: synth({ wave: 'sawtooth', tableA: 'screech', posA: 0.4, unison: 3, spread: 16, cutoff: 10000, resonance: 2, lfo2Rate: 8, mods: [{ source: 'lfo2', target: 'posA', amount: 0.3 }], attack: 0.003, decay: 0.2, sustain: 0.85, release: 0.15 }),
    fx: { drive: 0.45, delay: 0.2 },
  },
  {
    id: 'screech-acid',
    name: 'Acid Screech',
    category: 'Lead',
    hint: 'Resonanter 24-dB-Filter mit Hüllkurve: kreischt wie eine 303 im Lead-Register',
    note: MID,
    synth: synth({ wave: 'sawtooth', cutoff: 2500, resonance: 14, filter24: true, filterEnv: 2.5, filterDecay: 0.2, attack: 0.002, decay: 0.2, sustain: 0.7, release: 0.1 }),
    fx: { drive: 0.6, delay: 0.15 },
  },
  {
    id: 'screech-dirty',
    name: 'Dirty Screech',
    category: 'Lead',
    hint: 'Verzerrter Lead mit Filter-LFO im Achtel-Raster',
    note: MID,
    synth: synth({ wave: 'square', oscB: { wave: 'sawtooth', octave: 0, detune: 9, level: 0.8 }, unison: 3, spread: 20, cutoff: 5000, resonance: 8, lfoRate: 8, lfoDepth: 0.35, attack: 0.003, decay: 0.2, sustain: 0.85, release: 0.12 }),
    fx: { drive: 0.8 },
  },
  {
    id: 'screech-high',
    name: 'High Screech',
    category: 'Lead',
    hint: 'Hoher, spitzer Screech mit Oktave und Echo',
    note: 72,
    synth: synth({ wave: 'sawtooth', tableA: 'screech', posA: 0.85, oscB: { wave: 'sawtooth', octave: 1, detune: 6, level: 0.5 }, unison: 2, spread: 10, cutoff: 12000, resonance: 3, attack: 0.003, decay: 0.2, sustain: 0.8, release: 0.15 }),
    fx: { drive: 0.4, delay: 0.3 },
  },

  {
    id: 'tl-classic',
    name: 'Classic Trance Lead',
    category: 'Lead',
    hint: 'Sieben Säge, offener Filter, Echo und Hall: der Standard',
    note: MID,
    synth: synth({ wave: 'sawtooth', unison: 7, spread: 28, cutoff: 5500, resonance: 1.2, filterEnv: 0.5, filterDecay: 0.3, attack: 0.005, decay: 0.3, sustain: 0.85, release: 0.3 }),
    fx: { delay: 0.3, reverb: 0.25 },
  },
  {
    id: 'tl-uplift',
    name: 'Uplifting Lead',
    category: 'Lead',
    hint: 'Strahlend, mit einer Oktave darüber für den Break-Höhepunkt',
    note: MID,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'square', octave: 1, detune: 5, level: 0.3 }, unison: 7, spread: 34, cutoff: 7000, resonance: 1, attack: 0.01, decay: 0.3, sustain: 0.9, release: 0.4 }),
    fx: { reverb: 0.35, delay: 0.25 },
  },
  {
    id: 'tl-pluck-lead',
    name: 'Pluck Lead',
    category: 'Lead',
    hint: 'Kurzer Lead mit schnellem Filter-Zupfen',
    note: MID,
    synth: synth({ wave: 'sawtooth', unison: 5, spread: 20, cutoff: 1500, resonance: 2, filterEnv: 3.5, filterDecay: 0.18, attack: 0.002, decay: 0.25, sustain: 0.3, release: 0.25 }),
    fx: { delay: 0.3, reverb: 0.2 },
  },
  {
    id: 'tl-hard',
    name: 'Hard Trance Lead',
    category: 'Lead',
    hint: 'Härter Lead mit Drive, fünf Stimmen',
    note: MID,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'square', octave: 0, detune: 7, level: 0.5 }, unison: 5, spread: 22, cutoff: 3500, resonance: 3, attack: 0.003, decay: 0.2, sustain: 0.85, release: 0.15 }),
    fx: { drive: 0.4, delay: 0.2 },
  },
  {
    id: 'tl-soft',
    name: 'Soft Trance Lead',
    category: 'Lead',
    hint: 'Sanfter Lead mit langsamem Einsatz',
    note: MID,
    synth: synth({ wave: 'triangle', oscB: { wave: 'sawtooth', octave: 0, detune: 6, level: 0.5 }, unison: 3, spread: 14, cutoff: 3000, resonance: 1, attack: 0.05, decay: 0.4, sustain: 0.85, release: 0.5 }),
    fx: { reverb: 0.4, delay: 0.2 },
  },
  {
    id: 'tl-vowel',
    name: 'Voice Lead',
    category: 'Lead',
    hint: 'Lead mit Vokal-Wavetable: singt A bis U',
    note: MID,
    synth: synth({ wave: 'sawtooth', tableA: 'vowel', posA: 0.4, unison: 3, spread: 14, cutoff: 9000, resonance: 0.8, lfoRate: 0.5, mods: [{ source: 'lfo1', target: 'posA', amount: 0.4 }], attack: 0.02, decay: 0.3, sustain: 0.9, release: 0.3 }),
    fx: { reverb: 0.3, delay: 0.2 },
  },

  {
    id: 'stab-hoover',
    name: 'Hoover Stab',
    category: 'Pluck & Stab',
    hint: 'Kurzer, breiter Hoover-Schlag',
    note: MID,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'square', octave: -1, detune: -20, level: 0.7 }, unison: 5, spread: 70, cutoff: 3000, resonance: 2, filterEnv: 1, filterDecay: 0.15, attack: 0.002, decay: 0.2, sustain: 0.05, release: 0.12, env2: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.1 }, mods: [{ source: 'env2', target: 'pitch', amount: 0.2 }] }),
    fx: { drive: 0.3, reverb: 0.15 },
  },
  {
    id: 'stab-minor',
    name: 'Minor Stab',
    category: 'Pluck & Stab',
    hint: 'Weicher Moll-Akkord mit kurzem Filter-Öffnen',
    note: MID,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'square', octave: 0, detune: 8, level: 0.5 }, unison: 3, spread: 12, cutoff: 1300, resonance: 2, filterEnv: 2, filterDecay: 0.2, attack: 0.003, decay: 0.25, sustain: 0.2, release: 0.2 }),
    fx: { reverb: 0.3 },
  },
  {
    id: 'stab-hard',
    name: 'Hard Stab',
    category: 'Pluck & Stab',
    hint: 'Kurz, hart, verzerrt: für Offbeat-Schläge',
    note: MID,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'sawtooth', octave: 0, detune: 12, level: 0.6 }, unison: 3, spread: 16, cutoff: 3500, resonance: 3, filterEnv: 1.5, filterDecay: 0.1, attack: 0.001, decay: 0.12, sustain: 0, release: 0.06 }),
    fx: { drive: 0.5, reverb: 0.1 },
  },
  {
    id: 'stab-fm',
    name: 'FM Stab',
    category: 'Pluck & Stab',
    hint: 'Metallischer FM-Schlag, der sich schnell beruhigt',
    note: MID,
    synth: synth({ wave: 'sine', tableA: 'fm', posA: 0.6, cutoff: 10000, resonance: 0.8, attack: 0.002, decay: 0.2, sustain: 0.1, release: 0.15, env2: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.1 }, mods: [{ source: 'env2', target: 'posA', amount: -0.45 }] }),
    fx: { reverb: 0.2, delay: 0.15 },
  },
  {
    id: 'stab-organ',
    name: 'Organ Stab',
    category: 'Pluck & Stab',
    hint: 'Orgel-Schlag wie im House',
    note: MID,
    synth: synth({ wave: 'square', oscB: { wave: 'sine', octave: 1, detune: 0, level: 0.6 }, unison: 2, spread: 6, cutoff: 2800, resonance: 1, attack: 0.003, decay: 0.15, sustain: 0.35, release: 0.12 }),
    fx: { reverb: 0.2 },
  },
  {
    id: 'stab-detune',
    name: 'Detuned Stab',
    category: 'Pluck & Stab',
    hint: 'Sieben verstimmte Säge: ein breiter, trancig-wuchtiger Akkord',
    note: MID,
    synth: synth({ wave: 'sawtooth', unison: 7, spread: 60, cutoff: 3200, resonance: 1.5, filterEnv: 1, filterDecay: 0.2, attack: 0.002, decay: 0.22, sustain: 0.1, release: 0.18 }),
    fx: { reverb: 0.25, delay: 0.15 },
  },

  {
    id: 'pluck-sine',
    name: 'Sine Pluck',
    category: 'Pluck & Stab',
    hint: 'Runder Sinus-Zupfton mit Oktave',
    note: MID,
    synth: synth({ wave: 'sine', oscB: { wave: 'triangle', octave: 1, detune: 0, level: 0.3 }, cutoff: 6000, resonance: 0.7, attack: 0.002, decay: 0.3, sustain: 0, release: 0.2 }),
    fx: { reverb: 0.2, delay: 0.25 },
  },
  {
    id: 'pluck-saw',
    name: 'Saw Pluck',
    category: 'Pluck & Stab',
    hint: 'Knackiger Säge-Zupfton mit schnellem Filter',
    note: MID,
    synth: synth({ wave: 'sawtooth', unison: 3, spread: 12, cutoff: 900, resonance: 3, filterEnv: 4, filterDecay: 0.12, attack: 0.001, decay: 0.16, sustain: 0, release: 0.1 }),
    fx: { delay: 0.3 },
  },
  {
    id: 'pluck-square',
    name: 'Square Pluck',
    category: 'Pluck & Stab',
    hint: 'Hohler Chiptune-Zupfton',
    note: MID,
    synth: synth({ wave: 'square', cutoff: 2500, resonance: 1.5, filterEnv: 2, filterDecay: 0.12, attack: 0.001, decay: 0.14, sustain: 0, release: 0.08 }),
    fx: { delay: 0.2 },
  },
  {
    id: 'pluck-pizz',
    name: 'Pizzicato',
    category: 'Pluck & Stab',
    hint: 'Kurzer, trockener Streicher-Zupfton',
    note: MID,
    synth: synth({ wave: 'triangle', oscB: { wave: 'sawtooth', octave: 0, detune: 4, level: 0.3 }, cutoff: 3500, resonance: 1, filterEnv: 1.5, filterDecay: 0.08, attack: 0.001, decay: 0.1, sustain: 0, release: 0.06 }),
    fx: { reverb: 0.15 },
  },
  {
    id: 'pluck-kalimba',
    name: 'Kalimba',
    category: 'Pluck & Stab',
    hint: 'Weicher Daumenklavier-Ton aus FM',
    note: MID,
    synth: synth({ wave: 'sine', tableA: 'fm', posA: 0.25, cutoff: 9000, resonance: 0.7, attack: 0.001, decay: 0.5, sustain: 0, release: 0.4, env2: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 }, mods: [{ source: 'env2', target: 'posA', amount: 0.3 }] }),
    fx: { reverb: 0.3, delay: 0.2 },
  },
  {
    id: 'pluck-glass',
    name: 'Glass Pluck',
    category: 'Pluck & Stab',
    hint: 'Klarer, gläserner Zupfton mit zwei Oktaven darüber',
    note: MID,
    synth: synth({ wave: 'sine', oscB: { wave: 'sine', octave: 2, detune: 0, level: 0.4 }, cutoff: 12000, resonance: 0.7, attack: 0.001, decay: 0.45, sustain: 0, release: 0.5 }),
    fx: { reverb: 0.4, delay: 0.2 },
  },

  {
    id: 'bass-rumble-long',
    name: 'Long Rumble',
    category: 'Bass',
    hint: 'Lange, dunkle Rumble-Note, die in der Kick-Lücke atmet',
    note: BASS,
    synth: synth({ wave: 'sawtooth', unison: 3, spread: 14, sub: 0.7, cutoff: 260, resonance: 2, attack: 0.005, decay: 0.4, sustain: 0.7, release: 0.2 }),
    fx: { drive: 0.25, pump: 0.8, reverb: 0.1 },
  },
  {
    id: 'bass-wobble',
    name: 'Wobble Bass',
    category: 'Bass',
    hint: 'Filter-Wobble im Viertel-Raster',
    note: BASS,
    synth: synth({ wave: 'sawtooth', oscB: { wave: 'square', octave: 0, detune: 6, level: 0.6 }, sub: 0.4, cutoff: 900, resonance: 6, lfoRate: 2, lfoDepth: 0.7, attack: 0.005, decay: 0.2, sustain: 0.9, release: 0.15 }),
    fx: { drive: 0.35 },
  },
  {
    id: 'bass-fm',
    name: 'FM Bass',
    category: 'Bass',
    hint: 'Metallisch knurrender FM-Bass',
    note: BASS,
    synth: synth({ wave: 'sine', tableA: 'fm', posA: 0.35, sub: 0.3, cutoff: 3000, resonance: 1, attack: 0.003, decay: 0.2, sustain: 0.85, release: 0.12, env2: { attack: 0.002, decay: 0.25, sustain: 0.3, release: 0.1 }, mods: [{ source: 'env2', target: 'posA', amount: 0.35 }] }),
    fx: { drive: 0.25 },
  },
  {
    id: 'bass-808',
    name: 'Sub Boom',
    category: 'Bass',
    hint: 'Sinus-Boom mit kurzem Klick und langem Ausklang',
    note: 33,
    synth: synth({ wave: 'sine', oscB: { wave: 'triangle', octave: 1, detune: 0, level: 0.15 }, cutoff: 900, resonance: 0.7, filterEnv: 2, filterDecay: 0.05, attack: 0.002, decay: 0.8, sustain: 0.2, release: 0.4 }),
    fx: { drive: 0.2 },
  },

  {
    id: 'pad-glass',
    name: 'Glass Pad',
    category: 'Pad',
    hint: 'Kühle, helle Fläche aus Obertönen',
    note: MID,
    synth: synth({ wave: 'sine', tableA: 'harm', posA: 0.45, unison: 4, spread: 18, cutoff: 9000, resonance: 0.8, attack: 0.8, decay: 0.5, sustain: 0.9, release: 1.6, lfo2Rate: 0.25, mods: [{ source: 'lfo2', target: 'posA', amount: 0.3 }] }),
    fx: { reverb: 0.5 },
  },
  {
    id: 'pad-ocean',
    name: 'Ocean Pad',
    category: 'Pad',
    hint: 'Rauschende Fläche, die wie Wellen kommt und geht',
    note: 48,
    synth: synth({ wave: 'sawtooth', unison: 6, spread: 36, noise: 0.15, cutoff: 1500, resonance: 1.2, lfoRate: 0.25, lfoDepth: 0.5, attack: 1.2, decay: 0.5, sustain: 1, release: 2 }),
    fx: { reverb: 0.55 },
  },
  {
    id: 'pad-choir',
    name: 'Choir Pad',
    category: 'Pad',
    hint: 'Chor-Fläche aus der Vokal-Wavetable',
    note: MID,
    synth: synth({ wave: 'sawtooth', tableA: 'vowel', posA: 0.55, unison: 5, spread: 22, cutoff: 8000, resonance: 0.8, attack: 0.9, decay: 0.5, sustain: 0.9, release: 1.5, lfo2Rate: 0.25, mods: [{ source: 'lfo2', target: 'posA', amount: 0.25 }] }),
    fx: { reverb: 0.5 },
  },

];

export const presetById = (id: string | undefined): SoundPreset | undefined => PRESETS.find((p) => p.id === id);

/**
 * The track with a new instrument and its sound effects (drive, reverb, delay, pump), so nothing of the
 * previous sound lingers; the DJ filter and pan are kept.
 */
export function applyInstrument(track: Track, synth: SynthSettings, fx: SoundPreset['fx'] = {}): Track {
  const next: TrackFx = { ...track.fx, drive: fx.drive ?? 0, reverb: fx.reverb ?? 0, delay: fx.delay ?? 0, pump: fx.pump ?? 0 };
  const clean = Object.values(next).every((v) => !v);
  return { ...track, synth, fx: clean ? undefined : next };
}

/**
 * A sample dropped on a track's instrument (Ableton: a sample dropped on Simpler): a sampler keeps its settings and only takes
 * the new sample; any other instrument is replaced by a fresh sampler playing it.
 */
export function withSamplerSample(track: Track, sampleId: string): Track {
  if (track.synth?.wave === 'sample') return { ...track, synth: { ...track.synth, sampleId } };
  return applyInstrument(track, { ...DEFAULT_SYNTH, ...SAMPLER_PRESET, sampleId } as SynthSettings);
}

export const applyPreset = (track: Track, preset: SoundPreset): Track => applyInstrument(track, { ...preset.synth, preset: preset.id }, preset.fx);

/** Which preset suits a generator style best (so the UI can offer to load it). */
export const SUGGESTED_PRESET: Record<string, string> = {
  rumble: 'rumble-saw',
  offbeat: 'pluck-bass',
  reese: 'reese',
  acid: 'acid',
  arp: 'arp-pluck',
  prog: 'trance-pluck',
  trance: 'supersaw',
  hypnotic: 'screech',
  pad: 'warm-pad',
  stabs: 'rave-stab',
  rave: 'rave-stab',
  kick: 'kick-hard',
  hat: 'hat-open',
  clap: 'clap',
  hats16: 'hat-closed',
  'kit-techno': 'kit-909',
  'kit-rolling': 'kit-909',
  'kit-minimal': 'kit-909',
};
