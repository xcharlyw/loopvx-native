import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Project, Sample } from '../types';

const SAMPLES_KEY = 'loopvx:samples';
const PROJECTS_KEY = 'loopvx:projects';
const KV_PREFIX = 'loopvx:kv:';

export interface DbChange {
  kind: 'project' | 'sample';
  id: string;
  deleted?: boolean;
}

const changeListeners = new Set<(change: DbChange) => void>();

/** Every write to projects or samples, wherever it comes from (used to trigger Drive sync). */
export function onDbChange(fn: (change: DbChange) => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

const emit = (change: DbChange) => changeListeners.forEach((l) => l(change));

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : fallback;
}

/** Local persistence (AsyncStorage) for samples and projects. Mirrors the web app's IndexedDB `db`. */
export const db = {
  async getSamples(): Promise<Sample[]> {
    return readJson<Sample[]>(SAMPLES_KEY, []);
  },

  async putSample(sample: Sample): Promise<void> {
    const samples = await db.getSamples();
    const next = [...samples.filter((s) => s.id !== sample.id), sample];
    await AsyncStorage.setItem(SAMPLES_KEY, JSON.stringify(next));
    emit({ kind: 'sample', id: sample.id });
  },

  async deleteSample(id: string): Promise<void> {
    const samples = await db.getSamples();
    await AsyncStorage.setItem(SAMPLES_KEY, JSON.stringify(samples.filter((s) => s.id !== id)));
    emit({ kind: 'sample', id, deleted: true });
  },

  async deleteProject(id: string): Promise<void> {
    const projects = await db.getProjects();
    await AsyncStorage.setItem(PROJECTS_KEY, JSON.stringify(projects.filter((p) => p.id !== id)));
    emit({ kind: 'project', id, deleted: true });
  },

  async getProjects(): Promise<Project[]> {
    return readJson<Project[]>(PROJECTS_KEY, []);
  },

  async putProject(project: Project): Promise<void> {
    const projects = await db.getProjects();
    const next = [...projects.filter((p) => p.id !== project.id), project];
    await AsyncStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
    emit({ kind: 'project', id: project.id });
  },

  async getKv<T>(key: string): Promise<T | undefined> {
    const raw = await AsyncStorage.getItem(KV_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  },

  async setKv(key: string, value: unknown): Promise<void> {
    await AsyncStorage.setItem(KV_PREFIX + key, JSON.stringify(value));
  },
};
