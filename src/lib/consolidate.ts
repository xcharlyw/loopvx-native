import type { Clip, Note } from '../types';
import { uid } from './project';

/** The selected clip plus every clip of the track that touches it, left and right: what Consolidate (Cmd/Ctrl+J) merges. */
export function contiguousRun(clips: Clip[], id: string): Clip[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const i = sorted.findIndex((c) => c.id === id);
  if (i < 0) return [];
  const touches = (a: Clip, b: Clip) => b.start <= a.start + a.length + 1e-6;
  let lo = i;
  let hi = i;
  while (lo > 0 && touches(sorted[lo - 1], sorted[lo])) lo--;
  while (hi < sorted.length - 1 && touches(sorted[hi], sorted[hi + 1])) hi++;
  return sorted.slice(lo, hi + 1);
}

/** The run's span in bars. */
export function runSpan(run: Clip[]): { start: number; length: number } {
  const start = Math.min(...run.map((c) => c.start));
  return { start, length: Math.max(...run.map((c) => c.start + c.length)) - start };
}

/** One MIDI clip holding the notes of all of `run`, each cut at the end of the clip it came from. */
export function mergeMidiClips(run: Clip[], id: string = uid()): Clip {
  const { start, length } = runSpan(run);
  const notes: Note[] = run.flatMap((c) =>
    (c.notes ?? [])
      .filter((n) => n.start < c.length - 1e-9)
      .map((n) => ({ ...n, start: n.start + c.start - start, length: Math.min(n.length, c.length - n.start) })),
  );
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return { id, sampleId: '', start, length, offset: 0, notes };
}

/**
 * What Consolidate acts on. One selected clip: it and the clips touching it. Several: per track, the selected clips of
 * that track (the range from the first to the last one, with whatever lies in between; gaps become silence). Tracks without a selected clip are left alone.
 */
export function consolidateGroups(tracks: { id: string; clips: Clip[] }[], ids: string[]): { trackId: string; run: Clip[] }[] {
  const wanted = new Set(ids);
  const out: { trackId: string; run: Clip[] }[] = [];
  for (const t of tracks) {
    const picked = t.clips.filter((c) => wanted.has(c.id)).sort((a, b) => a.start - b.start);
    if (!picked.length) continue;
    if (ids.length === 1) {
      out.push({ trackId: t.id, run: contiguousRun(t.clips, picked[0].id) });
      continue;
    }
    // Like a time range in Ableton: whatever lies between the first and the last selected clip goes in too.
    const { start, length } = runSpan(picked);
    out.push({ trackId: t.id, run: t.clips.filter((c) => c.start < start + length - 1e-9 && c.start + c.length > start + 1e-9).sort((a, b) => a.start - b.start) });
  }
  return out;
}
