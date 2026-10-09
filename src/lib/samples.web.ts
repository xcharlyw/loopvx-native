import * as DocumentPicker from 'expo-document-picker';
import { parseSampleName } from '../audio/timing';
import { db } from '../storage/db';
import type { Sample } from '../types';
import { uid } from './project';

// Web implementation: audio blobs live in IndexedDB (like the original web app),
// metadata in AsyncStorage (localStorage) via `db`.

const DB_NAME = 'loopvx-audio';
const STORE = 'blobs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const idb = await openDb();
  return new Promise((resolve, reject) => {
    const req = run(idb.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function importSamplesFromDevice(): Promise<Sample[]> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, base64: false });
  if (result.canceled) return [];
  const samples: Sample[] = [];
  for (const picked of result.assets) {
    const blob: Blob = picked.file ?? (await (await fetch(picked.uri)).blob());
    const id = `local:${uid()}`;
    await tx('readwrite', (st) => st.put(blob, id));
    const sample: Sample = { ...parseSampleName(picked.name), id, name: picked.name, folder: 'Uploads', size: picked.size, addedAt: Date.now() };
    await db.putSample(sample);
    samples.push(sample);
  }
  return samples;
}

/** What the audio engine decodes: the web AudioContext only takes an ArrayBuffer. */
export async function sampleSource(sample: Sample): Promise<string | ArrayBuffer> {
  const blob = await tx<Blob | undefined>('readonly', (st) => st.get(sample.id));
  if (!blob) throw new Error(`Audio für "${sample.name}" nicht gefunden`);
  return blob.arrayBuffer();
}

export async function deleteSample(sample: Sample): Promise<void> {
  await tx('readwrite', (st) => st.delete(sample.id));
}
