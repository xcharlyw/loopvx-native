import { engine } from '../../audio/engine';
import { trackFx } from '../../audio/fx';
import { mapTrack, trackSynth } from '../../lib/project';
import { updateProject, useStore } from '../../lib/store';
import type { ModSlot, OscWave, SynthSettings, TrackFx } from '../../types';

/** The selected track's instrument and the edit functions every instrument panel (synth, sampler, drums) shares: a knob drag is one undo step. */
export function useInstrument() {
  const track = useStore((st) => st.project.tracks.find((t) => t.id === st.selectedTrackId));
  const samples = useStore((st) => st.samples);
  const trackId = track?.id ?? '';
  const synth = track ? trackSynth(track) : undefined;
  const set = (patch: Partial<SynthSettings>) => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, synth: { ...trackSynth(t), ...patch } })), { merge: true });
  const setB = (patch: Partial<NonNullable<SynthSettings['oscB']>>) => set({ oscB: { ...(synth?.oscB ?? { wave: 'sawtooth' as OscWave, octave: 0, detune: 0, level: 0.7 }), ...patch } });
  const setMods = (mods: ModSlot[]) => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, synth: { ...trackSynth(t), mods: mods.length ? mods : undefined } })));
  const setMod = (i: number, patch: Partial<ModSlot>) => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, synth: { ...trackSynth(t), mods: (trackSynth(t).mods ?? []).map((m, j) => (j === i ? { ...m, ...patch } : m)) } })), { merge: true });
  const setFx = (patch: TrackFx) => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, fx: { ...t.fx, ...patch } })), { reschedule: false });
  const hear = (sy: SynthSettings, pitch: number) => void engine.previewNote(sy, pitch);
  return { track, samples, trackId, synth, fx: track ? trackFx(track.fx) : undefined, set, setB, setMods, setMod, setFx, hear };
}
