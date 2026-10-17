import { snapBars } from '../audio/timing';
import { MAX_DEVICES, createDevice, deviceParams } from '../audio/devices';
import { setLane } from './automation';
import type { ScaleName } from './melody';
import type { AutoParam, AutomationLane, Clip, Device, DeviceType, Note, Project, Sample, SampleCategory, SynthSettings, Track, TrackKind } from '../types';

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

export const TRACK_KIND_LABELS = { audio: 'Audio', midi: 'MIDI' } as const;

/**
 * What a track is. Projects from before track types have no `kind`: a track with notes or an instrument was
 * a MIDI track, anything else held audio.
 */
export function trackKind(track: Track): TrackKind {
  return track.kind ?? (track.synth || track.clips.some((c) => Array.isArray(c.notes)) ? 'midi' : 'audio');
}

/** Audio tracks take audio clips, MIDI tracks take MIDI clips: dragging a clip to the other kind is refused. */
export const canHoldClip = (track: Track, clip: Clip): boolean => (trackKind(track) === 'midi') === Array.isArray(clip.notes);

/** A MIDI track named "MIDI", with the synth colour so it reads differently from audio tracks at a glance. */
export function createMidiTrack(sceneCount: number, name = 'MIDI'): Track {
  return { ...createTrack('synth', sceneCount, name, 'midi'), color: '#3dd6ff' };
}

/**
 * Switch a track between audio and MIDI. Only an empty track can change (its clips would be the wrong kind):
 * otherwise the project is returned unchanged.
 */
export function setTrackKind(project: Project, trackId: string, kind: TrackKind): Project {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track || trackKind(track) === kind || track.clips.length > 0) return project;
  return mapTrack(project, trackId, (t) => ({ ...t, kind, ...(kind === 'audio' && { synth: undefined }) }));
}

