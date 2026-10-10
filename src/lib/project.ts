import { snapBars } from '../audio/timing';
import type { Clip, Note, Project, Sample, SampleCategory, SynthSettings, Track } from '../types';

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

// ---------------- MIDI ----------------

export const DEFAULT_SYNTH: SynthSettings = { wave: 'sawtooth', cutoff: 2400, resonance: 4, attack: 0.005, decay: 0.15, sustain: 0.6, release: 0.12 };

export const isMidiClip = (clip: Clip): boolean => Array.isArray(clip.notes);

export const trackSynth = (track: Track): SynthSettings => ({ ...DEFAULT_SYNTH, ...track.synth });

/** Every sample the arrangement plays: audio clips plus the sample instruments of tracks with MIDI clips. */
export function arrangementSampleIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const t of project.tracks) {
    for (const c of t.clips) if (c.sampleId) ids.add(c.sampleId);
    if (t.synth?.wave === 'sample' && t.synth.sampleId && t.clips.some(isMidiClip)) ids.add(t.synth.sampleId);
  }
  return ids;
}

export function createMidiClip(start: number, length = 4): Clip {
  return { id: uid(), sampleId: '', start, length, offset: 0, notes: [] };
}

/**
 * Tap in the piano roll: a note starting at that step and pitch is removed, otherwise one is added
 * (`length` bars long). Notes stay sorted by start, then pitch.
 */
export function toggleNote(notes: Note[], pitch: number, start: number, length: number, velocity = 0.8): Note[] {
  const eps = 1e-6;
  const hit = notes.findIndex((n) => n.pitch === pitch && start >= n.start - eps && start < n.start + n.length - eps);
  if (hit >= 0) return notes.filter((_, i) => i !== hit);
  return [...notes, { pitch, start, length, velocity }].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** Track colours to pick from: the category colours first, then a few more that read on the dark UI. */
export const TRACK_COLORS = ['#ff5a36', '#ffc53d', '#3dd6ff', '#c6ff3d', '#b28cff', '#ff4d7d', '#3dff9a', '#5a8cff', '#ff9a3d', '#e6e6ea'];

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
  // The fade-in stays on the left part, the fade-out on the right one; MIDI notes go with their half.
  const left: Clip = { ...clip, length: cut, fadeOut: undefined, ...(clip.notes && { notes: notesInRange(clip.notes, 0, cut) }) };
  const right: Clip = {
    ...clip,
    id: rightId,
    start: bar,
    length: clip.length - cut,
    offset: clip.offset + cut,
    fadeIn: undefined,
    ...(clip.notes && { notes: notesInRange(clip.notes, cut, clip.length) }),
  };
  return mapTrack(project, track.id, (t) => ({
    ...t,
    clips: t.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c])),
  }));
}

export type ClipEdit = 'move' | 'start' | 'end';

/**
 * Where a clip ends up after dragging it (`move`) or one of its edges (`start`/`end`) by
 * `deltaBars`, snapped to `grid`. Trimming the start keeps the audio in place on the timeline
 * by shifting the clip's offset into the sample, like dragging a clip edge in Ableton.
 */
export function editClip(clip: Clip, mode: ClipEdit, deltaBars: number, grid: number): Pick<Clip, 'start' | 'length' | 'offset' | 'notes'> {
  const end = clip.start + clip.length;
  if (mode === 'move') return { start: Math.max(0, snapBars(clip.start + deltaBars, grid)), length: clip.length, offset: clip.offset, notes: clip.notes };
  if (mode === 'end') return { start: clip.start, length: Math.max(grid, snapBars(end + deltaBars, grid) - clip.start), offset: clip.offset, notes: clip.notes };
  const start = Math.min(Math.max(0, snapBars(clip.start + deltaBars, grid)), end - grid);
  // MIDI notes keep their place in the song: shift them against the new clip start.
  const notes = clip.notes && notesInRange(clip.notes, start - clip.start, Infinity);
  return { start, length: end - start, offset: clip.offset + (start - clip.start), notes };
}

/** Notes starting in [from, to) (bars into the clip), moved so `from` is their new zero and cut at `to`. */
export function notesInRange(notes: Note[], from: number, to: number): Note[] {
  return notes
    .filter((n) => n.start >= from - 1e-9 && n.start < to - 1e-9)
    .map((n) => ({ ...n, start: n.start - from, length: Math.min(n.length, to - n.start) }));
}

/**
 * Change a clip's length by `factor`. A MIDI clip doubled repeats its pattern, like extending a loop
 * in Ableton; halved, it keeps the notes that still fit.
 */
export function scaleClip(clip: Clip, factor: number): Partial<Clip> {
  const length = Math.max(0.25, clip.length * factor);
  if (!clip.notes) return { length };
  if (length <= clip.length) return { length, notes: notesInRange(clip.notes, 0, length) };
  const notes: Note[] = [];
  for (let offset = 0; offset < length - 1e-9; offset += clip.length) {
    notes.push(...notesInRange(clip.notes, 0, Math.min(clip.length, length - offset)).map((n) => ({ ...n, start: n.start + offset })));
  }
  return { length, notes };
}

/** Best track for a sample: first track of the same category, else the selected one. */
export function trackForSample(project: Project, sample: Sample, selectedTrackId?: string | null): Track | undefined {
  return (
    project.tracks.find((t) => t.category === sample.category) ??
    project.tracks.find((t) => t.id === selectedTrackId) ??
    project.tracks[0]
  );
}

/** Whether stored data has the shape of a project at all (anything else would crash rendering). */
export function isProject(value: unknown): value is Project {
  const p = value as Project | null;
  return (
    !!p &&
    typeof p.id === 'string' &&
    typeof p.bpm === 'number' &&
    Array.isArray(p.tracks) &&
    p.tracks.every((t) => !!t && typeof t.id === 'string' && Array.isArray(t.clips) && Array.isArray(t.slots)) &&
    !!p.loop
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
