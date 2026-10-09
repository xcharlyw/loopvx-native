import { useSyncExternalStore } from 'react';
import { engine } from '../audio/engine';
import { db } from '../storage/db';
import type { Project, Sample } from '../types';
import { History } from './history';
import { createProject, repairProject } from './project';

export type View = 'arrange' | 'session';
export type Panel = 'none' | 'library' | 'mixer' | 'projects' | 'clip' | 'track';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export interface AppState {
  project: Project;
  samples: Sample[];
  view: View;
  panel: Panel;
  selectedTrackId: string | null;
  selectedClipId: string | null;
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
}

let state: AppState = {
  project: createProject(),
  samples: [],
  view: 'arrange',
  panel: 'none',
  selectedTrackId: null,
  selectedClipId: null,
  cursor: 0,
  zoom: 56,
  armedSampleId: null,
  toasts: [],
  ready: false,
  canUndo: false,
  canRedo: false,
};

const listeners = new Set<() => void>();

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

/** What undo restores: the project plus the sample tempos (clip warping is stored on the sample). */
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

export function updateProject(fn: (p: Project) => Project, opts: { reschedule?: boolean } = {}) {
  const before = state.project;
  const changed = fn(before);
  // Changes with reschedule:false (faders, names, mute/solo, tempo) come in bursts: one undo step per burst.
  if (changed !== before) {
    history.record({ project: before, samples: state.samples }, { continuous: opts.reschedule === false });
  }
  commit({ ...changed, updatedAt: Date.now() }, opts.reschedule !== false);
  syncHistory();
}

function restore(entry: Snapshot) {
  for (const old of entry.samples) {
    const current = state.samples.find((x) => x.id === old.id);
    if (current && current.bpm !== old.bpm) void upsertSample({ ...current, bpm: old.bpm });
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
  // Supabase cross-device sync lands in a later phase, like Drive sync.
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

export async function upsertSample(sample: Sample): Promise<void> {
  await db.putSample(sample);
  const others = state.samples.filter((s) => s.id !== sample.id);
  setSamples([...others, sample]);
}

engine.onDuration = (id, duration) => {
  const s = state.samples.find((x) => x.id === id);
  if (s) void upsertSample({ ...s, duration });
};

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

export async function boot() {
  const [samples, projects, lastId] = await Promise.all([db.getSamples(), db.getProjects(), db.getKv<string>('lastProjectId')]);
  setSamples(samples);
  const last = projects.find((p) => p.id === lastId) ?? projects[0];
  if (last) setState({ project: repairProject(last) });
  setState({ ready: true, selectedTrackId: getState().project.tracks[0]?.id ?? null });
  engine.syncMixer(getState().project);
}
