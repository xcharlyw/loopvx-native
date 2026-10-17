import type { ScaleName } from './lib/melody';

export type SampleCategory = 'kick' | 'top' | 'synth' | 'vocal' | 'other';

export interface Sample {
  id: string;
  name: string;
  category: SampleCategory;
  /** Native tempo of the loop, parsed from the file name or set by the user. Undefined for one-shots. */
  bpm?: number;
  /**
   * How clips follow the project tempo: 'repitch' (default; speed and pitch change together, like
   * Ableton's Re-Pitch) or 'stretch' (time-stretch, pitch stays, like Ableton's Complex).
   */
  warp?: 'repitch' | 'stretch';
  key?: string;
  /** Length in seconds, filled after the first decode. */
  duration?: number;
  /** Splice asset id when the sample was downloaded from Splice (its id is `splice:<uuid>`). */
  spliceId?: string;
  /** Google Drive file id when the sample came from Drive. */
  driveId?: string;
  driveModified?: string;
  /** Supabase Storage path for generated vocals, so they sync across devices. */
  storagePath?: string;
  /** Relative folder path inside the chosen Drive folder, e.g. "Kicks/Rumble". */
  folder?: string;
  /** Local file URI (device storage), for samples imported directly on this device. */
  uri?: string;
  size?: number;
  addedAt: number;
  /** Last change of the metadata (tempo, key, category); drives Drive sync. Falls back to addedAt. */
  updatedAt?: number;
}

/** A MIDI note in a MIDI clip; positions in bars from the clip start. */
export interface Note {
  /** MIDI note number, 60 = C3 (Ableton's naming). */
  pitch: number;
  start: number;
  length: number;
  /** 0..1 */
  velocity: number;
}

/** The track's built-in instrument for its MIDI clips: one oscillator, a lowpass filter and an ADSR. */
export interface SynthSettings {
  /**
   * An oscillator; 'sample': the library sample `sampleId` played chromatically; 'kick': a synthesized
   * kick (sine with a pitch drop); 'noise': white noise through a highpass (hats, snares, risers);
   * 'kit909': a 909-style drum machine, one sound per note (kick C1, snare D1, clap D#1, hats F#1/A#1 ...).
   */
  wave: OscWave | 'sample' | 'kick' | 'noise' | 'kit909';
  /** wave 'kit909': multiplies every drum decay (1 = as the machine, `tune` shifts the pitch in cents). */
  kitDecay?: number;
  /** wave 'sample': which sample; it sounds at its original pitch on C3 (60). */
  sampleId?: string;
  /** wave 'sample': every note plays the whole sample, whatever its length (drums). */
  oneShot?: boolean;
  /** wave 'sample': the note on which the sample sounds unchanged (default C3 = 60), fine tune in cents. */
  sampleRoot?: number;
  tune?: number;
  /** Level of the instrument in dB (default 0), for samples and drums that come in too hot or too quiet. */
  gainDb?: number;
  /** Filter cutoff in Hz and its resonance (Q). */
  cutoff: number;
  resonance: number;
  /** Envelope in seconds (sustain is a level 0..1). */
  attack: number;
  decay: number;
  sustain: number;
  release: number;

  /** Id of the preset this sound started from (display only). */
  preset?: string;

