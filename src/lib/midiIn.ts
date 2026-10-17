import type { Clip, Note, Project, Track, TrackFx } from '../types';
import { mapTrack, quantizeNotes } from './project';

/** What a MIDI message from a controller means to LOOPVX. Channels are 0-based. */
export type MidiMessage =
  | { type: 'noteOn'; channel: number; note: number; velocity: number }
  | { type: 'noteOff'; channel: number; note: number }
  | { type: 'cc'; channel: number; controller: number; value: number }
  | { type: 'other' };

/** Read the raw bytes of a MIDI message. A note-on with velocity 0 is a note-off (running status of many keyboards); velocity and value are 0..1. */
export function parseMidiMessage(data: ArrayLike<number>): MidiMessage {
  const status = data[0] ?? 0;
  const kind = status & 0xf0;
  const channel = status & 0x0f;
  if (status >= 0xf0 || data.length < 2) return { type: 'other' };
  const a = data[1] & 0x7f;
  const b = (data[2] ?? 0) & 0x7f;
  if (kind === 0x90) return b === 0 ? { type: 'noteOff', channel, note: a } : { type: 'noteOn', channel, note: a, velocity: b / 127 };
  if (kind === 0x80) return { type: 'noteOff', channel, note: a };
  if (kind === 0xb0) return { type: 'cc', channel, controller: a, value: b / 127 };
  return { type: 'other' };
}

// ---------------------------------------------------------------- knobs and faders (CC)

/** What a controller knob can move on the selected track. */
export type CcTarget = 'volume' | 'pan' | 'filter' | 'drive' | 'reverb' | 'delay' | 'pump';

export const CC_TARGETS: { id: CcTarget; label: string }[] = [
  { id: 'volume', label: 'Lautstärke' },
  { id: 'pan', label: 'Pan' },
  { id: 'filter', label: 'Filter' },
  { id: 'drive', label: 'Drive' },
  { id: 'reverb', label: 'Reverb' },
  { id: 'delay', label: 'Delay' },
  { id: 'pump', label: 'Pump' },
];

/** CC number → target. The defaults follow the General MIDI controllers (7 volume, 10 pan, 74 cutoff, 91 reverb, 93 chorus/delay). */
export type CcMap = Record<number, CcTarget>;
export const DEFAULT_CC_MAP: CcMap = { 7: 'volume', 10: 'pan', 74: 'filter', 71: 'drive', 91: 'reverb', 93: 'delay', 75: 'pump' };

/** A stored map brought into shape: only whole CC numbers 0..127 pointing at known targets survive (empty = the defaults). */
export function cleanCcMap(raw: unknown): CcMap {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CC_MAP };
  const ids = new Set<string>(CC_TARGETS.map((t) => t.id));
  const out: CcMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const cc = Number(k);
    if (Number.isInteger(cc) && cc >= 0 && cc <= 127 && typeof v === 'string' && ids.has(v)) out[cc] = v as CcTarget;
  }
  return Object.keys(out).length ? out : { ...DEFAULT_CC_MAP };
}

/** Assign a CC to a target (learn): the CC leaves its old target and the target leaves its old CC, so it is a one-to-one map. */
export function learnCc(map: CcMap, controller: number, target: CcTarget): CcMap {
  const out: CcMap = {};
  for (const [k, v] of Object.entries(map)) if (v !== target && Number(k) !== controller) out[Number(k)] = v;
  out[controller] = target;
  return out;
}

/** The CC currently assigned to a target, or undefined. */
export function ccOf(map: CcMap, target: CcTarget): number | undefined {
  const hit = Object.entries(map).find(([, v]) => v === target);
  return hit ? Number(hit[0]) : undefined;
}

/** Move a track's parameter to a controller position `value` (0..1 over the parameter's range). Same track when nothing changes. */
export function applyCc(project: Project, trackId: string, target: CcTarget, value: number): Project {
  const v = Math.min(1, Math.max(0, value));
  const round = (x: number) => Math.round(x * 100) / 100;
  return mapTrack(project, trackId, (t: Track): Track => {
    if (target === 'volume') return t.volume === round(v * 1.5) ? t : { ...t, volume: round(v * 1.5) };
    const next: Partial<TrackFx> =
      target === 'pan' ? { pan: Math.abs(v - 0.5) < 0.03 ? 0 : round(v * 2 - 1) } : target === 'filter' ? { filter: Math.abs(v - 0.5) < 0.03 ? 0 : round(v * 2 - 1) } : { [target]: round(v) };
    const key = Object.keys(next)[0] as keyof TrackFx;
    return (t.fx?.[key] ?? 0) === next[key] ? t : { ...t, fx: { ...t.fx, ...next } };
  });
}

// ---------------------------------------------------------------- recording played notes

/**
 * Collects the notes played on a controller while the transport runs. Positions are in bars on the project timeline;
 * `finish` turns them into notes relative to the clip start, closing notes still held.
 */
export class NoteRecorder {
  private open = new Map<number, { start: number; velocity: number }>();
  private done: Note[] = [];

  constructor(private origin: number) {}

  noteOn(pitch: number, velocity: number, at: number) {
    this.noteOff(pitch, at); // a retriggered key ends its previous note
    this.open.set(pitch, { start: Math.max(this.origin, at), velocity });
  }

  noteOff(pitch: number, at: number) {
    const o = this.open.get(pitch);
    if (!o) return;
    this.open.delete(pitch);
    this.done.push({ pitch, start: o.start - this.origin, length: Math.max(1 / 64, at - o.start), velocity: o.velocity });
  }

  get count(): number {
    return this.done.length + this.open.size;
  }

  /** The recorded notes, sorted, optionally snapped to a grid (1/16 bar). */
  finish(at: number, quantize = false): Note[] {
    for (const pitch of [...this.open.keys()]) this.noteOff(pitch, at);
    const sorted = [...this.done].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    return quantize ? quantizeNotes(sorted, 1 / 16) : sorted;
  }
}

/**
 * Put recorded notes on a MIDI track at `start` (whole bars) for `length` bars. A clip that already starts there takes the notes
 * (overdub, longer if needed) so a pattern can be built up take by take; otherwise a new clip is made.
 */
export function placeMidiTake(project: Project, trackId: string, notes: Note[], start: number, length: number, clipId: string): { project: Project; clipId: string } {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track || !notes.length) return { project, clipId: '' };
  const existing = track.clips.find((c) => c.notes && Math.abs(c.start - start) < 1e-9);
  if (existing) {
    const merged: Clip = { ...existing, length: Math.max(existing.length, length), notes: [...(existing.notes ?? []), ...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch) };
    return { project: mapTrack(project, trackId, (t) => ({ ...t, clips: t.clips.map((c) => (c.id === existing.id ? merged : c)) })), clipId: existing.id };
  }
  const clip: Clip = { id: clipId, sampleId: '', start, length, offset: 0, notes };
  return { project: mapTrack(project, trackId, (t) => ({ ...t, clips: [...t.clips, clip] })), clipId };
}
