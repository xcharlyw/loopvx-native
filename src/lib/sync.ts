import { AppState, Platform } from 'react-native';
import { db, onDbChange } from '../storage/db';
import type { Project, Sample, SampleCategory } from '../types';
import { createFile, childrenOf, download, DriveAuthError, driveLinked, folder, forgetDriveToken, trash, updateFile, type DriveFile } from './drive';
import { createProject } from './project';
import { deleteSample, readSampleData, storeSampleAudio } from './samples';
import { errorText, flushSave, getState, openProject, replaceOpenProject, setSamples, setState, toast } from './store';
import { planSync, type RemoteEntry, type SyncMemory } from './syncPlan';

// Two-way sync of projects and samples with a "LOOPVX" folder in the user's Google Drive:
// projects as JSON files, samples as their audio files, metadata in Drive app properties.

const MEMORY_KEY = 'driveSync';
const DEBOUNCE_MS = 8000;

interface StoredMemory {
  projects: { synced: string[]; deleted: string[] };
  samples: { synced: string[]; deleted: string[] };
  lastSyncAt: number;
}

const emptyMemory = (): StoredMemory => ({ projects: { synced: [], deleted: [] }, samples: { synced: [], deleted: [] }, lastSyncAt: 0 });

async function loadMemory(): Promise<StoredMemory> {
  return (await db.getKv<StoredMemory>(MEMORY_KEY)) ?? emptyMemory();
}

const asPlanMemory = (m: StoredMemory, kind: 'projects' | 'samples'): SyncMemory => ({
  synced: new Set(m[kind].synced),
  deleted: new Set(m[kind].deleted),
  lastSyncAt: m.lastSyncAt,
});

// ---------------- metadata <-> Drive app properties ----------------

const cap = (v: string) => v.slice(0, 90); // app property key + value must stay under 124 bytes

function sampleProps(s: Sample): Record<string, string> {
  const props: Record<string, string> = { sid: s.id, updatedAt: String(s.updatedAt ?? s.addedAt), added: String(s.addedAt), cat: s.category };
  if (s.bpm !== undefined) props.bpm = String(s.bpm);
  if (s.key) props.key = cap(s.key);
  if (s.duration !== undefined) props.dur = String(s.duration);
  if (s.folder) props.folder = cap(s.folder);
  return props;
}

function sampleFromFile(f: DriveFile): Sample {
  const p = f.appProperties ?? {};
  const num = (v?: string) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  return {
    id: p.sid,
    name: f.name,
    category: (p.cat as SampleCategory) ?? 'other',
    bpm: num(p.bpm),
    key: p.key || undefined,
    duration: num(p.dur),
    folder: p.folder || undefined,
    addedAt: num(p.added) ?? Date.now(),
    updatedAt: num(p.updatedAt),
  };
}

const extOf = (name: string) => (/\.([a-z0-9]{2,5})$/i.exec(name)?.[1] ?? 'mp3').toLowerCase();
const AUDIO_MIME: Record<string, string> = { wav: 'audio/wav', wave: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aif: 'audio/aiff', aiff: 'audio/aiff', flac: 'audio/flac', ogg: 'audio/ogg' };

const projectFileName = (p: Project) => `${p.name.replace(/[\\/]/g, '-')}.loopvx.json`;
const remoteEntries = (files: DriveFile[], idKey: string): (RemoteEntry & { file: DriveFile })[] =>
  files.filter((f) => f.appProperties?.[idKey]).map((f) => ({ id: f.appProperties![idKey], updatedAt: Number(f.appProperties!.updatedAt) || 0, fileId: f.id, file: f }));

// ---------------- the sync ----------------

let applying = false; // our own database writes must not schedule another sync
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function syncProjects(dir: string, memory: StoredMemory): Promise<string[]> {
  await flushSave();
  const local = await db.getProjects();
  const remote = remoteEntries(await childrenOf(dir), 'pid');
  const plan = planSync(local.map((p) => ({ id: p.id, updatedAt: p.updatedAt })), remote, asPlanMemory(memory, 'projects'));
  const synced = new Set(remote.map((r) => r.id));
  const enc = new TextEncoder();

  for (const { id, fileId } of plan.upload) {
    const project = local.find((p) => p.id === id)!;
    const meta = { name: projectFileName(project), appProperties: { pid: id, updatedAt: String(project.updatedAt) } };
    const data = enc.encode(JSON.stringify(project));
    if (fileId) await updateFile(fileId, meta, data, 'application/json');
    else await createFile({ ...meta, parents: [dir], mimeType: 'application/json' }, data, 'application/json');
    synced.add(id);
  }
  const openId = getState().project.id;
  for (const r of plan.download) {
    const project = JSON.parse(new TextDecoder().decode(await download(r.fileId))) as Project;
    await db.putProject(project);
    if (project.id === openId && project.updatedAt > getState().project.updatedAt) {
      replaceOpenProject(project);
      toast(`„${project.name}“ wurde mit dem Stand aus Google Drive aktualisiert.`);
    }
  }
  for (const r of plan.deleteRemote) {
    await trash(r.fileId);
    synced.delete(r.id);
  }
  for (const id of plan.deleteLocal) {
    await db.deleteProject(id);
    synced.delete(id);
  }
  const saved = (await db.getProjects()).sort((a, b) => b.updatedAt - a.updatedAt);
  if (plan.deleteLocal.includes(openId)) {
    await openProject(saved[0] ?? createProject());
    toast('Das offene Projekt wurde auf einem anderen Gerät gelöscht.');
  } else if (plan.download.length && !saved.some((p) => p.id === openId) && getState().project.tracks.every((t) => !t.clips.length)) {
    // A fresh device shows an empty, never-saved project: open the newest one from Drive instead.
    await openProject(saved[0]);
    toast(`„${saved[0].name}“ aus Google Drive geöffnet.`);
  }
  return [...synced];
}

