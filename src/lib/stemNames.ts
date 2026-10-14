import { parseSampleName } from '../audio/timing';
import type { Sample } from '../types';

// Naming and sorting of separated stems (pure, tested): the library folder is "Stems Export/<tune>", every stem keeps the
// tune's tempo and key (so they stay in sync when they play together), and the stem decides the category (and so the track).

export const STEMS_ROOT = 'Stems Export';

/** "My Tune (155 BPM).wav" -> "My Tune (155 BPM)"; characters that would break a folder path are dropped. */
export const tuneName = (fileName: string) => fileName.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Tune';

export const stemFolder = (tune: string) => `${STEMS_ROOT}/${tune}`;

const CATEGORY: Record<string, Sample['category']> = { Drums: 'kick', Bass: 'kick', Vocal: 'vocal', 'Synth + FX': 'synth', Keys: 'synth', Gitarre: 'synth' };

/** The library entry of one stem stored in Drive (id `drive:<fileId>`, like any Drive sample). */
export function stemSample(tuneFile: string, stem: { id: string; name: string; stem: string; size?: number }, now = Date.now()): Sample {
  const tune = tuneName(tuneFile);
  const parsed = parseSampleName(tuneFile);
  return {
    id: `drive:${stem.id}`,
    name: stem.name,
    driveId: stem.id,
    folder: stemFolder(tune),
    category: CATEGORY[stem.stem] ?? 'other',
    ...(parsed.bpm ? { bpm: parsed.bpm } : {}),
    ...(parsed.key ? { key: parsed.key } : {}),
    ...(stem.size ? { size: stem.size } : {}),
    addedAt: now,
  };
}

/** Stems in the order a producer reads them. */
const ORDER = ['Drums', 'Bass', 'Synth + FX', 'Keys', 'Gitarre', 'Vocal'];
export const byStemOrder = <T extends { stem: string }>(list: T[]) => [...list].sort((a, b) => (ORDER.indexOf(a.stem) + 99) % 99 - (ORDER.indexOf(b.stem) + 99) % 99);
