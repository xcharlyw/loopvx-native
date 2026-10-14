import type { Project, Sample } from '../types';
import { download, driveCanRead, searchByName } from './drive';
import { sampleFromDriveFile, type DriveEntry } from './driveImport';
import { pickDriveFile, pickSpliceResult } from './fxPick';
import { downloadFromSplice, searchSplice, spliceAvailable, spliceConnected } from './splice';
import { spliceSampleId } from './spliceResults';
import { findFxSample, isKeyWord, type FxHit } from './arranger';
import { storeSampleAudio } from './samples';
import { getState, setSamples } from './store';

// When the AI asks for a sound that is not in the library yet ("Screech Synth in Fmin"), it is looked up in the user's Drive
// (by name, like the browser's search), the best file is imported as a normal Drive sample and then placed like any library
// sample. Picking is pure and tested; only `fetchMissingFx` talks to Drive.

const plain = (v: string) => v.toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^a-z0-9äöüß]+/g, ' ').trim();

export interface FxSources {
  library: boolean;
  drive: boolean;
  splice: boolean;
}

export interface FxFetch {
  /** Samples found outside the library (or in it, when the library is not a source): the pool the effects pick from. */
  pool: Sample[];
  /** Samples newly loaded into the library. */
  loaded: Sample[];
  /** Why a source could not help (not connected ...), in German. */
  notes: string[];
}

/**
 * For every effect the chosen sources have to supply: the library (as is), then Google Drive (search by name, import the best
 * file), then Splice (search, ask before the credit is spent, download). Returns the samples to pick from; failures are skipped.
 */
export async function fetchMissingFx(hits: FxHit[], project: Pick<Project, 'bpm'>, sources: FxSources, confirmSplice: (name: string) => Promise<boolean>): Promise<FxFetch> {
  const out: FxFetch = { pool: [], loaded: [], notes: [] };
  const pending = hits.filter((h) => !(sources.library && findFxSample(getState().samples, h)));
  if (!pending.length) return out;
  let drive = false;
  if (sources.drive) {
    try {
      drive = await driveCanRead();
    } catch {
      drive = false;
    }
    if (!drive) out.notes.push('Google Drive: kein Lesezugriff, bitte neu mit Google anmelden.');
  }
  let splice = false;
  if (sources.splice) {
    splice = spliceAvailable() && (await spliceConnected().catch(() => false));
    if (!splice) out.notes.push('Splice ist nicht verbunden (Library → Splice).');
  }
  for (const hit of pending) {
    const words = (hit.search ?? []).filter((w) => !isKeyWord(plain(w))).slice(0, 2);
    if (drive) {
      try {
        const found = new Map<string, DriveEntry>();
        for (const w of words) for (const f of await searchByName(w)) found.set(f.id, f);
        const file = pickDriveFile([...found.values()], hit, project.bpm);
        if (file) {
          let sample = getState().samples.find((s) => s.driveId === file.id);
          if (!sample) {
            sample = await storeSampleAudio(sampleFromDriveFile(file, ''), await download(file.id), (/\.([a-z0-9]{2,5})$/i.exec(file.name)?.[1] ?? 'wav').toLowerCase());
            setSamples([...getState().samples.filter((x) => x.id !== sample!.id), sample]);
            out.loaded.push(sample);
          }
          out.pool.push(sample);
          continue;
        }
      } catch (e) {
        console.warn('drive lookup failed', words, e);
      }
    }
    if (splice) {
      try {
        const results = await searchSplice({ query: [...words, hit.key ?? ''].join(' ').trim(), ...((hit.length ?? 0) >= 8 ? { type: 'loop' as const } : {}), bpmMin: Math.round(project.bpm) - 8, bpmMax: Math.round(project.bpm) + 8 });
        const r = pickSpliceResult(results, hit, project.bpm);
        if (r) {
          let sample = getState().samples.find((s) => s.id === spliceSampleId(r.uuid));
          if (!sample) {
            if (!(await confirmSplice(r.name.replace(/\.[a-z0-9]+$/i, '')))) continue;
            sample = await downloadFromSplice(r);
            out.loaded.push(sample);
          }
          out.pool.push(sample);
        }
      } catch (e) {
        console.warn('splice lookup failed', words, e);
        out.notes.push('Splice: Suche oder Download fehlgeschlagen.');
      }
    }
  }
  return out;
}
