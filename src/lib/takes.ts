import type { Clip, Project, Track } from '../types';
import { createTrack, mapTrack, trackKind } from './project';

/** Where a recording goes: the selected audio track, else the first audio track named like vocals, else a new track. */
export function recordTarget(project: Project, selectedTrackId: string | null): { trackId: string | null } {
  const selected = project.tracks.find((t) => t.id === selectedTrackId);
  if (selected && trackKind(selected) === 'audio') return { trackId: selected.id };
  const vocals = project.tracks.find((t) => trackKind(t) === 'audio' && t.category === 'vocal');
  return { trackId: vocals?.id ?? null };
}

/**
 * The part of a recording that belongs on the timeline: the first `trimSec` seconds (count-in and device latency) are cut off.
 * A negative `trimSec` adds silence in front instead, for a take that started late.
 */
export function trimTake(samples: Float32Array, sampleRate: number, trimSec: number): Float32Array {
  const cut = Math.round(trimSec * sampleRate);
  if (cut === 0) return samples;
  if (cut > 0) return cut >= samples.length ? new Float32Array(0) : samples.slice(cut);
  const out = new Float32Array(samples.length - cut);
  out.set(samples, -cut);
  return out;
}

const overlaps = (a: Pick<Clip, 'start' | 'length'>, b: Pick<Clip, 'start' | 'length'>) => a.start < b.start + b.length - 1e-9 && b.start < a.start + a.length - 1e-9;

/** "Vocals Take 2" belongs to "Vocals": the base name and take number of a take track name. */
const takeOf = (name: string): { base: string; n: number } => {
  const m = /^(.*) Take (\d+)$/.exec(name);
  return m ? { base: m[1], n: Number(m[2]) } : { base: name, n: 1 };
};

/**
 * Put a recorded clip on a track. A free spot takes the clip as it is. When it lands on clips that are already there, it
 * goes onto a new track right below the track and its earlier takes ("<name> Take 2", "Take 3" …) and the clips it covers
 * are muted, so exactly the newest take plays and the older ones stay one tap away (unmute a clip to switch back).
 * `newTrackId` names the take track when one is needed.
 */
export function placeTake(project: Project, trackId: string, clip: Clip, newTrackId?: string): { project: Project; trackId: string } {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return { project, trackId };
  const covered = track.clips.filter((c) => !c.notes && overlaps(c, clip));
  if (!covered.length) return { project: mapTrack(project, trackId, (t) => ({ ...t, clips: [...t.clips, clip] })), trackId };

  const { base } = takeOf(track.name);
  const family = project.tracks.map((t, i) => ({ t, i, take: takeOf(t.name) })).filter((x) => x.take.base === base && trackKind(x.t) === 'audio' && (x.t.id === trackId || x.take.n > 1));
  const next = Math.max(...family.map((x) => x.take.n)) + 1;
  const mute = (t: Track): Track => (family.some((x) => x.t.id === t.id) ? { ...t, clips: t.clips.map((c) => (!c.notes && overlaps(c, clip) ? { ...c, muted: true } : c)) } : t);
  const created: Track = { ...createTrack(track.category, project.sceneCount, `${base} Take ${next}`), color: track.color, volume: track.volume, clips: [clip], ...(newTrackId ? { id: newTrackId } : {}), ...(track.groupId ? { groupId: track.groupId } : {}) };
  const tracks = project.tracks.map(mute);
  tracks.splice(Math.max(...family.map((x) => x.i)) + 1, 0, created);
  return { project: { ...project, tracks }, trackId: created.id };
}

/** A fresh audio track for a recording nobody had a track for. */
export const recordingTrack = (project: Project, id?: string): Track => ({ ...createTrack('vocal', project.sceneCount, 'Aufnahme'), ...(id ? { id } : {}) });
