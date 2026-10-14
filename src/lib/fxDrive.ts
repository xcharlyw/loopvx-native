import type { Project, Sample } from '../types';
import { download, driveCanRead, searchByName } from './drive';
import { sampleFromDriveFile, type DriveEntry } from './driveImport';
import { pickDriveFile } from './fxPick';
import { findFxSample, isKeyWord, type FxHit } from './arranger';
import { storeSampleAudio } from './samples';
import { getState, setSamples } from './store';

// When the AI asks for a sound that is not in the library yet ("Screech Synth in Fmin"), it is looked up in the user's Drive
// (by name, like the browser's search), the best file is imported as a normal Drive sample and then placed like any library
// sample. Picking is pure and tested; only `fetchMissingFx` talks to Drive.

const plain = (v: string) => v.toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^a-z0-9äöüß]+/g, ' ').trim();

/**
 * For every effect without a library sample: searches Drive, imports the best file and returns the imported samples (they are
 * in the library afterwards, so `findFxSample` finds them). Silent when Drive is not readable; failures are skipped.
 */
export async function fetchMissingFx(hits: FxHit[], project: Pick<Project, 'bpm'>): Promise<Sample[]> {
  const imported: Sample[] = [];
  if (!hits.some((h) => !findFxSample(getState().samples, h))) return imported;
  try {
    if (!(await driveCanRead())) return imported;
  } catch {
    return imported;
  }
  for (const hit of hits) {
    if (findFxSample(getState().samples, hit)) continue;
    const words = (hit.search ?? []).filter((w) => !isKeyWord(plain(w))).slice(0, 2);
    try {
      const found = new Map<string, DriveEntry>();
      for (const w of words) for (const f of await searchByName(w)) found.set(f.id, f);
      const file = pickDriveFile([...found.values()], hit, project.bpm);
      if (!file) continue;
      const have = getState().samples.find((s) => s.driveId === file.id);
      if (have) continue;
      const sample = await storeSampleAudio(sampleFromDriveFile(file, ''), await download(file.id), (/\.([a-z0-9]{2,5})$/i.exec(file.name)?.[1] ?? 'wav').toLowerCase());
      setSamples([...getState().samples.filter((x) => x.id !== sample.id), sample]);
      imported.push(sample);
    } catch (e) {
      console.warn('drive lookup failed', words, e);
    }
  }
  return imported;
}
