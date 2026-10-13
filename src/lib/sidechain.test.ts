import type { Project, Track } from '../types';
import { createProject } from './project';
import { pumpHits, sidechainSources } from './sidechain';

const synth = (wave: string) => ({ wave, cutoff: 1, resonance: 1, attack: 0, decay: 0, sustain: 0, release: 0 }) as Track['synth'];
function project(): Project {
  const p = createProject();
  const [a, b, c, d] = p.tracks;
  return {
    ...p,
    tracks: [
      { ...a, id: 'kit', kind: 'midi', synth: synth('kit909'), clips: [{ id: 'k', sampleId: '', start: 4, length: 2, offset: 0, notes: [{ pitch: 36, start: 0, length: 0.1, velocity: 1 }, { pitch: 42, start: 0.125, length: 0.1, velocity: 1 }, { pitch: 36, start: 1.5, length: 0.1, velocity: 1 }, { pitch: 36, start: 2.5, length: 0.1, velocity: 1 }] }] },
      { ...b, id: 'bass', kind: 'midi', synth: synth('sawtooth') },
      { ...c, id: 'kick', kind: 'midi', synth: synth('kick'), clips: [{ id: 'q', sampleId: '', start: 0, length: 1, offset: 0, notes: [{ pitch: 60, start: 0.5, length: 0.1, velocity: 1 }] }] },
      d,
    ],
  };
}

describe('sidechain', () => {
  it('offers drum MIDI tracks as sources, never the track itself', () => {
    expect(sidechainSources(project()).map((t) => t.id)).toEqual(['kit', 'kick']);
    expect(sidechainSources(project(), 'kit').map((t) => t.id)).toEqual(['kick']);
  });
  it('ducks on the kit’s kick pad only, inside the window and the clip', () => {
    expect(pumpHits(project(), 'kit', 0, 16)).toEqual([4, 5.5]); // the hat is skipped, the note past the clip end too
    expect(pumpHits(project(), 'kit', 5, 16)).toEqual([5.5]);
  });
  it('ducks on every note of a single drum instrument', () => {
    expect(pumpHits(project(), 'kick', 0, 4)).toEqual([0.5]);
  });
  it('falls back to every beat without a usable source', () => {
    expect(pumpHits(project(), undefined, 0, 1)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(pumpHits(project(), 'gone', 0, 0.5)).toEqual([0, 0.25]);
  });
});
