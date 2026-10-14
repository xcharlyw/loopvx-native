import { download } from './drive';
import { libraryFolderOf, notYetImported, sampleFromDriveFile, type DriveEntry } from './driveImport';
import { splitDuplicates } from './duplicates';
import { storeSampleAudio } from './samples';
import { getState, setSamples, upsertSamples } from './store';
import type { Sample } from '../types';

const extOf = (name: string) => (/\.([a-z0-9]{2,5})$/i.exec(name)?.[1] ?? 'wav').toLowerCase();

export interface ImportResult {
  added: Sample[];
  skipped: number;
  /** Same file (name and size) as one already in the library or earlier in this import: not downloaded. */
  duplicates: number;
  /** Samples that were already in the library and only moved into their pack folder. */
  regrouped: number;
  failed: string[];
  /** The user stopped it; what was imported so far stays. */
  stopped: boolean;
}

/**
 * Downloads the chosen Drive files into the library, one after the other (big WAVs: one in memory at a time).
 * Files already in the library (same Drive id) are not downloaded again, but moved into the pack folder this import names
 * (so an older import that lost the main folder is fixed by importing the pack folder once more). The library list updates as it goes, so a long import
 * can be left running while the new loops already show up.
 */
export async function importDriveItems(items: { file: DriveEntry; folder: string; root?: string }[], onProgress: (done: number, total: number, name: string) => void, shouldStop: () => boolean = () => false): Promise<ImportResult> {
  const notYet = notYetImported(items, getState().samples);
  const { unique: fresh, dupes } = splitDuplicates(notYet, getState().samples);
  // Already imported files only get the (new) library folder: no download, the sync carries the change.
  const known = new Map(getState().samples.filter((x) => x.driveId).map((x) => [x.driveId!, x]));
  const moved: Sample[] = [];
  for (const { file, folder, root } of items) {
    const have = known.get(file.id);
    const target = libraryFolderOf(folder, root);
    if (have && target && have.folder !== target) moved.push({ ...have, folder: target });
  }
  if (moved.length) await upsertSamples(moved);
  const added: Sample[] = [];
  const failed: string[] = [];
  let stopped = false;
  for (const [i, { file, folder, root }] of fresh.entries()) {
    if (shouldStop()) {
      stopped = true;
      break;
    }
    onProgress(i, fresh.length, file.name);
    try {
      const sample = sampleFromDriveFile(file, folder, Date.now(), root);
      await storeSampleAudio(sample, await download(file.id), extOf(file.name));
      added.push(sample);
      setSamples([...getState().samples.filter((x) => x.id !== sample.id), sample]);
    } catch (e) {
      failed.push(file.name);
      console.warn('drive import failed', file.name, e);
    }
  }
  onProgress(fresh.length, fresh.length, '');
  return { added, skipped: items.length - notYet.length, duplicates: dupes.length, regrouped: moved.length, failed, stopped };
}
