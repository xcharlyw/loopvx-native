export type SampleCategory = 'kick' | 'top' | 'synth' | 'vocal' | 'other';

export interface Sample {
  id: string;
  name: string;
  category: SampleCategory;
  /** Native tempo of the loop, parsed from the file name or set by the user. Undefined for one-shots. */
  bpm?: number;
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

export interface Clip {
  id: string;
  sampleId: string;
  /** Position on the timeline in bars (0-based, may be fractional at beat resolution). */
  start: number;
  /** Length on the timeline in bars. The sample loops to fill it. */
  length: number;
  /** Offset into the (warped) sample in bars. */
  offset: number;
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
