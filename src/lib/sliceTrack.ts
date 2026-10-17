import { SLICER_PRESET, SLICE_ROOT } from '../audio/synth';
import { sliceBars, type Slice } from '../audio/slicing';
import type { Sample, SynthSettings, Track } from '../types';
import { DEFAULT_SYNTH, createMidiClip, createMidiTrack } from './project';

/** Pad number (note 36 = C1 = pad 1) of a slice, for the pad names in the UI. */
export const slicePitch = (index: number): number => SLICE_ROOT + index;

/**
 * A MIDI track that plays `sample` as a slicer: note 36 + i plays slice i (the Drum Rack layout). `mode`:
 * 'pads' only sets the instrument up (play the pads or draw notes yourself); 'midi' also writes the notes that
 * play the loop back in its original order (Ableton's "Slice to MIDI Track"), so you can rearrange the pieces.
 * The clip starts at `startBar` and is as many whole bars long as the loop.
 */
export function slicerTrack(
  sample: Pick<Sample, 'id' | 'name' | 'bpm'>,
  slices: Slice[],
  opts: { mode: 'pads' | 'midi'; projectBpm: number; sceneCount: number; startBar?: number },
): Track {
  const track = createMidiTrack(opts.sceneCount, `${sample.name.replace(/\.[a-z0-9]{2,4}$/i, '')} Slices`.slice(0, 40));
  const synth = { ...DEFAULT_SYNTH, ...SLICER_PRESET, sampleId: sample.id, slices: slices.map((s) => s.start), ...(sample.bpm ? { sliceBpm: sample.bpm } : {}) } as SynthSettings;
  const out: Track = { ...track, synth };
  if (opts.mode === 'pads' || !slices.length) return out;
  const placed = slices.map((s) => sliceBars(s, sample.bpm, opts.projectBpm));
  const last = placed[placed.length - 1];
  const clip = createMidiClip(Math.max(0, Math.floor(opts.startBar ?? 0)), Math.max(1, Math.ceil(last.start + last.length - 0.02)));
  clip.notes = placed.map((p, i) => ({ pitch: slicePitch(i), start: p.start, length: p.length, velocity: 1 }));
  return { ...out, clips: [clip] };
}
