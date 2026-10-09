import { snapBars } from '../audio/timing';
import type { Clip, Project, Sample, SampleCategory, Track } from '../types';

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const CATEGORY_COLORS: Record<SampleCategory, string> = {
  kick: '#ff5a36',
  top: '#ffc53d',
  synth: '#3dd6ff',
  vocal: '#c6ff3d',
  other: '#b28cff',
};

export const CATEGORY_LABELS: Record<SampleCategory, string> = {
  kick: 'Kick + Bass',
  top: 'Top Loop',
  synth: 'Synth / Lead',
  vocal: 'Vocals',
  other: 'Sonstiges',
};

export function createTrack(category: SampleCategory, sceneCount: number, name = CATEGORY_LABELS[category]): Track {
  return {
    id: uid(),
    name,
    category,
    color: CATEGORY_COLORS[category],
    volume: 0.8,
    muted: false,
    solo: false,
    clips: [],
    slots: Array.from({ length: sceneCount }, () => null),
  };
}

/** Default layout: kick+bass/rumble, top loop, synth/lead, then vocals. */
export function createProject(name = 'Neues Projekt', bpm = 155, key = 'E minor'): Project {
  const sceneCount = 8;
  return {
    id: uid(),
    name,
    bpm,
    key,
    sceneCount,
    tracks: (['kick', 'top', 'synth', 'vocal'] as SampleCategory[]).map((c) => createTrack(c, sceneCount)),
    loop: { enabled: true, start: 0, end: 8 },
    updatedAt: Date.now(),
  };
}

export function mapTrack(project: Project, trackId: string, fn: (t: Track) => Track): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function updateClip(project: Project, clipId: string, patch: Partial<Clip>): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.clips.some((c) => c.id === clipId)
        ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) }
        : t,
    ),
  };
}

export function removeClip(project: Project, clipId: string): Project {
  return { ...project, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) })) };
}

export const MAX_TRACK_NAME = 40;

/** Rename a track, capped at MAX_TRACK_NAME characters. Trimming and empty-name handling are up to the caller. */
export function renameTrack(project: Project, trackId: string, name: string): Project {
  const clean = name.slice(0, MAX_TRACK_NAME);
  return mapTrack(project, trackId, (t) => ({ ...t, name: clean }));
}

export function removeTrack(project: Project, trackId: string): Project {
  return { ...project, tracks: project.tracks.filter((t) => t.id !== trackId) };
}

/**
 * Cut a clip in two at `bar` (Ableton's Split, Cmd+E). The right part keeps playing the
 * sample where the left part stopped. Unchanged when `bar` is not strictly inside the clip.
 */
export function splitClip(project: Project, clipId: string, bar: number, rightId: string = uid()): Project {
  const found = findClip(project, clipId);
  if (!found) return project;
  const { clip, track } = found;
  const cut = bar - clip.start;
  if (!(cut > 1e-6 && cut < clip.length - 1e-6)) return project;
  const right: Clip = { ...clip, id: rightId, start: bar, length: clip.length - cut, offset: clip.offset + cut };
  return mapTrack(project, track.id, (t) => ({
    ...t,
    clips: t.clips.flatMap((c) => (c.id === clipId ? [{ ...c, length: cut }, right] : [c])),
  }));
}

export type ClipEdit = 'move' | 'start' | 'end';

/**
 * Where a clip ends up after dragging it (`move`) or one of its edges (`start`/`end`) by
 * `deltaBars`, snapped to `grid`. Trimming the start keeps the audio in place on the timeline
 * by shifting the clip's offset into the sample, like dragging a clip edge in Ableton.
 */
export function editClip(clip: Clip, mode: ClipEdit, deltaBars: number, grid: number): Pick<Clip, 'start' | 'length' | 'offset'> {
  const end = clip.start + clip.length;
  if (mode === 'move') return { start: Math.max(0, snapBars(clip.start + deltaBars, grid)), length: clip.length, offset: clip.offset };
  if (mode === 'end') return { start: clip.start, length: Math.max(grid, snapBars(end + deltaBars, grid) - clip.start), offset: clip.offset };
  const start = Math.min(Math.max(0, snapBars(clip.start + deltaBars, grid)), end - grid);
  return { start, length: end - start, offset: clip.offset + (start - clip.start) };
}

/** Best track for a sample: first track of the same category, else the selected one. */
export function trackForSample(project: Project, sample: Sample, selectedTrackId?: string | null): Track | undefined {
  return (
    project.tracks.find((t) => t.category === sample.category) ??
    project.tracks.find((t) => t.id === selectedTrackId) ??
    project.tracks[0]
  );
}

/**
 * Repair clips whose numbers went non-finite (a NaN playhead once placed clips at NaN, which
 * JSON stores as null): move them to bar 1 and drop clips without a usable length.
 */
export function repairProject(project: Project): Project {
  const ok = (v: number) => Number.isFinite(v);
  const broken = project.tracks.some((t) => t.clips.some((c) => !ok(c.start) || !ok(c.length) || !ok(c.offset)));
  if (!broken) return project;
  return {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips
        .filter((c) => ok(c.length) && c.length > 0)
        .map((c) => ({ ...c, start: ok(c.start) ? c.start : 0, offset: ok(c.offset) ? c.offset : 0 })),
    })),
  };
}

export function addClip(project: Project, trackId: string, clip: Clip): Project {
  return mapTrack(project, trackId, (t) => ({ ...t, clips: [...t.clips, clip] }));
}

export function setSlot(project: Project, trackId: string, scene: number, sampleId: string | null): Project {
  return mapTrack(project, trackId, (t) => {
    const slots = [...t.slots];
    while (slots.length < project.sceneCount) slots.push(null);
    slots[scene] = sampleId ? { sampleId } : null;
    return { ...t, slots };
  });
}

export function audibleGain(track: Track, anySolo: boolean): number {
  if (track.muted) return 0;
  if (anySolo && !track.solo) return 0;
  return track.volume;
}

export const KEYS = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
].flatMap((r) => [`${r} minor`, `${r} major`]);
