import { DEFAULT_SYNTH } from '../lib/project';
import type { SynthSettings, Track, TrackFx } from '../types';
import { KICK_PRESET, KIT909_PRESET, NOISE_PRESET } from './synth';

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
