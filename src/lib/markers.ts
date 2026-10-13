import type { Marker, Project } from '../types';
import { uid } from './project';

// Markers (Ableton's locators): named positions in the arrangement, e.g. "Drop 1". Pure, so tested.

const sorted = (list: Marker[]) => [...list].sort((a, b) => a.bar - b.bar);

/** A marker at `bar` (whole beats); one already there is renamed instead of doubled. */
export function addMarker(project: Project, bar: number, name?: string): Project {
  const at = Math.max(0, Math.round(bar * 4) / 4);
  const list = project.markers ?? [];
  const existing = list.find((m) => Math.abs(m.bar - at) < 1e-6);
  if (existing) return name ? renameMarker(project, existing.id, name) : project;
  return { ...project, markers: sorted([...list, { id: uid(), bar: at, name: name ?? `Marker ${list.length + 1}` }]) };
}

export function renameMarker(project: Project, id: string, name: string): Project {
  return { ...project, markers: (project.markers ?? []).map((m) => (m.id === id ? { ...m, name: name.trim().slice(0, 32) || m.name } : m)) };
}

export function moveMarker(project: Project, id: string, bar: number): Project {
  return { ...project, markers: sorted((project.markers ?? []).map((m) => (m.id === id ? { ...m, bar: Math.max(0, Math.round(bar * 4) / 4) } : m))) };
}

export function removeMarker(project: Project, id: string): Project {
  const markers = (project.markers ?? []).filter((m) => m.id !== id);
  return { ...project, markers: markers.length ? markers : undefined };
}

/** The marker after / before `bar` (for jumping), or undefined. */
export function nextMarker(project: Project, bar: number, dir: 1 | -1): Marker | undefined {
  const list = sorted(project.markers ?? []);
  return dir > 0 ? list.find((m) => m.bar > bar + 1e-6) : [...list].reverse().find((m) => m.bar < bar - 1e-6);
}

/** Replace all markers at once (the arranger names its sections). */
export const withMarkers = (project: Project, list: { bar: number; name: string }[]): Project => ({ ...project, markers: list.length ? sorted(list.map((m) => ({ id: uid(), ...m }))) : undefined });
