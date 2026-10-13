import type { AudioBuffer } from 'react-native-audio-api';
import { engine } from '../audio/engine';
import { parseSampleName } from '../audio/timing';
import { detectTempo, toMono } from '../audio/tempo';
import { download } from './drive';
import { sampleFromDriveFile, type DriveEntry } from './driveImport';
import { placeSample } from './actions';
import { previewSource, storeSampleAudio } from './samples';
import { getState, setSamples } from './store';

// Using Drive samples directly, like a browser in Ableton: audition one (warped to the project tempo, looped, in sync with
// the song) and drop it on a track with one tap. The file is fetched on demand and kept in a small memory cache, so a
// second tap is instant; only "Einfügen" puts it into the library (it has to exist on the device to play).

interface Cached {
  data: ArrayBuffer;
  ext: string;
  buffer?: AudioBuffer;
  /** Tempo from the file name, or detected from the audio. */
  bpm?: number;
  detected?: boolean;
}

const MAX_ENTRIES = 12;
const MAX_BYTES = 120 * 1024 * 1024;
const cache = new Map<string, Cached>(); // insertion order = least recently used first
const loading = new Map<string, Promise<Cached>>();

const extOf = (name: string) => (/\.([a-z0-9]{2,5})$/i.exec(name)?.[1] ?? 'wav').toLowerCase();

function remember(id: string, entry: Cached) {
  cache.delete(id);
  cache.set(id, entry);
  let bytes = 0;
  for (const c of cache.values()) bytes += c.data.byteLength;
  for (const key of cache.keys()) {
    if (cache.size <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
    if (key === id) continue;
    bytes -= cache.get(key)!.data.byteLength;
    cache.delete(key);
  }
}

/** The file's bytes, downloaded once (concurrent calls share the download). */
async function fetchDrive(file: DriveEntry): Promise<Cached> {
  const hit = cache.get(file.id);
  if (hit) {
    remember(file.id, hit);
    return hit;
  }
  const pending = loading.get(file.id);
  if (pending) return pending;
  const p = (async () => {
    const entry: Cached = { data: await download(file.id), ext: extOf(file.name) };
    remember(file.id, entry);
    return entry;
  })();
  loading.set(file.id, p);
  try {
    return await p;
  } finally {
    loading.delete(file.id);
  }
}

export interface PreviewInfo {
  bpm?: number;
  /** The tempo was guessed from the audio (the name had none). */
  detected: boolean;
  /** Played from the library copy, no download. */
  fromLibrary: boolean;
}

/** Audition a Drive file at the project tempo. Resolves once it plays (or is scheduled for the next bar). */
export async function previewDriveFile(file: DriveEntry, folder: string): Promise<PreviewInfo> {
  const projectBpm = getState().project.bpm;
  const own = getState().samples.find((s) => s.driveId === file.id);
  if (own) {
    await engine.preview(own, projectBpm);
    return { bpm: own.bpm, detected: false, fromLibrary: true };
  }
  const c = await fetchDrive(file);
  if (!c.buffer) {
    c.buffer = await engine.decodePreview(await previewSource(file.id, c.data, c.ext));
    c.bpm = parseSampleName(file.name, folder).bpm;
    if (!c.bpm) {
      const channels = Array.from({ length: c.buffer.numberOfChannels }, (_, i) => c.buffer!.getChannelData(i));
      const guess = detectTempo(toMono(channels), c.buffer.sampleRate);
      if (guess && guess.confidence >= (guess.source === 'loop' ? 0.35 : 0.5)) {
        c.bpm = guess.bpm;
        c.detected = true;
      }
    }
  }
  await engine.startPreview(c.buffer, c.bpm, projectBpm);
  return { bpm: c.bpm, detected: !!c.detected, fromLibrary: false };
}

/** Put a Drive file on a track at the playhead: the file becomes a library sample (once) and `placeSample` does the rest. */
export async function insertDriveFile(file: DriveEntry, folder: string): Promise<void> {
  let sample = getState().samples.find((s) => s.driveId === file.id);
  if (!sample) {
    const c = await fetchDrive(file);
    const made = sampleFromDriveFile(file, folder);
    sample = await storeSampleAudio({ ...made, bpm: made.bpm ?? c.bpm }, c.data.slice(0), c.ext);
    setSamples([...getState().samples.filter((x) => x.id !== sample!.id), sample]);
  }
  await placeSample(sample);
}

/** Forget the cached downloads (sign-out, memory pressure). */
export function clearDriveCache() {
  cache.clear();
}
