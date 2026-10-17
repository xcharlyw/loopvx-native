import type { Sample } from '../types';

// Duplicate samples: the same file reached twice, e.g. "Version 34 - Hard Kick Pack" and "Version 34 - Mini Hard Techno Kick Pack"
// both holding "Kick 12.wav". A file counts as a duplicate when its name (without case) and byte size are the same; a file
// without a known size is never called a duplicate (a name alone proves nothing). Pure; the actions are in the UI.

export const dupKey = (name: string, size?: number | string): string | null => {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${name.trim().toLowerCase()}|${n}`;
};

interface Importable {
  file: { id: string; name: string; size?: string };
}

/**
 * Splits files to import into new ones and duplicates: a file is a duplicate when the library already holds one with the same
 * name and size under another Drive id, or when an earlier file of the same list is the same. Files with the same Drive id are
 * not touched (those are "already imported", handled elsewhere).
 */
export function splitDuplicates<T extends Importable>(items: T[], samples: Pick<Sample, 'name' | 'size' | 'driveId'>[]): { unique: T[]; dupes: T[] } {
  const seen = new Set<string>();
  const haveIds = new Set<string>();
  for (const s of samples) {
    if (s.driveId) haveIds.add(s.driveId);
    const k = dupKey(s.name, s.size);
    if (k) seen.add(k);
  }
  const unique: T[] = [];
  const dupes: T[] = [];
  for (const it of items) {
    const k = dupKey(it.file.name, it.file.size);
    if (haveIds.has(it.file.id) || !k) {
      unique.push(it);
    } else if (seen.has(k)) {
      dupes.push(it);
    } else {
      seen.add(k);
      unique.push(it);
    }
  }
  return { unique, dupes };
}

export interface DuplicateGroup {
  keep: Sample;
  /** Copies that can go: not used by any project. */
  drop: Sample[];
  /** Copies that stay because a project plays them. */
  pinned: Sample[];
}

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * Two library entries are the same file when the name matches and nothing contradicts it: same size, a size missing on one side
 * (older imports), the same folder, or the same length. Only a different size AND folder AND length says "different file, same name".
 */
export function sameSample(a: Sample, b: Sample): boolean {
  if (nameKey(a.name) !== nameKey(b.name)) return false;
  if (!a.size || !b.size || a.size === b.size) return true;
  if ((a.folder ?? '') === (b.folder ?? '')) return true;
  return a.duration !== undefined && b.duration !== undefined && Math.abs(a.duration - b.duration) < 0.005;
}

/**
 * Duplicate groups in the library. The copy to keep is one a project uses (else the oldest); the other copies are only
 * offered for removal when no project uses them, so a clip never goes silent.
 */
export function libraryDuplicates(samples: Sample[], usedIds: Set<string>): DuplicateGroup[] {
  const byName = new Map<string, Sample[]>();
  for (const s of samples) byName.set(nameKey(s.name), [...(byName.get(nameKey(s.name)) ?? []), s]);
  const out: DuplicateGroup[] = [];
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    // Split a same-name list into groups of really identical files.
    const groups: Sample[][] = [];
    for (const s of list) {
      const g = groups.find((x) => sameSample(x[0], s));
      if (g) g.push(s);
      else groups.push([s]);
    }
    for (const g of groups) {
      if (g.length < 2) continue;
      const sorted = [...g].sort((a, b) => Number(usedIds.has(b.id)) - Number(usedIds.has(a.id)) || a.addedAt - b.addedAt);
      const [keep, ...rest] = sorted;
      out.push({ keep, drop: rest.filter((x) => !usedIds.has(x.id)), pinned: rest.filter((x) => usedIds.has(x.id)) });
    }
  }
  return out.filter((g) => g.drop.length || g.pinned.length).sort((a, b) => a.keep.name.localeCompare(b.keep.name));
}

/** Every sample id the given projects play (clips, session slots, sample instruments). */
export function usedSampleIds(projects: { tracks: { clips: { sampleId: string }[]; slots: ({ sampleId: string } | null)[]; synth?: { sampleId?: string }; frozen?: { sampleId: string } }[] }[]): Set<string> {
  const ids = new Set<string>();
  for (const p of projects)
    for (const t of p.tracks) {
      for (const c of t.clips) if (c.sampleId) ids.add(c.sampleId);
      for (const sl of t.slots) if (sl?.sampleId) ids.add(sl.sampleId);
      if (t.synth?.sampleId) ids.add(t.synth.sampleId);
      if (t.frozen) ids.add(t.frozen.sampleId);
    }
  return ids;
}
