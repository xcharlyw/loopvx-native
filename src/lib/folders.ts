import type { Sample } from '../types';

// Folders of the sample library. A sample's `folder` is a path like "Loops/Kicks" (set by the Drive import, Splice and
// the user); folders that hold samples exist by themselves, empty ones the user made are kept in a separate list.
// Pure functions: each returns what changed, the caller stores it.

export const SEP = '/';
export const MAX_NAME = 40;

/** A tidy path: parts trimmed, empty parts dropped. */
export const normPath = (p?: string) =>
  (p ?? '')
    .split(SEP)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(SEP);

export const nameOf = (path: string) => path.split(SEP).pop() ?? '';
export const parentOf = (path: string) => path.split(SEP).slice(0, -1).join(SEP);
export const join = (parent: string, name: string) => (parent ? `${parent}${SEP}${name}` : name);

/** The path of a folder shown for people: "Loops / Kicks". */
export const prettyPath = (path: string) => path.split(SEP).join(' / ');

/** Why a folder name is not allowed (or null when it is fine). */
export function nameError(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Der Name darf nicht leer sein.';
  if (n.includes(SEP)) return 'Der Name darf kein „/“ enthalten.';
  if (n.length > MAX_NAME) return `Der Name ist zu lang (höchstens ${MAX_NAME} Zeichen).`;
  return null;
}

/** Every folder, including the parents of nested ones, sorted like a tree. */
export function allFolders(samples: Pick<Sample, 'folder'>[], extra: string[] = []): string[] {
  const set = new Set<string>();
  for (const raw of [...samples.map((s) => s.folder), ...extra]) {
    const parts = normPath(raw).split(SEP).filter(Boolean);
    for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join(SEP));
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' }));
}

/** The folders directly inside `parent` ('' = the top level). */
export const childFolders = (all: string[], parent: string): string[] => all.filter((f) => parentOf(f) === parent);

/** Samples directly in `folder` ('' = loose samples at the top level). */
export const samplesIn = (samples: Sample[], folder: string): Sample[] => samples.filter((s) => normPath(s.folder) === folder);

/** How many samples a folder holds, with and without its sub-folders. */
export function countIn(samples: Pick<Sample, 'folder'>[], folder: string): { direct: number; total: number } {
  let direct = 0;
  let total = 0;
  for (const s of samples) {
    const f = normPath(s.folder);
    if (f === folder) direct++;
    if (f === folder || f.startsWith(folder + SEP)) total++;
  }
  return { direct, total };
}

const inside = (path: string, folder: string) => path === folder || path.startsWith(folder + SEP);
const swapPrefix = (path: string, from: string, to: string) => (inside(path, from) ? to + path.slice(from.length) : path);

/** Samples whose folder changes when `from` becomes `to` (renamed or merged), and the new list of empty folders. */
export function renameFolder(samples: Sample[], extra: string[], from: string, to: string): { changed: Sample[]; extra: string[] } {
  const changed = samples.filter((s) => inside(normPath(s.folder), from)).map((s) => ({ ...s, folder: normPath(swapPrefix(normPath(s.folder), from, to)) || undefined }));
  const moved = [...new Set(extra.map((e) => normPath(swapPrefix(e, from, to))))];
  return { changed, extra: moved };
}

/** Takes a folder apart: its samples and sub-folders move up one level; nothing is deleted. */
export function dissolveFolder(samples: Sample[], extra: string[], folder: string): { changed: Sample[]; extra: string[] } {
  const parent = parentOf(folder);
  const up = (path: string) => (path === folder ? parent : parent ? join(parent, path.slice(folder.length + 1)) : path.slice(folder.length + 1));
  const changed = samples.filter((s) => inside(normPath(s.folder), folder)).map((s) => ({ ...s, folder: up(normPath(s.folder)) || undefined }));
  const rest = extra.filter((e) => e !== folder).map((e) => (e.startsWith(folder + SEP) ? up(e) : e));
  return { changed, extra: [...new Set(rest)] };
}

/** Samples (by id) moved into `folder` ('' = top level); only those that are not there already. */
export function moveSamples(samples: Sample[], ids: Iterable<string>, folder: string): Sample[] {
  const want = new Set(ids);
  const target = normPath(folder);
  return samples.filter((s) => want.has(s.id) && normPath(s.folder) !== target).map((s) => ({ ...s, folder: target || undefined }));
}

/** A folder name that is free in `parent`: "Neuer Ordner", "Neuer Ordner 2" ... */
export function freeName(all: string[], parent: string, base = 'Neuer Ordner'): string {
  const taken = new Set(childFolders(all, parent).map(nameOf));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** True when some folder is inside another one. */
export const hasNesting = (samples: Pick<Sample, 'folder'>[], extra: string[] = []) => allFolders(samples, extra).some((f) => f.includes(SEP));

/**
 * Flattens the tree: every sample keeps only the last part of its folder path ("Loops/Kicks" becomes "Kicks"), so
 * folders of the same name merge. Returns the samples that change and the empty folders, flattened the same way.
 */
export function flattenFolders(samples: Sample[], extra: string[]): { changed: Sample[]; extra: string[] } {
  const changed = samples.filter((s) => normPath(s.folder).includes(SEP)).map((s) => ({ ...s, folder: nameOf(normPath(s.folder)) }));
  return { changed, extra: [...new Set(extra.map((e) => nameOf(normPath(e))).filter(Boolean))] };
}
