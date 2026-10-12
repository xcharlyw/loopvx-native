import { download, folderInfo } from './drive';
import { notYetImported, packFolderFrom, sampleFromDriveFile, type DriveEntry } from './driveImport';
import { storeSampleAudio } from './samples';
import { getState, setSamples, upsertSamples } from './store';
import type { Sample } from '../types';

const extOf = (name: string) => (/\.([a-z0-9]{2,5})$/i.exec(name)?.[1] ?? 'wav').toLowerCase();

export interface ImportResult {
  added: Sample[];
  skipped: number;
  failed: string[];
  /** The user stopped it; what was imported so far stays. */
  stopped: boolean;
}

/**
 * Downloads the chosen Drive files into the library, one after the other (big WAVs: one in memory at a time).
 * Files already in the library (same Drive id) are skipped. The library list updates as it goes, so a long import
 * can be left running while the new loops already show up.
 */
export async function importDriveItems(items: { file: DriveEntry; folder: string }[], onProgress: (done: number, total: number, name: string) => void, shouldStop: () => boolean = () => false): Promise<ImportResult> {
  const fresh = notYetImported(items, getState().samples);
  const added: Sample[] = [];
  const failed: string[] = [];
  let stopped = false;
  for (const [i, { file, folder }] of fresh.entries()) {
    if (shouldStop()) {
      stopped = true;
      break;
    }
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
  return { added, skipped: items.length - fresh.length, failed, stopped };
}

/**
 * Names the library folder of every Drive sample after its pack again (the rule changed: "drum_loops" of ten packs
 * used to land in one folder). Reads each file's parent folder from Drive; folders are looked up once.
 */
export async function refolderDriveSamples(onProgress: (done: number, total: number) => void): Promise<number> {
  const mine = getState().samples.filter((s) => s.driveId);
  const folders = new Map<string, Promise<{ name: string; parent?: string } | null>>();
  const getFolder = (id: string) => {
    if (!folders.has(id)) folders.set(id, folderInfo(id));
    return folders.get(id)!;
  };
  const changed: Sample[] = [];
  let done = 0;
  const queue = [...mine];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const file = await folderInfo(s.driveId!).catch(() => null);
      const pack = file ? await packFolderFrom(getFolder, file.parent) : undefined;
      if (pack && pack !== s.folder) changed.push({ ...s, folder: pack });
      onProgress(++done, mine.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await upsertSamples(changed);
  return changed.length;
}