  // ---- oscillator synth only (wave is an oscillator); every field is optional and defaults to "off" ----
  /** Second oscillator: wave, octaves (-2..2), fine tune in cents and level 0..1; with `table` it plays that wavetable at `pos`. */
  oscB?: { wave: OscWave; octave: number; detune: number; level: number; table?: string; pos?: number };
  /** Oscillator A as a wavetable (`wavetables.ts` id) at position 0..1 instead of `wave`. */
  tableA?: string;
  posA?: number;
  /** Two filters in a row (24 dB/octave). */
  filter24?: boolean;
  /** LFO 1 shape (default sine). LFO 1 runs at `lfoRate` and drives the cutoff by `lfoDepth`, and is a mod source. */
  lfoShape?: OscWave;
  /** LFO 2: cycles per bar and shape, only a mod source. */
  lfo2Rate?: number;
  lfo2Shape?: OscWave;
  /** Envelope 2 (0..1), only a mod source. */
  env2?: { attack: number; decay: number; sustain: number; release: number };
  /** The mod matrix: up to 8 routings source -> target with an amount -1..1. */
  mods?: ModSlot[];
  /** Unison: 1..7 detuned copies of each oscillator, spread over `spread` cents in total. */
  unison?: number;
  spread?: number;
  /** Sine one octave below (0..1) and white noise (0..1). */
  sub?: number;
  noise?: number;
  /** Filter type (default lowpass). */
  filterType?: 'lowpass' | 'highpass' | 'bandpass';
  /** Filter envelope: the cutoff starts `filterEnv` octaves higher and falls back within `filterDecay` seconds. */
  filterEnv?: number;
  filterDecay?: number;
  /** LFO on the cutoff, tempo-synced: `lfoRate` cycles per bar, `lfoDepth` 0..1 of the cutoff. */
  lfoRate?: number;
  lfoDepth?: number;
}

export type OscWave = 'sawtooth' | 'square' | 'sine' | 'triangle';

export type ArpPattern = 'up' | 'down' | 'updown' | 'random' | 'played' | 'chord';

/** Arpeggiator (a MIDI effect of the track): turns the notes held at each step into a run. Positions are in bars. */
export interface ArpSettings {
  on: boolean;
  pattern: ArpPattern;
  /** Steps per bar: 8 = 1/8, 16 = 1/16, 24 = 1/16 triplets, 32 = 1/32. */
  rate: number;
  /** Octaves the run climbs through, 1..4. */
  octaves: number;
  /** Note length as a fraction of a step, 0.05..1. */
  gate: number;
  /** Delay of every second step as a fraction of a step, 0..0.5. */
  swing: number;
  /** Id of the arp preset this started from (display only). */
  preset?: string;
}

/** One step of the step sequencer: on/off, the semitones above the held note, and an accent. */
export interface SeqStep {
  on: boolean;
  semi: number;
  accent?: boolean;
}

/** Step sequencer (a MIDI effect of the track): every held note plays the pattern, transposed to that note. */
export interface SeqSettings {
  on: boolean;
  /** Steps per bar (see ArpSettings.rate). */
  rate: number;
  /** How many of the 16 steps the pattern uses (1..16). */
  length: number;
  steps: SeqStep[];
  gate: number;
  swing: number;
  preset?: string;
}

export type ModSource = 'lfo1' | 'lfo2' | 'env2';
export type ModTarget = 'cutoff' | 'reso' | 'pitch' | 'posA' | 'posB' | 'level' | 'pan';
export interface ModSlot {
  source: ModSource;
  target: ModTarget;
  /** -1..1 */
  amount: number;
}

export interface TrackFx {
  /** DJ filter: -1 lowpass closed … 0 off … 1 highpass closed. */
  filter?: number;
  /** Distortion 0..1. */
  drive?: number;
  /** Post-fader sends to the project's reverb and delay, 0..1. */
  reverb?: number;
  delay?: number;
  /** Stereo position -1 (left) … 1 (right). */
  pan?: number;
  /** Sidechain-style ducking on every beat (like Kickstart), 0..1. */
  pump?: number;
  /** Duck on the kick hits of this (drum MIDI) track instead of on every beat. */
  pumpFrom?: string;
}

/** A track parameter that can follow a curve over the arrangement. */
/** A track parameter that can follow a curve over the arrangement. */
export type TrackAutoParam = 'filter' | 'drive' | 'reverb' | 'delay' | 'pan' | 'volume';
/** Track parameters, or a device knob as `dev:<deviceId>:<paramKey>` (its curve holds the knob position 0..1). */
export type AutoParam = TrackAutoParam | `dev:${string}`;

