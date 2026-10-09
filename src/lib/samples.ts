import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { parseSampleName } from '../audio/timing';
import { db } from '../storage/db';
import type { Sample } from '../types';
import { uid } from './project';

// `Paths.document`/`Directory` are not implemented on web (expo-file-system is
// native-only), so this must stay lazy: touching them at module load time
// crashes the web bundle before anything renders.
function ensureSamplesDir(): Directory {
  const dir = new Directory(Paths.document, 'samples');
  if (!dir.exists) dir.create();
  return dir;
}

/**
 * Let the user pick audio files from the device and add them to the library.
 * Native only for now (expo-file-system has no web implementation). Google
 * Drive sync, which will cover web too, lands in a later phase.
 */
export async function importSamplesFromDevice(): Promise<Sample[]> {
  if (Platform.OS === 'web') {
    throw new Error('Sample-Import vom Gerät ist im Web-Build noch nicht verfügbar. Nutze die iOS/Android-App.');
  }
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
    const sample: Sample = { ...parsed, id, name: picked.name, uri: dest.uri, size: picked.size, addedAt: Date.now() };
    await db.putSample(sample);
    samples.push(sample);
  }
  return samples;
}

export function deleteSample(sample: Sample): void {
  if (!sample.uri || Platform.OS === 'web') return;
  try {
    new File(sample.uri).delete();
  } catch {
    /* already gone */
  }
}
