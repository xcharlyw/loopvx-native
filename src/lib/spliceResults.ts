import { parseSampleName } from '../audio/timing';
import type { Sample } from '../types';

// What Splice's search tool answers with is Markdown text: one block per sound. This turns it into data and a
// library entry. Pure, so it is tested with a real answer.

export interface SpliceResult {
  uuid: string;
  name: string;
  type?: 'loop' | 'oneshot';
  bpm?: number;
  key?: string;
  duration?: number;
  pack?: string;
  tags: string[];
  link?: string;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Every sound in a search answer, in the order Splice listed them. Blocks without an asset id are dropped (nothing to download). */
export function parseSearchResults(markdown: string): SpliceResult[] {
  const results: SpliceResult[] = [];
  for (const block of markdown.split(/^### /m).slice(1)) {
    const lines = block.split(/\r?\n/);
    const name = lines[0].replace(/^\d+\.\s*/, '').trim();
    const field = (label: string) => new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, 'i').exec(block)?.[1].trim();
    const uuid = UUID.exec(field('Asset UUID') ?? '')?.[0];
    if (!uuid || !name) continue;
    const facts = lines.find((l) => /^\s*BPM:/i.test(l) || /\bDuration:/i.test(l)) ?? '';
    const fact = (label: string) => new RegExp(`${label}:\\s*([^|]+)`, 'i').exec(facts)?.[1].trim();
    const num = (v?: string) => {
      const n = Number.parseFloat(v ?? '');
      return Number.isFinite(n) ? n : undefined;
    };
    const type = fact('Type')?.toLowerCase();
    results.push({
      uuid,
      name,
      type: type === 'loop' ? 'loop' : type?.replace(/[^a-z]/g, '') === 'oneshot' ? 'oneshot' : undefined,
      bpm: num(fact('BPM')),
      key: fact('Key') || undefined,
      duration: num(fact('Duration')),
      pack: field('Pack'),
      tags: (field('Tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      link: field('Link'),
    });
  }
  return results;
}

export const spliceSampleId = (uuid: string) => `splice:${uuid}`;

/** "c#" -> "C#", "f minor" -> "F minor"; Splice writes keys in lower case, sometimes with the mode. */
export function niceKey(key?: string): string | undefined {
  const m = /^([a-g])([#b]?)\s*(minor|major|min|maj)?$/i.exec(key?.trim() ?? '');
  if (!m) return undefined;
  const note = m[1].toUpperCase() + m[2].replace('b', 'b');
  const mode = m[3] ? (m[3].toLowerCase().startsWith('maj') ? 'major' : 'minor') : '';
  return mode ? `${note} ${mode}` : note;
}

const SAFE = (name: string) => name.replace(/[^\w\s+.#-]/g, ' ').replace(/\s+/g, ' ').trim();

/** The library entry for a Splice sound; tempo and key come from Splice, the category from the name and the tags. */
export function sampleFromSplice(r: SpliceResult, ext: string, now = Date.now()): Sample {
  const base = SAFE(r.name).replace(/\.[a-z0-9]{2,5}$/i, '') || 'Splice';
  const name = `${base}.${ext}`;
  const parsed = parseSampleName(name, `Splice ${r.tags.join(' ')}`);
  return {
    ...parsed,
    id: spliceSampleId(r.uuid),
    name,
    spliceId: r.uuid,
    folder: r.pack ? `Splice/${SAFE(r.pack)}` : 'Splice',
    bpm: r.type === 'oneshot' ? undefined : (r.bpm ?? parsed.bpm),
    key: niceKey(r.key) ?? parsed.key,
    duration: r.duration,
    addedAt: now,
  };
}