async function syncSamples(dir: string, memory: StoredMemory): Promise<{ synced: string[]; failed: string[] }> {
  const local = await db.getSamples();
  const remote = remoteEntries(await childrenOf(dir), 'sid');
  const plan = planSync(local.map((s) => ({ id: s.id, updatedAt: s.updatedAt ?? s.addedAt })), remote, asPlanMemory(memory, 'samples'));
  const synced = new Set(remote.map((r) => r.id));
  const failed: string[] = [];

  for (const { id, fileId } of plan.upload) {
    const sample = local.find((s) => s.id === id)!;
    try {
      if (fileId) {
        await updateFile(fileId, { appProperties: sampleProps(sample) }); // audio never changes, only metadata
      } else {
        const data = new Uint8Array(await readSampleData(sample));
        const mime = AUDIO_MIME[extOf(sample.name)] ?? 'application/octet-stream';
        await createFile({ name: sample.name, parents: [dir], mimeType: mime, appProperties: sampleProps(sample) }, data, mime);
      }
      synced.add(id);
    } catch (e) {
      failed.push(sample.name);
      console.warn('sample upload failed', sample.name, e);
    }
  }
  const files = new Map(remote.map((r) => [r.id, r.file]));
  for (const r of plan.download) {
    const meta = sampleFromFile(files.get(r.id)!);
    const existing = local.find((s) => s.id === r.id);
    try {
      if (existing) await db.putSample({ ...existing, ...meta, uri: existing.uri, size: existing.size });
      else await storeSampleAudio(meta, await download(r.fileId), extOf(meta.name));
    } catch (e) {
      failed.push(meta.name);
      console.warn('sample download failed', meta.name, e);
    }
  }
  for (const r of plan.deleteRemote) {
    await trash(r.fileId);
    synced.delete(r.id);
  }
  for (const id of plan.deleteLocal) {
    const sample = local.find((s) => s.id === id);
    if (sample) await deleteSample(sample);
    await db.deleteSample(id);
    synced.delete(id);
  }
  if (plan.download.length || plan.deleteLocal.length) setSamples(await db.getSamples());
  return { synced: [...synced], failed };
}

async function runSync(manual: boolean) {
  if (!(await driveLinked())) {
    setState({ sync: { state: 'off' } });
    return;
  }
  const startedAt = Date.now();
  setState((st) => ({ sync: { ...st.sync, state: 'syncing', error: undefined, needsSignIn: false } }));
  applying = true;
  try {
    const memory = await loadMemory();
    const root = await folder('root', 'LOOPVX');
    const [projectsDir, samplesDir] = await Promise.all([folder('projects', 'Projekte', root), folder('samples', 'Samples', root)]);
    const projects = await syncProjects(projectsDir, memory);
    const samples = await syncSamples(samplesDir, memory);
    // Deletions made while this sync ran stay for the next one.
    const latest = await loadMemory();
    const pending = (kind: 'projects' | 'samples') => latest[kind].deleted.filter((id) => !memory[kind].deleted.includes(id));
    await db.setKv(MEMORY_KEY, {
      projects: { synced: projects, deleted: pending('projects') },
      samples: { synced: samples.synced, deleted: pending('samples') },
      lastSyncAt: startedAt,
    } satisfies StoredMemory);
    setState({ sync: { state: 'idle', lastSyncAt: Date.now() } });
    if (samples.failed.length) toast(`Nicht synchronisiert: ${samples.failed.slice(0, 3).join(', ')}${samples.failed.length > 3 ? ' …' : ''}`, 'error');
  } catch (e) {
    const needsSignIn = e instanceof DriveAuthError;
    if (needsSignIn) forgetDriveToken();
    setState((st) => ({ sync: { ...st.sync, state: 'error', error: errorText(e), needsSignIn } }));
    if (manual) toast(errorText(e), 'error');
  } finally {
    applying = false;
  }
}

/** Sync now (or right after the sync that is already running). */
export function syncNow(opts: { manual?: boolean } = {}): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (running) {
    again = true;
    return running;
  }
  running = runSync(!!opts.manual).finally(() => {
    running = null;
    if (again) {
      again = false;
      scheduleSync(1000);
    }
  });
  return running;
}

export function scheduleSync(delay = DEBOUNCE_MS) {
  if (getState().sync.state === 'off') return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

async function rememberDeleted(kind: 'projects' | 'samples', id: string) {
  const memory = await loadMemory();
  if (!memory[kind].deleted.includes(id)) memory[kind].deleted.push(id);
  await db.setKv(MEMORY_KEY, memory);
}

/**
 * Forget what was synced, e.g. on sign-out: with another Google account the old account's files
 * would look deleted and take the local copies with them.
 */
export async function resetSync() {
  if (timer) clearTimeout(timer);
  timer = null;
  forgetDriveToken();
  await db.setKv(MEMORY_KEY, emptyMemory());
  setState({ sync: { state: 'off' } });
}

let started = false;

/** Sync at start-up, after local changes, and whenever the app comes back to the foreground. */
export function startSync() {
  if (started) return;
  started = true;
  onDbChange((change) => {
    // Writes during a sync are mostly its own; the user's edits in that window get one more pass.
    if (applying) {
      again = true;
      return;
    }
    if (change.deleted) void rememberDeleted(change.kind === 'project' ? 'projects' : 'samples', change.id);
    if (running) again = true;
    else scheduleSync();
  });
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void syncNow();
    });
  } else {
    AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncNow();
    });
  }
  void syncNow();
}
