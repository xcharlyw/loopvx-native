import { engine } from '../audio/engine';
import { secondsPerBar } from '../audio/timing';
import { beginNoteTake, endNoteTake, midiConnected } from './midiControl';
import { placeMidiTake } from './midiIn';
import { sampleLengthBars } from '../audio/timing';
import { encodeWav } from '../audio/wav';
import type { Sample } from '../types';
import { recordingSupported, startRecording } from './recording';
import { clock, takeName } from './recordingMath';
import type { Recorder } from './recordingTypes';
import { storeSampleAudio } from './samples';
import { errorText, getState, setSamples, setState, toast, updateProject } from './store';
import { placeTake, recordTarget, recordingTrack, trimTake } from './takes';
import { trackKind, uid } from './project';

/** The running take: the recorder and where it lines up with the transport (audio clock seconds); a MIDI take has no recorder, the notes come from midiControl. */
let active:
  | { kind: 'audio'; rec: Recorder; recordStarted: number; barStart: number; startBar: number; trackId: string | null; timer: ReturnType<typeof setTimeout> | null }
  | { kind: 'midi'; startBar: number; trackId: string; timer: ReturnType<typeof setTimeout> | null }
  | null = null;

/**
 * Record the microphone onto the selected audio track (or the vocals track, or a new one) from the playhead, in time with the
 * project: the other tracks play, a count-in of 0-2 bars clicks first and the take is cut to the bar grid. Tap again to stop.
 */
export async function startTrackRecording() {
  const state = getState();
  if (state.recording || active) return;
  if (state.view !== 'arrange') return toast('Aufnehmen geht in der Arrangement-Ansicht.');
  if (!recordingSupported()) return toast('Dieser Browser kann nicht aufnehmen.', 'error');
  const { project, cursor, recSettings, selectedTrackId } = state;
  const startBar = Math.max(0, Math.floor(cursor));
  const selected = project.tracks.find((t) => t.id === selectedTrackId);
  if (selected && trackKind(selected) === 'midi') return startMidiTake(selected.id, selected.name, startBar);
  const { trackId } = recordTarget(project, selectedTrackId);
  let rec: Recorder | null = null;
  try {
    // The audio context may only start inside this tap; the microphone prompt comes after it.
    await engine.unlock();
    rec = await startRecording();
    const recordStarted = engine.contextTime();
    const barStart = await engine.play(project, startBar, { countIn: recSettings.countIn, recording: true });
    const wait = Math.max(0, (barStart - engine.contextTime()) * 1000);
    active = { kind: 'audio', rec, recordStarted, barStart, startBar, trackId, timer: null };
    setState({ recording: { phase: recSettings.countIn > 0 ? 'count' : 'rec', trackId, startBar, startedAt: Date.now() } });
    if (recSettings.countIn > 0) active.timer = countInTimer(wait);
    const name = trackId ? project.tracks.find((t) => t.id === trackId)?.name : undefined;
    toast(`Aufnahme ab Takt ${startBar + 1} auf ${name ? `„${name}“` : 'einer neuen Spur'}${recSettings.countIn ? `, erst ${recSettings.countIn} Takt${recSettings.countIn > 1 ? 'e' : ''} Einzähler` : ''}.`);
  } catch (e) {
    rec?.cancel();
    engine.stop();
    active = null;
    setState({ recording: null });
    toast(errorText(e), 'error');
  }
}

/** After `wait` ms the count-in is over: the button turns from "counting" to "recording". */
const countInTimer = (wait: number) =>
  setTimeout(() => {
    const r = getState().recording;
    if (r?.phase === 'count') setState({ recording: { ...r, phase: 'rec', startedAt: Date.now() } });
  }, wait);

/** Record the notes played on a MIDI controller into the selected MIDI track: the same count-in and transport as an audio take. */
async function startMidiTake(trackId: string, name: string, startBar: number) {
  const { project, recSettings } = getState();
  if (!midiConnected()) return toast('Kein MIDI-Gerät verbunden. Schalte unter „MIDI-Controller …“ im Menü (Optionen) den Eingang ein; das geht in Chrome am PC oder auf Android.', 'error');
  try {
    await engine.unlock();
    const barStart = await engine.play(project, startBar, { countIn: recSettings.countIn, recording: true });
    beginNoteTake(trackId, startBar, barStart, recSettings.latencyMs / 1000 / secondsPerBar(project.bpm));
    active = { kind: 'midi', startBar, trackId, timer: recSettings.countIn > 0 ? countInTimer(Math.max(0, (barStart - engine.contextTime()) * 1000)) : null };
    setState({ recording: { phase: recSettings.countIn > 0 ? 'count' : 'rec', trackId, startBar, startedAt: Date.now() } });
    toast(`Noten aufnehmen ab Takt ${startBar + 1} auf „${name}“${recSettings.countIn ? `, erst ${recSettings.countIn} Takt${recSettings.countIn > 1 ? 'e' : ''} Einzähler` : ''}. Spiel los.`);
  } catch (e) {
    engine.stop();
    endNoteTake(0, false);
    active = null;
    setState({ recording: null });
    toast(errorText(e), 'error');
  }
}