/** One point of an automation curve: `bar` is the position in bars, `value` is in the parameter's own range. */
export interface AutoPoint {
  bar: number;
  value: number;
}

/** A curve of one parameter: linear between the points, held before the first and after the last. */
export interface AutomationLane {
  param: AutoParam;
  points: AutoPoint[];
}

/** Effects that can sit in a track's device chain (after the instrument or the audio clips). */
export type DeviceType = 'eq' | 'comp' | 'sat' | 'echo' | 'reverb' | 'chorus' | 'filter' | 'limiter' | 'utility' | 'splice' | 'transient' | 'kickstart' | 'shaper';

export interface Device {
  id: string;
  type: DeviceType;
  /** Off = bypassed (the signal passes untouched). */
  on: boolean;
  /** Values by parameter key; missing keys use the device's defaults (see `audio/devices.ts`). */
  params: Record<string, number>;
}

export interface Clip {
  id: string;
  /** The audio clip's sample; '' for a MIDI clip. */
  sampleId: string;
  /** Present on MIDI clips: the notes the track's synth plays. */
  notes?: Note[];
  /** Position on the timeline in bars (0-based, may be fractional at beat resolution). */
  start: number;
  /** Length on the timeline in bars. The sample loops to fill it. */
  length: number;
  /** Offset into the (warped) sample in bars. */
  offset: number;
  /** Clip volume in dB (default 0). */
  gainDb?: number;
  /** Linear fade lengths in bars from the clip's start / towards its end (default 0 = none). */
  fadeIn?: number;
  fadeOut?: number;
  /** Deactivated (Live's "Deactivate clip", key 0): stays in place, greyed out, and is not played or rendered. */
  muted?: boolean;
}

export interface SessionSlot {
  sampleId: string;
}

/**
 * An audio track holds audio clips; a MIDI track holds MIDI clips and has an instrument; a group track holds
 * nothing itself: the tracks that name it in `groupId` play through its devices, fader and sends (Live's group / a bus).
 */
export type TrackKind = 'audio' | 'midi' | 'group';

export interface Track {
  id: string;
  name: string;
  category: SampleCategory;
  color: string;
  /** Linear gain, 0..1.5 (1 = 0 dB). */
  volume: number;
  muted: boolean;
  solo: boolean;
  clips: Clip[];
  /** Missing in older projects: see `trackKind` (inferred from what the track holds). */
  kind?: TrackKind;
  /** The group track this track plays through (instead of straight into the master); one level, groups do not nest. */
  groupId?: string;
  /** Instrument for the track's MIDI clips (defaults apply when missing). */
  synth?: SynthSettings;
  /** Track effects; absent means none. */
  fx?: TrackFx;
  /** Plugin slots after the instrument, in signal order (before the DJ filter, drive and fader). */
  devices?: Device[];
  /** Arpeggiator and step sequencer: MIDI effects that rewrite the track's notes while they play (the clips stay as drawn). */
  arp?: ArpSettings;
  seq?: SeqSettings;
  /** Parameter curves over the arrangement (filter sweeps, reverb throws, fades); at most one lane per parameter. */
  automation?: AutomationLane[];
  /** Session grid: one slot per scene. */
  slots: (SessionSlot | null)[];
}

/** A named position in the arrangement (Ableton's locator). */
export interface Marker {
  id: string;
  bar: number;
  name: string;
}

export interface Project {
  id: string;
  name: string;
  bpm: number;
  key: string;
  /** Scale the MIDI generators use (default: the mode of `key`) and the index of their shared chord progression. */
  scale?: ScaleName;
  progression?: number;
  tracks: Track[];
  sceneCount: number;
  loop: { enabled: boolean; start: number; end: number };
  /** The master bus: a device chain on the sum of all tracks (before the safety limiter). */
  master?: { devices?: Device[] };
  /** Locators shown in the ruler (sections like "Drop 1"). */
  markers?: Marker[];
  updatedAt: number;
}
