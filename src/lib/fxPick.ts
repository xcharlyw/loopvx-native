import { parseSampleName } from '../audio/timing';
import { isKeyWord, type FxHit } from './arranger';
import { isAudio, type DriveEntry } from './driveImport';
import { keyPitch } from './libraryFilter';
import { niceKey, type SpliceResult } from './spliceResults';

const plain = (v: string) => v.toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^a-z0-9äöüß]+/g, ' ').trim();
const MIDI = /\.(mid|midi)$/i;

/** The Drive file that fits a plan's effect best, or undefined. Words must match (the first counts most); a file in another key is out. */
export function pickDriveFile(files: DriveEntry[], hit: Pick<FxHit, 'search' | 'key' | 'length'>, bpm: number): DriveEntry | undefined {
  const words = (hit.search ?? []).map(plain).filter((w) => w && !isKeyWord(w));
  if (!words.length) return undefined;
  const wanted = keyPitch(hit.key);
  const scored = files
    .filter((f) => isAudio(f) && !MIDI.test(f.name) && !/midi/i.test(f.mimeType ?? ''))
    .map((f) => {
      const tokens = plain(f.name).split(' ');
      const has = (w: string) => tokens.some((t) => t === w || (w.length >= 4 && t.startsWith(w)));
      let score = words.reduce((n, w, i) => n + (has(w) ? (i === 0 ? 3 : 1) : 0), 0);
      if (!score) return { f, score: 0 };
      const parsed = parseSampleName(f.name);
      const have = wanted ? keyPitch(parsed.key) : null;
      if (wanted && have && (have.root !== wanted.root || (have.mode && wanted.mode && have.mode !== wanted.mode))) return { f, score: 0 };
      if (wanted && have) score += 2;
      if (parsed.bpm && Math.abs(parsed.bpm - bpm) <= 8) score += 1;
      // A long request ("loop 32 bars") wants a loop, not a one-shot: loops by name and bigger files win.
      if ((hit.length ?? 0) >= 8) score += (/loop/i.test(f.name) ? 1 : 0) + Math.min(1, (Number(f.size) || 0) / 2_000_000);
      return { f, score };
    })
    .filter((e) => e.score >= 1)
    .sort((a, b) => b.score - a.score || a.f.name.localeCompare(b.f.name));
  return scored[0]?.f;
}


/** The Splice sound that fits best: the words must match name or tags (the first counts most), a known other key is out, tempo near the project's wins. */
export function pickSpliceResult(results: SpliceResult[], hit: Pick<FxHit, 'search' | 'key' | 'length'>, bpm: number): SpliceResult | undefined {
  const words = (hit.search ?? []).map(plain).filter((w) => w && !isKeyWord(w));
  if (!words.length) return undefined;
  const wanted = keyPitch(hit.key);
  const scored = results
    .map((r) => {
      const tokens = plain(`${r.name} ${r.tags.join(' ')}`).split(' ');
      const has = (w: string) => tokens.some((t) => t === w || (w.length >= 4 && t.startsWith(w)));
      let score = words.reduce((n, w, i) => n + (has(w) ? (i === 0 ? 3 : 1) : 0), 0);
      if (!score) return { r, score: 0 };
      const have = wanted ? keyPitch(niceKey(r.key)) : null;
      if (wanted && have && (have.root !== wanted.root || (have.mode && wanted.mode && have.mode !== wanted.mode))) return { r, score: 0 };
      if (wanted && have) score += 2;
      if (r.bpm && Math.abs(r.bpm - bpm) <= 8) score += 1;
      if ((hit.length ?? 0) >= 8 && r.type === 'loop') score += 1;
      return { r, score };
    })
    .filter((e) => e.score >= 1)
    .sort((a, b) => b.score - a.score || a.r.name.localeCompare(b.r.name));
  return scored[0]?.r;
}
