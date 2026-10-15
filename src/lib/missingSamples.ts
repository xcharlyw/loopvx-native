// Pure planning for "Fehlende Samples laden": which samples have no audio on this device and where each can come from.

export interface MissingSample {
  id: string;
  name: string;
  /** Where to fetch the audio from: the LOOPVX sync copy, the original Drive file of an imported sample, or nowhere yet. */
  from: 'sync' | 'original' | 'none';
  fileId?: string;
}

interface LocalLike {
  id: string;
  name: string;
  driveId?: string;
}

/**
 * `used` = sample ids the open project plays (they count even when the library has no entry for them),
 * `local` = the library, `hasAudio` = ids with stored audio, `remote` = sample id → file id in LOOPVX/Samples.
 * Project samples come first, then the rest of the library.
 */
export function planMissing(used: Iterable<string>, local: LocalLike[], hasAudio: Set<string>, remote: Map<string, { fileId: string; name: string }>): MissingSample[] {
  const byId = new Map(local.map((s) => [s.id, s]));
  const order = [...new Set([...used, ...local.map((s) => s.id)])];
  const out: MissingSample[] = [];
  for (const id of order) {
    if (hasAudio.has(id)) continue;
    const s = byId.get(id);
    const r = remote.get(id);
    const name = s?.name ?? r?.name ?? id;
    if (r) out.push({ id, name, from: 'sync', fileId: r.fileId });
    else if (s?.driveId) out.push({ id, name, from: 'original', fileId: s.driveId });
    else out.push({ id, name, from: 'none' });
  }
  return out;
}
