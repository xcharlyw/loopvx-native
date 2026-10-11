import { parseSampleName } from '../audio/timing';
import type { Sample } from '../types';

// Importing loops from the user's existing Google Drive folders: what to show, what to skip, and how a Drive file
// becomes a sample. Pure (no network); the run itself is in driveImportRun.ts.

/** The parts of a Drive file this needs (`DriveFile` in drive.ts has them). */
export interface DriveEntry {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const AUDIO_EXT = /\.(wav|wave|mp3|m4a|aif|aiff|flac|ogg)$/i;

export const isFolder = (f: DriveEntry) => f.mimeType === FOLDER_MIME;

/** Audio the app can play. Google's own document types (Docs, Sheets ...) never count, whatever their name says. */
export const isAudio = (f: DriveEntry) => !isFolder(f) && !f.mimeType?.startsWith('application/vnd.google-apps.') && (!!f.mimeType?.startsWith('audio/') || AUDIO_EXT.test(f.name));

const byName = (a: DriveEntry, b: DriveEntry) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });

/** What a folder view lists: sub-folders first, then audio files, each sorted by name (numbers in order: "Kick 2" before "Kick 10"). */
export function browserEntries(children: DriveEntry[]): { folders: DriveEntry[]; audio: DriveEntry[] } {
  return { folders: children.filter(isFolder).sort(byName), audio: children.filter(isAudio).sort(byName) };
}

export const driveSampleId = (fileId: string) => `drive:${fileId}`;

/** Files that are not in the library yet (matched by Drive file id, so importing a folder twice adds nothing twice). */
export function notYetImported<T extends { file: DriveEntry }>(items: T[], samples: Pick<Sample, 'driveId'>[]): T[] {
  const have = new Set(samples.map((s) => s.driveId).filter(Boolean));
  return items.filter((i) => !have.has(i.file.id));
}

/** A library entry for a Drive file; `folder` is its path below the folder the user chose (the name's tokens and the folder decide the category). */
export function sampleFromDriveFile(file: DriveEntry, folder: string, now = Date.now()): Sample {
  const size = Number(file.size);
  return {
    ...parseSampleName(file.name, folder),
    id: driveSampleId(file.id),
    name: file.name,
    folder: folder || undefined,
    driveId: file.id,
    driveModified: file.modifiedTime,
    size: Number.isFinite(size) && size > 0 ? size : undefined,
    addedAt: now,
  };
}

export interface CollectLimits {
  maxDepth: number;
  maxFiles: number;
}

export const DEFAULT_LIMITS: CollectLimits = { maxDepth: 6, maxFiles: 400 };

/**
 * Every audio file below a folder, with its relative folder path. `list` gives a folder's children. Stops at
 * `maxFiles` (and says so) so a pick of the whole Drive cannot run away.
 */
export async function collectAudio(
  list: (folderId: string) => Promise<DriveEntry[]>,
  rootId: string,
  rootName: string,
  limits: CollectLimits = DEFAULT_LIMITS,
): Promise<{ items: { file: DriveEntry; folder: string }[]; truncated: boolean }> {
  const items: { file: DriveEntry; folder: string }[] = [];
  let truncated = false;
  const walk = async (id: string, path: string, depth: number) => {
    const { folders, audio } = browserEntries(await list(id));
    for (const file of audio) {
      if (items.length >= limits.maxFiles) {
        truncated = true;
        return;
      }
      items.push({ file, folder: path });
    }
    if (depth >= limits.maxDepth) {
      if (folders.length) truncated = true;
      return;
    }
    for (const sub of folders) {
      if (items.length >= limits.maxFiles) {
        truncated = true;
        return;
      }
      await walk(sub.id, path ? `${path}/${sub.name}` : sub.name, depth + 1);
    }
  };
  await walk(rootId, rootName, 0);
  return { items, truncated };
}

/** "12,3 MB" for a Drive size string. */
export function sizeText(size?: string): string {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;
}
