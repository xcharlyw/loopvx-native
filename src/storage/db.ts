import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Project, Sample } from '../types';

const SAMPLES_KEY = 'loopvx:samples';
const PROJECTS_KEY = 'loopvx:projects';
const KV_PREFIX = 'loopvx:kv:';

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
  },

  async deleteSample(id: string): Promise<void> {
    const samples = await db.getSamples();
    await AsyncStorage.setItem(SAMPLES_KEY, JSON.stringify(samples.filter((s) => s.id !== id)));
  },

  async deleteProject(id: string): Promise<void> {
    const projects = await db.getProjects();
    await AsyncStorage.setItem(PROJECTS_KEY, JSON.stringify(projects.filter((p) => p.id !== id)));
  },

  async getProjects(): Promise<Project[]> {
    return readJson<Project[]>(PROJECTS_KEY, []);
  },

  async putProject(project: Project): Promise<void> {
    const projects = await db.getProjects();
    const next = [...projects.filter((p) => p.id !== project.id), project];
    await AsyncStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
  },

  async getKv<T>(key: string): Promise<T | undefined> {
    const raw = await AsyncStorage.getItem(KV_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  },

  async setKv(key: string, value: unknown): Promise<void> {
    await AsyncStorage.setItem(KV_PREFIX + key, JSON.stringify(value));
  },
};
