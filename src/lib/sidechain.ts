import { beatsInWindow } from '../audio/timing';
import type { Project, Track } from '../types';
import { trackKind, trackSynth } from './project';

// Where the pump ducks: on every beat (classic), or on the real kick hits of another track (sidechain).

/** Tracks that can trigger a sidechain: MIDI tracks with a drum instrument (the 909 kit, the synth kick, a sample). */
export function sidechainSources(project: Project, except?: string): Track[] {
  return project.tracks.filter((t) => t.id !== except && trackKind(t) === 'midi' && ['kit909', 'kick', 'sample'].includes(trackSynth(t).wave));
}

/** Bars in [fromBar, toBar) where the pump ducks: the source track's kick hits, or every beat without a usable source. */
export function pumpHits(project: Project, sourceId: string | undefined, fromBar: number, toBar: number): number[] {
  const source = sourceId ? project.tracks.find((t) => t.id === sourceId) : undefined;
  if (!source || trackKind(source) !== 'midi') return beatsInWindow(fromBar, toBar).map((b) => b.bar);
  // The 909 kit: only its kick pad (C1); a single drum instrument: every note.
  const kitOnly = trackSynth(source).wave === 'kit909';
  const hits = new Set<number>();
  for (const clip of source.clips) {
    for (const n of clip.notes ?? []) {
      if (kitOnly && n.pitch !== 36) continue;
      if (n.start >= clip.length - 1e-9) continue;
      const bar = clip.start + n.start;
      if (bar >= fromBar - 1e-9 && bar < toBar - 1e-9) hits.add(Math.round(bar * 1e6) / 1e6);
    }
  }
  return [...hits].sort((a, b) => a - b);
}
