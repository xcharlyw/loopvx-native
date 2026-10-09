import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { parseSampleName } from '../audio/timing';
import { db } from '../storage/db';
import type { Sample } from '../types';
import { uid } from './project';

const samplesDir = new Directory(Paths.document, 'samples');

function ensureSamplesDir() {
  if (!samplesDir.exists) samplesDir.create();
}

/**
 * Let the user pick audio files from the device and add them to the library.
 * Google Drive sync (like the web app) lands in a later phase; for now, samples
 * come from the device's file picker and are copied into app storage.
 */
export async function importSamplesFromDevice(): Promise<Sample[]> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  ensureSamplesDir();
  const samples: Sample[] = [];
  for (const picked of result.assets) {
    const id = uid();
    const ext = picked.name.includes('.') ? picked.name.split('.').pop() : 'm4a';
    const dest = new File(samplesDir, `${id}.${ext}`);
    new File(picked.uri).copySync(dest);
    const parsed = parseSampleName(picked.name);
    const sample: Sample = { ...parsed, id, name: picked.name, uri: dest.uri, size: picked.size, addedAt: Date.now() };
    await db.putSample(sample);
    samples.push(sample);
  }
  return samples;
}

export function deleteSample(sample: Sample): void {
  if (!sample.uri) return;
  try {
    new File(sample.uri).delete();
  } catch {
    /* already gone */
  }
}
