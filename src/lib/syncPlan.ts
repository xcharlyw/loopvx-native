/** One item (project or sample) as known on this device or on Drive. */
export interface SyncEntry {
  id: string;
  updatedAt: number;
}

export interface RemoteEntry extends SyncEntry {
  fileId: string;
}

export interface SyncPlan {
  /** Only here, or newer here: send to Drive (fileId when it already exists there). */
  upload: { id: string; fileId?: string }[];
  /** Only on Drive, or newer there: take over on this device. */
  download: RemoteEntry[];
  /** Deleted on this device since the last sync: delete on Drive too. */
  deleteRemote: RemoteEntry[];
  /** Deleted on another device: delete here too. */
  deleteLocal: string[];
}

export interface SyncMemory {
  /** Ids that were on Drive after the last successful sync. */
  synced: Set<string>;
  /** Ids deleted on this device since then. */
  deleted: Set<string>;
  /** When the last successful sync finished (ms). */
  lastSyncAt: number;
}

/**
 * Two-way merge, newest wins. Deletions travel through `memory`: something that was on Drive at
 * the last sync and is gone now was deleted elsewhere, unless it was edited here since.
 */
export function planSync(local: SyncEntry[], remote: RemoteEntry[], memory: SyncMemory): SyncPlan {
  const plan: SyncPlan = { upload: [], download: [], deleteRemote: [], deleteLocal: [] };
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const localIds = new Set(local.map((l) => l.id));

  for (const l of local) {
    const r = remoteById.get(l.id);
    if (r) {
      if (l.updatedAt > r.updatedAt) plan.upload.push({ id: l.id, fileId: r.fileId });
      else if (r.updatedAt > l.updatedAt) plan.download.push(r);
    } else if (memory.synced.has(l.id) && l.updatedAt <= memory.lastSyncAt) {
      plan.deleteLocal.push(l.id);
    } else {
      plan.upload.push({ id: l.id });
    }
  }
  for (const r of remote) {
    if (localIds.has(r.id)) continue;
    if (memory.deleted.has(r.id)) plan.deleteRemote.push(r);
    else plan.download.push(r);
  }
  return plan;
}