/** Stop a MIDI take: the played notes become a clip (or join the clip that starts at the same bar). */
function finishMidiTake(a: { startBar: number; trackId: string; timer: ReturnType<typeof setTimeout> | null }) {
  if (a.timer) clearTimeout(a.timer);
  const endBar = engine.position();
  engine.stop();
  engine.liveAllOff();
  const { recSettings } = getState();
  const took = endNoteTake(endBar, recSettings.quantize);
  setState({ recording: null });
  if (!took?.notes.length) return toast('Es wurden keine Noten gespielt.');
  const length = Math.max(1, Math.ceil(endBar - a.startBar - 1e-6));
  let clipId = '';
  updateProject((p) => {
    const r = placeMidiTake(p, a.trackId, took.notes, a.startBar, length, uid());
    clipId = r.clipId;
    return r.project;
  });
  setState({ selectedTrackId: a.trackId, selectedClipId: clipId || null });
  toast(`${took.notes.length} Note${took.notes.length === 1 ? '' : 'n'} aufgenommen, Takt ${a.startBar + 1}–${a.startBar + length}${recSettings.quantize ? ' (auf 1/16 gerastet)' : ''}.`);
}

/** Stop the take, cut it to the grid and put it on the track as a clip (a take track when it lands on existing clips). */
export async function stopTrackRecording() {
  const a = active;
  if (!a) return;
  active = null;
  if (a.kind === 'midi') return finishMidiTake(a);
  if (a.timer) clearTimeout(a.timer);
  engine.stop();
  setState({ recording: { phase: 'saving', trackId: a.trackId, startBar: a.startBar, startedAt: Date.now() } });
  try {
    const take = await a.rec.stop();
    const { project, recSettings } = getState();
    // Audio before the bar line (count-in and the time the transport needed to start) goes, plus the device latency.
    const trim = Math.max(0, a.barStart - a.recordStarted) + recSettings.latencyMs / 1000;
    const { sampleRate } = take.pcm;
    const samples = trimTake(take.pcm.samples, sampleRate, trim);
    if (samples.length < sampleRate * 0.2) {
      toast('Die Aufnahme war zu kurz und wurde verworfen.');
      return;
    }
    const seconds = samples.length / sampleRate;
    const target = a.trackId ? project.tracks.find((t) => t.id === a.trackId) : undefined;
    const sample: Sample = { id: `rec:${uid()}`, name: takeName(), category: target?.category ?? 'vocal', folder: 'Aufnahmen', duration: seconds, size: samples.length * 2, bpm: project.bpm, addedAt: Date.now() };
    const stored = await storeSampleAudio(sample, encodeWav({ sampleRate, channels: [samples] }), 'wav');
    setSamples([...getState().samples.filter((x) => x.id !== stored.id), stored]);
    const clip = { id: uid(), sampleId: stored.id, start: a.startBar, length: sampleLengthBars(seconds, project.bpm, project.bpm), offset: 0 };
    let placedOn = '';
    updateProject((p) => {
      const base = target ? p : { ...p, tracks: [...p.tracks, recordingTrack(p, uid())] };
      const id = target?.id ?? base.tracks[base.tracks.length - 1].id;
      const r = placeTake(base, id, clip, uid());
      placedOn = r.project.tracks.find((t) => t.id === r.trackId)?.name ?? '';
      setState({ selectedTrackId: r.trackId, selectedClipId: clip.id });
      return r.project;
    });
    toast(`${clock(seconds)} aufgenommen: „${placedOn}“, Takt ${a.startBar + 1}–${Math.ceil(a.startBar + clip.length)}.`);
  } catch (e) {
    toast(errorText(e), 'error');
  } finally {
    setState({ recording: null });
  }
}

/** The ● button: start a take, or stop the running one. */
export function toggleTrackRecording() {
  if (getState().recording?.phase === 'saving') return;
  return getState().recording ? stopTrackRecording() : startTrackRecording();
}