export function createTrack(category: SampleCategory, sceneCount: number, name = CATEGORY_LABELS[category], kind: TrackKind = 'audio'): Track {
  return {
    id: uid(),
    name,
    kind,
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

// ---------------------------------------------------------------- device chain

/** Pseudo track id of the master bus in the device functions. */
export const MASTER_ID = '__master';

const mapDevices = (project: Project, trackId: string, fn: (devices: Device[]) => Device[]): Project =>
  trackId === MASTER_ID
    ? (() => {
        const devices = fn(project.master?.devices ?? []);
        return { ...project, master: devices.length ? { ...project.master, devices } : undefined };
      })()
    : mapTrack(project, trackId, (t) => {
    const devices = fn(t.devices ?? []);
    return { ...t, devices: devices.length ? devices : undefined };
  });

/** Adds an effect at `index` (default: the end of the chain). Refuses beyond MAX_DEVICES. */
export function addDevice(project: Project, trackId: string, type: DeviceType, index?: number): Project {
  return mapDevices(project, trackId, (list) => {
    if (list.length >= MAX_DEVICES) return list;
    const at = index === undefined ? list.length : Math.max(0, Math.min(list.length, index));
    return [...list.slice(0, at), createDevice(type, uid()), ...list.slice(at)];
  });
}

export const removeDevice = (project: Project, trackId: string, deviceId: string): Project =>
  mapDevices(project, trackId, (list) => list.filter((d) => d.id !== deviceId));

/**
 * Copies the whole device chain of `fromId` (a track or MASTER_ID) onto another track or the master: `replace` swaps the target's chain,
 * `append` adds the copies at its end (capped at MAX_DEVICES). The copies get fresh ids and keep their settings and on/off state; the automation
 * lanes of their knobs are copied too (onto the new devices). Unchanged when the source has no devices or the target is the source.
 */
export function copyDevices(project: Project, fromId: string, toId: string, mode: 'replace' | 'append' = 'append'): Project {
  if (fromId === toId) return project;
  const from = fromId === MASTER_ID ? (project.master?.devices ?? []) : (project.tracks.find((t) => t.id === fromId)?.devices ?? []);
  if (!from.length) return project;
  const copies = from.map((d) => ({ ...d, params: { ...d.params }, id: uid() }));
  const next = mapDevices(project, toId, (list) => (mode === 'replace' ? copies : [...list, ...copies].slice(0, MAX_DEVICES)));
  // The automation of the copied devices' knobs comes along, pointing at the copies (the master has no automation).
  const source = fromId === MASTER_ID ? undefined : project.tracks.find((t) => t.id === fromId);
  if (toId === MASTER_ID || !source?.automation?.length) return next;
  const ids = new Map(from.map((d, i) => [d.id, copies[i].id]));
  return mapTrack(next, toId, (t) => {
    let out = t;
    for (const lane of source.automation ?? []) {
      const m = /^dev:([^:]+):(.+)$/.exec(lane.param);
      if (m && ids.has(m[1]) && out.devices?.some((d) => d.id === ids.get(m[1]))) out = setLane(out, `dev:${ids.get(m[1])}:${m[2]}` as AutoParam, lane.points.map((p) => ({ ...p })));
    }
    return out;
  });
}

/** Moves a device by `delta` places in the chain (stays put at the ends). */
export function moveDevice(project: Project, trackId: string, deviceId: string, delta: number): Project {
  return mapDevices(project, trackId, (list) => {
    const from = list.findIndex((d) => d.id === deviceId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return list;
    const next = [...list];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  });
}

/** Switches a device on or off, or changes parameters (values are clamped and snapped to the device's definition). */
export function updateDevice(project: Project, trackId: string, deviceId: string, patch: { on?: boolean; params?: Record<string, number> }): Project {
  return mapDevices(project, trackId, (list) =>
    list.map((d) => {
      if (d.id !== deviceId) return d;
      const merged = { ...d, ...(patch.on !== undefined && { on: patch.on }) };
      if (patch.params) merged.params = deviceParams({ type: d.type, params: { ...d.params, ...patch.params } });
      return merged;
    }),
  );
}

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/** A copy of a whole project under a new id ("<name> (Kopie)"), for trying something out without touching the original. Samples are shared through the library. */
export function copyProject(project: Project, now: number = Date.now()): Project {
  const copy = JSON.parse(JSON.stringify(project)) as Project;
  return { ...copy, id: uid(), name: `${project.name} (Kopie)`, updatedAt: now };
}

/**
 * A copy of the track right below it (Live: Cmd+D on a track): clips, instrument, effects, devices, automation and session
 * slots, with fresh ids for the track, its clips and devices (device automation lanes follow the new device ids). The name
 * gets " Kopie"; solo is not copied. `trackId` of the copy is returned with the project.
 */
export function duplicateTrack(project: Project, trackId: string): { project: Project; trackId: string } {
  const index = project.tracks.findIndex((t) => t.id === trackId);
  if (index < 0) return { project, trackId };
  const t = project.tracks[index];
  const deviceIds = new Map((t.devices ?? []).map((d) => [d.id, uid()]));
  const remap = (param: string) => {
    const m = /^dev:([^:]+):(.+)$/.exec(param);
    return m && deviceIds.has(m[1]) ? `dev:${deviceIds.get(m[1])}:${m[2]}` : param;
  };
  const copy: Track = {
    ...structuredCloneSafe(t),
    id: uid(),
    name: `${t.name} Kopie`,
    solo: false,
    clips: t.clips.map((c) => ({ ...structuredCloneSafe(c), id: uid() })),
    ...(t.devices ? { devices: t.devices.map((d) => ({ ...structuredCloneSafe(d), id: deviceIds.get(d.id)! })) } : {}),
    ...(t.automation ? { automation: t.automation.map((l) => ({ param: remap(l.param) as AutomationLane['param'], points: l.points.map((p) => ({ ...p })) })) } : {}),
  };
  const tracks = [...project.tracks];
  tracks.splice(index + 1, 0, copy);
  return { project: { ...project, tracks }, trackId: copy.id };
}

/** A deep copy of plain project data (JSON-safe by design). */
const structuredCloneSafe = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Mutes the clips, or unmutes them when all are muted already (Live's 0 on a selection). */
export function toggleClipsMuted(project: Project, clipIds: string[]): Project {
  const ids = new Set(clipIds);
  const picked = project.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)));
  if (!picked.length) return project;
  const mute = picked.some((c) => !c.muted);
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.clips.some((c) => ids.has(c.id))
        ? {
            ...t,
            clips: t.clips.map((c) => {
              if (!ids.has(c.id)) return c;
              const { muted: _drop, ...rest } = c;
              return mute ? { ...rest, muted: true } : rest;
            }),
          }
        : t,
    ),
  };
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
  const hit = noteIndexAt(notes, pitch, start);
  if (hit >= 0) return notes.filter((_, i) => i !== hit);
  return addNote(notes, { pitch, start, length, velocity });
}

const NOTE_EPS = 1e-6;
/** Shortest note the piano roll edits to: a 64th. */
export const MIN_NOTE = 1 / 64;

const byTime = (a: Note, b: Note) => a.start - b.start || a.pitch - b.pitch;

/** Index of the note sounding on `pitch` at position `start` (anywhere inside it), or -1. */
export function noteIndexAt(notes: Note[], pitch: number, start: number): number {
  return notes.findIndex((n) => n.pitch === pitch && start >= n.start - NOTE_EPS && start < n.start + n.length - NOTE_EPS);
}

/** Index of the note that starts exactly at `start` on `pitch` (a note's identity in the editor), or -1. */
export function findNote(notes: Note[], pitch: number, start: number): number {
  return notes.findIndex((n) => n.pitch === pitch && Math.abs(n.start - start) < NOTE_EPS);
}

export function addNote(notes: Note[], note: Note): Note[] {
  return [...notes, note].sort(byTime);
}

/**
 * Change one note and keep it valid inside a clip of `clipLength` bars: pitch 0..127, starting inside
 * the clip, at least MIN_NOTE long and not past the clip end, velocity 0.05..1. Returns the new list
 * (sorted) and the note as it ended up, which is how the editor keeps its selection.
 */
