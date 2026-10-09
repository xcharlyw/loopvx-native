import { useSyncExternalStore } from 'react';
import { engine } from '../audio/engine';
import { db } from '../storage/db';
import type { Project, Sample } from '../types';
import { createProject } from './project';

export type View = 'arrange' | 'session';
export type Panel = 'none' | 'library' | 'mixer' | 'projects';

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

export function updateProject(fn: (p: Project) => Project, opts: { reschedule?: boolean } = {}) {
  const project = { ...fn(state.project), updatedAt: Date.now() };
  setState({ project });
  engine.syncMixer(project);
  if (opts.reschedule !== false) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void engine.refresh(getState().project), 120);
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persist(getState().project), 800);
}

async function persist(project: Project) {
  await db.putProject(project);
  await db.setKv('lastProjectId', project.id);
  // Supabase cross-device sync lands in a later phase, like Drive sync.
}

export async function openProject(project: Project) {
  engine.stop();
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
  const project = projects.find((p) => p.id === lastId) ?? projects[0];
  if (project) setState({ project });
  setState({ ready: true, selectedTrackId: getState().project.tracks[0]?.id ?? null });
  engine.syncMixer(getState().project);
}
