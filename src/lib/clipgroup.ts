import type { Clip, Project } from '../types';
import { canHoldClip, editClip, splitClip, uid, type ClipEdit } from './project';

// Edits on several selected clips at once (multi-selection): they move, trim, duplicate and split together.

export interface GroupEdit {
  /** The clips after the edit, by id. */
  clips: Map<string, Clip>;
  /** How many tracks the clips move down (negative: up); 0 when one of them could not go there. */
  shift: number;
}

/**
 * Dragging the clip `leadId` (or one of its edges) by `deltaBars` and `trackShift` tracks, with the rest of `ids` following.
 * A move shifts every clip by the same snapped amount (never before bar 1); an edge drag trims every selected clip alike.
 * The group changes tracks only if every clip lands on a track of its own kind.
 */
export function groupEdit(project: Project, ids: string[], leadId: string, mode: ClipEdit, deltaBars: number, trackShift: number, grid: number): GroupEdit {
  const wanted = new Set(ids.includes(leadId) ? ids : [leadId]);
  const entries = project.tracks.flatMap((t, index) => t.clips.filter((c) => wanted.has(c.id)).map((clip) => ({ clip, index })));
  const lead = entries.find((e) => e.clip.id === leadId)?.clip;
  const clips = new Map<string, Clip>();
  if (!lead) return { clips, shift: 0 };
  if (mode === 'move') {
    const earliest = Math.min(...entries.map((e) => e.clip.start));
    const d = Math.max(-earliest, editClip(lead, 'move', deltaBars, grid).start - lead.start);
    for (const { clip } of entries) clips.set(clip.id, { ...clip, start: clip.start + d });
  } else {
    for (const { clip } of entries) clips.set(clip.id, { ...clip, ...editClip(clip, mode, deltaBars, grid) });
  }
  const fits = mode === 'move' && entries.every(({ clip, index }) => {
    const target = project.tracks[index + trackShift];
    return !!target && canHoldClip(target, clip);
  });
  return { clips, shift: fits ? trackShift : 0 };
}

/** The project with a group edit applied (clips replaced, and moved `shift` tracks when the edit says so). */
export function applyGroupEdit(project: Project, edit: GroupEdit): Project {
  if (!edit.clips.size) return project;
  const moving = new Map<number, Clip[]>();
  const tracks = project.tracks.map((t, index) => {
    const kept: Clip[] = [];
    for (const c of t.clips) {
      const next = edit.clips.get(c.id);
      if (!next) kept.push(c);
      else if (edit.shift === 0) kept.push(next);
      else moving.set(index + edit.shift, [...(moving.get(index + edit.shift) ?? []), next]);
    }
    return { ...t, clips: kept };
  });
  return { ...project, tracks: tracks.map((t, index) => (moving.has(index) ? { ...t, clips: [...t.clips, ...moving.get(index)!] } : t)) };
}

/** Copies of the selected clips right after the selection (as a block, each on its own track). Returns the copies' ids. */
export function duplicateClips(project: Project, ids: string[]): { project: Project; ids: string[] } {
  const wanted = new Set(ids);
  const picked = project.tracks.flatMap((t) => t.clips.filter((c) => wanted.has(c.id)));
  if (!picked.length) return { project, ids: [] };
  const span = Math.max(...picked.map((c) => c.start + c.length)) - Math.min(...picked.map((c) => c.start));
  const made: string[] = [];
  const next = {
    ...project,
    tracks: project.tracks.map((t) => {
      const copies = t.clips.filter((c) => wanted.has(c.id)).map((c) => ({ ...c, id: uid(), start: c.start + span }));
      made.push(...copies.map((c) => c.id));
      return copies.length ? { ...t, clips: [...t.clips, ...copies] } : t;
    }),
  };
  return { project: next, ids: made };
}

/** Every selected clip that the playhead `bar` crosses is cut there. Returns the ids of the right halves. */
export function splitClips(project: Project, ids: string[], bar: number): { project: Project; ids: string[] } {
  let next = project;
  const rights: string[] = [];
  for (const id of ids) {
    const rightId = uid();
    const after = splitClip(next, id, bar, rightId);
    if (after !== next) rights.push(rightId);
    next = after;
  }
  return { project: next, ids: rights };
}

/** Copied clips with the index of the track each came from. */
export interface ClipboardItem {
  clip: Clip;
  track: number;
}

export function copyClips(project: Project, ids: string[]): ClipboardItem[] {
  const wanted = new Set(ids);
  return project.tracks.flatMap((t, track) => t.clips.filter((c) => wanted.has(c.id)).map((clip) => ({ clip, track })));
}

/**
 * Pastes copied clips with their first one at `bar`. With `targetTrack` the block moves so its top track lands there
 * (if every clip fits a track of its kind; otherwise each goes back to its own track). Returns the new clips' ids.
 */
export function pasteClips(project: Project, items: ClipboardItem[], bar: number, targetTrack?: number): { project: Project; ids: string[] } {
  if (!items.length) return { project, ids: [] };
  const earliest = Math.min(...items.map((i) => i.clip.start));
  const top = Math.min(...items.map((i) => i.track));
  let shift = targetTrack === undefined ? 0 : targetTrack - top;
  if (!items.every((i) => project.tracks[i.track + shift] && canHoldClip(project.tracks[i.track + shift], i.clip))) shift = 0;
  const made: { track: number; clip: Clip }[] = items
    .filter((i) => project.tracks[i.track + shift])
    .map((i) => ({ track: i.track + shift, clip: { ...i.clip, id: uid(), start: Math.max(0, i.clip.start - earliest + bar) } }));
  const tracks = project.tracks.map((t, index) => {
    const add = made.filter((m) => m.track === index).map((m) => m.clip);
    return add.length ? { ...t, clips: [...t.clips, ...add] } : t;
  });
  return { project: { ...project, tracks }, ids: made.map((m) => m.clip.id) };
}

/** The bars a set of clips covers (for "loop the selection"). */
export function clipsSpan(project: Project, ids: string[]): { start: number; end: number } | null {
  const picked = copyClips(project, ids).map((i) => i.clip);
  if (!picked.length) return null;
  return { start: Math.min(...picked.map((c) => c.start)), end: Math.max(...picked.map((c) => c.start + c.length)) };
}

/** Clips on tracks [fromTrack, toTrack] that overlap the bars [fromBar, toBar] (a rubber-band selection). */
export function clipsInRange(project: Project, fromBar: number, toBar: number, fromTrack: number, toTrack: number): string[] {
  const [b0, b1] = fromBar <= toBar ? [fromBar, toBar] : [toBar, fromBar];
  const [t0, t1] = fromTrack <= toTrack ? [fromTrack, toTrack] : [toTrack, fromTrack];
  return project.tracks.flatMap((t, i) => (i < t0 || i > t1 ? [] : t.clips.filter((c) => c.start < b1 && c.start + c.length > b0).map((c) => c.id)));
}
