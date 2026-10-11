import { download } from './drive';
import { notYetImported, sampleFromDriveFile, type DriveEntry } from './driveImport';
import { storeSampleAudio } from './samples';
import { getState, setSamples } from './store';
import type { Sample } from '../types';

const extOf = (name: string) => (/\.([a-z0-9]{2,5})$/i.exec(name)?.[1] ?? 'wav').toLowerCase();

export interface ImportResult {
  added: Sample[];
  skipped: number;
  failed: string[];
}

/**
 * Downloads the chosen Drive files into the library, one after the other (big WAVs: one in memory at a time).
 * Files already in the library (same Drive id) are skipped. The library list updates as it goes, so a long import
 * can be left running while the new loops already show up.
 */
export async function importDriveItems(items: { file: DriveEntry; folder: string }[], onProgress: (done: number, total: number, name: string) => void): Promise<ImportResult> {
  const fresh = notYetImported(items, getState().samples);
  const added: Sample[] = [];
  const failed: string[] = [];
  for (const [i, { file, folder }] of fresh.entries()) {
    onProgress(i, fresh.length, file.name);
    try {
      const sample = sampleFromDriveFile(file, folder);
      await storeSampleAudio(sample, await download(file.id), extOf(file.name));
      added.push(sample);
      setSamples([...getState().samples.filter((x) => x.id !== sample.id), sample]);
    } catch (e) {
      failed.push(file.name);
      console.warn('drive import failed', file.name, e);
    }
  }
  onProgress(fresh.length, fresh.length, '');
  return { added, skipped: items.length - fresh.length, failed };
}
