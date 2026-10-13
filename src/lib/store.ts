import { useSyncExternalStore } from 'react';
import { engine } from '../audio/engine';
import { db } from '../storage/db';
import type { Project, Sample } from '../types';
import { History } from './history';
import { createProject, isProject, repairProject } from './project';

export type View = 'arrange' | 'session';
/** Size of the open panel: full, half (docked below, the arrangement stays usable) or only its title bar. */
export type SheetSize = 'full' | 'half' | 'bar';
export type Panel = 'none' | 'library' | 'mixer' | 'projects' | 'clip' | 'track' | 'export' | 'piano' | 'instrument' | 'devices' | 'automation' | 'arranger' | 'markers' | 'shortcuts' | 'menu';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export interface SyncStatus {
  /** off: not signed in with Drive access. */
  state: 'off' | 'idle' | 'syncing' | 'error';
  lastSyncAt?: number;
  error?: string;
  /** The error needs a new Google sign-in (Drive access revoked or expired). */
  needsSignIn?: boolean;
}

export interface AppState {
  project: Project;
  samples: Sample[];
  /** Empty library folders the user made (folders that hold samples need no entry). */
  folders: string[];
  view: View;
  panel: Panel;
  sheetSize: SheetSize;
  /** Wide screens: the Library as Live's browser column on the left (independent of the open panel). */
  browserOpen: boolean;
  selectedTrackId: string | null;
  selectedClipId: string | null;
  /** More clips selected together with `selectedClipId` (multi-selection: Shift/Cmd/Ctrl-click, or the multi-select mode on touch). */
  extraClipIds: string[];
  /** The primary clip the extras were selected with: they count only while it is still the primary one. */
  extraHead: string | null;
  /** Taps on clips add to / remove from the selection instead of replacing it. */
  multiSelect: boolean;
  /** Ableton's automation mode (A): every track shows a curve over its clips, and touches edit the curve instead of the clips. */
  autoMode: boolean;
  /** Ableton's draw mode (B): a drag over an automation curve draws the line freehand instead of moving points. */
  drawMode: boolean;
  /** What the device panel shows: the selected track's chain or the master bus. */
  devicesFor: 'track' | 'master';
  /** Playhead when stopped (bars). */
  cursor: number;
  /** Timeline zoom: pixels per bar. */
  zoom: number;
  /** Library sample armed for placing into the session grid. */
  armedSampleId: string | null;
  toasts: Toast[];
  ready: boolean;
  canUndo: boolean;
  canRedo: boolean;
  sync: SyncStatus;
  /** Metronome during playback (a per-device preference, not part of the project). */
  metronome: boolean;
}

let state: AppState = {
  project: createProject(),
  samples: [],
  folders: [],
  view: 'arrange',
  panel: 'none',
  sheetSize: 'full',
  browserOpen: false,
  selectedTrackId: null,
  selectedClipId: null,
  extraClipIds: [],
  extraHead: null,
  multiSelect: false,
  autoMode: false,
  drawMode: false,
  devicesFor: 'track',
  cursor: 0,
  zoom: 56,
  armedSampleId: null,
  toasts: [],
  ready: false,
  canUndo: false,
  canRedo: false,
  sync: { state: 'off' },
  metronome: false,
};

const listeners = new Set<() => void>();

/** Every selected clip id: the primary one plus the extras (none when nothing is selected). */
export function selectedClipIds(s: Pick<AppState, 'selectedClipId' | 'extraClipIds' | 'extraHead'> = state): string[] {
  if (!s.selectedClipId) return [];
  const extras = s.extraHead === s.selectedClipId ? s.extraClipIds : [];
  return [s.selectedClipId, ...extras.filter((id) => id !== s.selectedClipId)];
}

/** Select `primary` and, with it, `extras` (a multi-selection). */
export function setClipSelection(primary: string | null, extras: string[] = []) {
  setState({ selectedClipId: primary, extraClipIds: extras, extraHead: primary });
}

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
  );
}

// ---------------- project updates + autosave ----------------

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** What undo restores: the project plus the sample tempos and warp modes (warping is stored on the sample). */
interface Snapshot {
  project: Project;
  samples: Sample[];
}

const history = new History<Snapshot>();

function syncHistory() {
  setState({ canUndo: history.canUndo, canRedo: history.canRedo });
}

function commit(project: Project, reschedule: boolean) {
  setState({ project });
  engine.syncMixer(project);
  if (reschedule) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void engine.refresh(getState().project), 120);
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persist(getState().project), 800);
}

/** Remember the current state as an undo step. Call before changing something that is not a project update. */
export function recordHistory(opts: { continuous?: boolean } = {}) {
  history.record({ project: state.project, samples: state.samples }, opts);
  syncHistory();
}

/** Drop the undo step recorded by `recordHistory` (the gesture it was for changed nothing in the end). */
export function discardLastHistory() {
  history.discardLast();
  syncHistory();
}

/**
 * The one way to change the project. Changes with reschedule:false (faders, names, mute/solo, tempo)
 * come in bursts and merge into one undo step per burst; `merge` does the same for a burst that
 * must also be heard right away (a clip gain fader).
 */
export function updateProject(fn: (p: Project) => Project, opts: { reschedule?: boolean; merge?: boolean; record?: boolean } = {}) {
  const before = state.project;
  const changed = fn(before);
  // `record: false`: the caller already recorded the undo step (a drag records once, however long it takes).
  if (changed !== before && opts.record !== false) {
    history.record({ project: before, samples: state.samples }, { continuous: opts.merge ?? opts.reschedule === false });
  }
  commit({ ...changed, updatedAt: Date.now() }, opts.reschedule !== false);
  syncHistory();
}

