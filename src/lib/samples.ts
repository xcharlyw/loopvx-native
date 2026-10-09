import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { parseSampleName } from '../audio/timing';
import { db } from '../storage/db';
import type { Sample } from '../types';
import { uid } from './project';

// Native implementation; the web build uses samples.web.ts (expo-file-system has no web support).

function ensureSamplesDir(): Directory {
  const dir = new Directory(Paths.document, 'samples');
  if (!dir.exists) dir.create();
  return dir;
}

/** Let the user pick audio files and copy them into app storage. */
export async function importSamplesFromDevice(): Promise<Sample[]> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  const samplesDir = ensureSamplesDir();
  const samples: Sample[] = [];
  for (const picked of result.assets) {
    const id = uid();
    const ext = picked.name.includes('.') ? picked.name.split('.').pop() : 'm4a';
    const dest = new File(samplesDir, `${id}.${ext}`);
    new File(picked.uri).copySync(dest);
    const parsed = parseSampleName(picked.name);
    const sample: Sample = { ...parsed, id, name: picked.name, folder: 'Uploads', uri: dest.uri, size: picked.size, addedAt: Date.now() };
    await db.putSample(sample);
    samples.push(sample);
  }
  return samples;
}

/** What the audio engine decodes: a local file URI on native. */
export async function sampleSource(sample: Sample): Promise<string | ArrayBuffer> {
  if (!sample.uri) throw new Error(`Audio für "${sample.name}" nicht gefunden`);
  return sample.uri;
}

export async function deleteSample(sample: Sample): Promise<void> {
  if (!sample.uri) return;
  try {
    new File(sample.uri).delete();
  } catch {
    /* already gone */
  }
}
