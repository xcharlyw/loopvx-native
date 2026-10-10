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
  /** An oscillator, or 'sample': the library sample `sampleId` played chromatically. */
  wave: 'sawtooth' | 'square' | 'sine' | 'triangle' | 'sample';
  /** wave 'sample': which sample; it sounds at its original pitch on C3 (60). */
  sampleId?: string;
  /** wave 'sample': every note plays the whole sample, whatever its length (drums). */
  oneShot?: boolean;
  /** Lowpass cutoff in Hz and its resonance (Q). */
  cutoff: number;
  resonance: number;
  /** Envelope in seconds (sustain is a level 0..1). */
  attack: number;
  decay: number;
  sustain: number;
  release: number;
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
}

export interface SessionSlot {
  sampleId: string;
}

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
  /** Instrument for the track's MIDI clips (defaults apply when missing). */
  synth?: SynthSettings;
  /** Track effects; absent means none. */
  fx?: TrackFx;
  /** Session grid: one slot per scene. */
  slots: (SessionSlot | null)[];
}

export interface Project {
  id: string;
  name: string;
  bpm: number;
  key: string;
  tracks: Track[];
  sceneCount: number;
  loop: { enabled: boolean; start: number; end: number };
  updatedAt: number;
}