function restore(entry: Snapshot) {
  for (const old of entry.samples) {
    const current = state.samples.find((x) => x.id === old.id);
    if (current && (current.bpm !== old.bpm || current.warp !== old.warp)) void upsertSample({ ...current, bpm: old.bpm, warp: old.warp });
  }
  const { project } = entry;
  const clipIds = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  const selectedClipId = state.selectedClipId && clipIds.has(state.selectedClipId) ? state.selectedClipId : null;
  const hasTrack = project.tracks.some((t) => t.id === state.selectedTrackId);
  setState({ selectedClipId, selectedTrackId: hasTrack ? state.selectedTrackId : (project.tracks[0]?.id ?? null) });
  commit({ ...project, updatedAt: Date.now() }, true);
  syncHistory();
}

export function undo() {
  const entry = history.undo({ project: state.project, samples: state.samples });
  if (entry) restore(entry);
}

export function redo() {
  const entry = history.redo({ project: state.project, samples: state.samples });
  if (entry) restore(entry);
}

async function persist(project: Project) {
  await db.putProject(project);
  await db.setKv('lastProjectId', project.id);
}

/** Write a pending autosave right away (before a sync reads the saved projects). */
export async function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await persist(state.project);
}

/**
 * Swap in a newer copy of the open project (synced from another device) without closing panels.
 * Undo steps belonged to the old copy, so they go.
 */
export function replaceOpenProject(loaded: Project) {
  const project = repairProject(loaded);
  history.clear();
  syncHistory();
  const clipIds = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  const hasTrack = project.tracks.some((t) => t.id === state.selectedTrackId);
  setState({
    project,
    selectedClipId: state.selectedClipId && clipIds.has(state.selectedClipId) ? state.selectedClipId : null,
    selectedTrackId: hasTrack ? state.selectedTrackId : (project.tracks[0]?.id ?? null),
  });
  engine.syncMixer(project);
  void engine.refresh(project);
}

export async function openProject(loaded: Project) {
  const project = repairProject(loaded);
  engine.stop();
  history.clear();
  syncHistory();
  setState({ project, selectedClipId: null, selectedTrackId: project.tracks[0]?.id ?? null, cursor: 0, panel: 'none' });
  engine.syncMixer(project);
  await db.setKv('lastProjectId', project.id);
}

// ---------------- samples ----------------

export function setSamples(samples: Sample[]) {
  engine.setSamples(samples);
  setState({ samples });
}

/** Save a sample's metadata. `touch: false` for facts that are the same on every device (duration). */
export async function upsertSample(sample: Sample, opts: { touch?: boolean } = {}): Promise<void> {
  const next = opts.touch === false ? sample : { ...sample, updatedAt: Date.now() };
  await db.putSample(next);
  const others = state.samples.filter((s) => s.id !== next.id);
  setSamples([...others, next]);
}

/** Several samples changed at once (e.g. moved to another folder): one storage write, one state update. */
export async function upsertSamples(changed: Sample[]): Promise<void> {
  if (!changed.length) return;
  const now = Date.now();
  const next = changed.map((s) => ({ ...s, updatedAt: now }));
  await db.putSamples(next);
  const ids = new Set(next.map((s) => s.id));
  setSamples([...state.samples.filter((s) => !ids.has(s.id)), ...next]);
}

/** Removes samples for good: their audio, their library entry and (via the sync) their copy in Drive. */
export async function removeSamples(list: Sample[], deleteAudio: (s: Sample) => Promise<void>): Promise<void> {
  if (!list.length) return;
  for (const s of list) await deleteAudio(s).catch((e) => console.warn('could not delete audio', s.name, e));
  await db.deleteSamples(list.map((s) => s.id));
  const gone = new Set(list.map((s) => s.id));
  setSamples(state.samples.filter((s) => !gone.has(s.id)));
}

/** The user's empty library folders. */
export function setFolders(folders: string[]) {
  setState({ folders });
  void db.setKv('folders', folders);
}

engine.onDuration = (id, duration) => {
  const s = state.samples.find((x) => x.id === id);
  if (s) void upsertSample({ ...s, duration }, { touch: false });
};

// ---------------- metronome ----------------

export function setMetronome(on: boolean) {
  engine.setMetronome(on);
  setState({ metronome: on });
  void db.setKv('metronome', on);
}

// ---------------- toasts ----------------

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 3000);
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------- boot ----------------

/** Stored as the last project id to make the next start open a fresh project (error screen escape). */
export const START_BLANK = '__start-blank__';

export async function boot() {
  const [samples, projects, lastId, metronome, folders] = await Promise.all([
    db.getSamples(),
    db.getProjects(),
    db.getKv<string>('lastProjectId'),
    db.getKv<boolean>('metronome'),
    db.getKv<string[]>('folders'),
  ]);
  if (Array.isArray(folders)) setState({ folders });
  if (metronome) setMetronome(true);
  setSamples(samples);
  // Damaged entries (never written by this app, but storage can be edited) are skipped, not fatal.
  const valid = projects.filter(isProject);
  if (valid.length < projects.length) toast(`${projects.length - valid.length} beschädigte(s) Projekt(e) übersprungen.`, 'error');
  const last = lastId === START_BLANK ? undefined : (valid.find((p) => p.id === lastId) ?? valid[0]);
  if (last) setState({ project: repairProject(last) });
  setState({ ready: true, selectedTrackId: getState().project.tracks[0]?.id ?? null });
  engine.syncMixer(getState().project);
}
