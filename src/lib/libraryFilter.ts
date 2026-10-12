import type { Sample } from '../types';

// Which samples fit the project (tempo and key) and the ways the library can be ordered. Pure, so it is tested.

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

export interface Pitch {
  root: number;
  /** Undefined when the file name only says "A#" and not whether it is major or minor. */
  mode?: 'major' | 'minor';
}

/** "A# minor", "Bb", "F#" ... as a root and (when known) a mode; null for no or unreadable keys. */
export function keyPitch(key?: string): Pitch | null {
  const [raw, word] = (key ?? '').trim().split(/\s+/);
  if (!raw) return null;
  const name = FLATS[raw] ?? raw;
  const root = NAMES.indexOf(name);
  if (root < 0) return null;
  const mode = word?.toLowerCase().startsWith('maj') ? 'major' : word?.toLowerCase().startsWith('min') ? 'minor' : undefined;
  return { root, mode };
}

const wrap = (n: number) => ((n % 12) + 12) % 12;

/**
 * Whether two keys mix well: the same key, its relative major/minor, or a neighbour on the circle of fifths (the
 * usual harmonic-mixing rules). A missing or unreadable key never rules a sample out.
 */
export function keysFit(sampleKey: string | undefined, projectKey: string): boolean {
  const s = keyPitch(sampleKey);
  const p = keyPitch(projectKey);
  if (!s || !p) return true;
  // Roots a project in its own key may use: itself, its fifth up/down, and the relative key of each.
  const mode = p.mode ?? 'minor';
  const sameMode = [p.root, wrap(p.root + 7), wrap(p.root - 7)];
  const relative = (root: number) => wrap(mode === 'minor' ? root + 3 : root - 3);
  const fits = (candidate: number, m: 'major' | 'minor') => (s.mode ? s.mode === m && s.root === candidate : s.root === candidate);
  return sameMode.some((r) => fits(r, mode)) || sameMode.some((r) => fits(relative(r), mode === 'minor' ? 'major' : 'minor'));
}

export type SortBy = 'name' | 'bpm' | 'key' | 'new';
export const SORT_LABELS: Record<SortBy, string> = { name: 'Name', bpm: 'BPM', key: 'Tonart', new: 'Neu' };

const byName = (a: Sample, b: Sample) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });

/** A sorted copy. Samples without tempo or key go last; ties fall back to the name. */
export function sortSamples(list: Sample[], by: SortBy): Sample[] {
  const out = [...list];
  if (by === 'new') return out.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) || byName(a, b));
  if (by === 'bpm') return out.sort((a, b) => (a.bpm ?? Infinity) - (b.bpm ?? Infinity) || byName(a, b));
  if (by === 'key') {
    const rank = (s: Sample) => {
      const p = keyPitch(s.key);
      return p ? p.root * 2 + (p.mode === 'major' ? 1 : 0) : Infinity;
    };
    return out.sort((a, b) => rank(a) - rank(b) || byName(a, b));
  }
  return out.sort(byName);
}