export function updateNote(notes: Note[], index: number, patch: Partial<Note>, clipLength: number): { notes: Note[]; note: Note } {
  const old = notes[index];
  if (!old) return { notes, note: old };
  const merged = { ...old, ...patch };
  const start = Math.max(0, Math.min(clipLength - MIN_NOTE, merged.start));
  const note: Note = {
    pitch: Math.max(0, Math.min(127, Math.round(merged.pitch))),
    start,
    length: Math.max(MIN_NOTE, Math.min(clipLength - start, merged.length)),
    velocity: Math.max(0.05, Math.min(1, merged.velocity)),
  };
  return { notes: notes.map((n, i) => (i === index ? note : n)).sort(byTime), note };
}

/** A copy of the note right behind the original (same length); null when it would not fit in the clip. */
export function duplicateNote(notes: Note[], index: number, clipLength: number): { notes: Note[]; note: Note } | null {
  const src = notes[index];
  if (!src || src.start + src.length * 2 > clipLength + NOTE_EPS) return null;
  const note = { ...src, start: src.start + src.length };
  return { notes: addNote(notes, note), note };
}

/** All notes up or down by `semitones`, stopping where the first note would leave the MIDI range. */
export function transposeNotes(notes: Note[], semitones: number): Note[] {
  if (!notes.length) return notes;
  const lowest = Math.min(...notes.map((n) => n.pitch));
  const highest = Math.max(...notes.map((n) => n.pitch));
  const by = Math.max(-lowest, Math.min(127 - highest, Math.round(semitones)));
  return by ? notes.map((n) => ({ ...n, pitch: n.pitch + by })) : notes;
}

/** Snap starts and lengths to the grid (default 16ths); notes landing on the same pitch and step merge. */
export function quantizeNotes(notes: Note[], grid = 1 / 16): Note[] {
  const seen = new Set<string>();
  const out: Note[] = [];
  for (const n of [...notes].sort(byTime)) {
    const start = Math.round(n.start / grid) * grid;
    const key = `${n.pitch}@${Math.round(start / grid)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...n, start, length: Math.max(grid, Math.round(n.length / grid) * grid) });
  }
  return out;
}

/** Track colours to pick from: the category colours first, then a few more that read on the dark UI. */
export const TRACK_COLORS = ['#ff5a36', '#ffc53d', '#3dd6ff', '#c6ff3d', '#b28cff', '#ff4d7d', '#3dff9a', '#5a8cff', '#ff9a3d', '#e6e6ea'];

export const MAX_TRACK_NAME = 40;

/** Rename a track, capped at MAX_TRACK_NAME characters. Trimming and empty-name handling are up to the caller. */
export function renameTrack(project: Project, trackId: string, name: string): Project {
  const clean = name.slice(0, MAX_TRACK_NAME);
  return mapTrack(project, trackId, (t) => ({ ...t, name: clean }));
}

/** Move a track `delta` places up (negative) or down in the list, stopping at the ends. Unchanged when it cannot move. */
export function moveTrack(project: Project, trackId: string, delta: number): Project {
  const from = project.tracks.findIndex((t) => t.id === trackId);
  if (from < 0) return project;
  const to = Math.max(0, Math.min(project.tracks.length - 1, from + delta));
  if (to === from) return project;
  const tracks = [...project.tracks];
  const [moved] = tracks.splice(from, 1);
  tracks.splice(to, 0, moved);
  return { ...project, tracks };
}

/** Put a track at list position `to` (clamped), for drag-to-reorder. Unchanged when it is already there. */
export function moveTrackTo(project: Project, trackId: string, to: number): Project {
  const from = project.tracks.findIndex((t) => t.id === trackId);
  return from < 0 ? project : moveTrack(project, trackId, to - from);
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
  // Samples are audio: they only go to audio tracks (a MIDI track cannot play them as a clip).
  const audio = project.tracks.filter((t) => trackKind(t) === 'audio');
  return audio.find((t) => t.category === sample.category) ?? audio.find((t) => t.id === selectedTrackId) ?? audio[0];
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

/** Root (0 = C … 11 = B) and mode of a key name like "F# minor". */
export function parseKey(key: string): { root: number; mode: 'minor' | 'major' } {
  const [name, mode] = key.trim().split(/\s+/);
  const root = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(name);
  return { root: root < 0 ? 0 : root, mode: mode?.toLowerCase().startsWith('maj') ? 'major' : 'minor' };
}

/**
 * What every MIDI generator of the project plays in: the key's root, the scale (chosen, else the key's mode) and
 * the chord progression. Sharing it is what makes a bass and an arp from separate clips fit together.
 */
export function projectHarmony(project: Pick<Project, 'key' | 'scale' | 'progression'>): { root: number; scale: ScaleName; progression: number } {
  const { root, mode } = parseKey(project.key);
  return { root, scale: project.scale ?? mode, progression: project.progression ?? 0 };
}

export const KEYS = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
].flatMap((r) => [`${r} minor`, `${r} major`]);
