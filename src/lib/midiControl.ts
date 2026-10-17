import { engine } from '../audio/engine';
import { CC_TARGETS, NoteRecorder, applyCc, learnCc, parseMidiMessage, type CcTarget } from './midiIn';
import { midiSupported, openMidi, type MidiHandle } from './midiAccess';
import { trackKind } from './project';
import { db } from '../storage/db';
import { errorText, getState, setCcMap, setState, toast, updateProject } from './store';

let handle: MidiHandle | null = null;

/** A take being played in: where it began on the timeline, the audio-clock time of that bar line, and how much earlier to place notes. */
let take: { rec: NoteRecorder; trackId: string; startBar: number; barStart: number; latencyBars: number } | null = null;

const setMidi = (patch: Partial<ReturnType<typeof getState>['midi']>) => setState({ midi: { ...getState().midi, ...patch } });

const refreshInputs = () => setMidi({ inputs: handle?.inputs() ?? [] });

/** The track the controller plays: the selected MIDI track. */
function playTrack() {
  const { project, selectedTrackId } = getState();
  const track = project.tracks.find((t) => t.id === selectedTrackId);
  return track && trackKind(track) === 'midi' ? track : undefined;
}

function onMessage(data: Uint8Array) {
  const m = parseMidiMessage(data);
  if (m.type === 'other') return;
  const state = getState();
  if (m.type === 'cc') {
    if (state.midi.learn) {
      const target = state.midi.learn;
      setCcMap(learnCc(state.ccMap, m.controller, target));
      setMidi({ learn: null, last: `CC ${m.controller} steuert jetzt ${CC_TARGETS.find((t) => t.id === target)?.label}` });
      return;
    }
    const target = state.ccMap[m.controller];
    const track = state.project.tracks.find((t) => t.id === state.selectedTrackId);
    if (!target || !track) return;
    updateProject((p) => applyCc(p, track.id, target, m.value), { reschedule: false, merge: true });
    return;
  }
  const track = playTrack();
  if (!track) {
    if (m.type === 'noteOn') setMidi({ last: 'Wähle eine MIDI-Spur aus, dann spielt das Keyboard sie.' });
    return;
  }
  if (m.type === 'noteOn') {
    setMidi({ last: `Note ${m.note} auf „${track.name}“` });
    void engine.liveNoteOn(state.project, track, m.note, m.velocity);
    if (take && take.trackId === track.id && engine.contextTime() >= take.barStart - 0.02) take.rec.noteOn(m.note, m.velocity, engine.position() - take.latencyBars);
  } else {
    engine.liveNoteOff(m.note);
    if (take && take.trackId === track.id) take.rec.noteOff(m.note, engine.position() - take.latencyBars);
  }
}

/** Connect the controllers (asks the browser for permission). Remembers the choice for the next start. */
export async function enableMidi() {
  if (handle) return;
  try {
    // Opened inside a tap in the panel: also starts the audio so played notes can sound.
    await engine.unlock().catch(() => undefined);
    handle = await openMidi(onMessage, refreshInputs);
    setMidi({ enabled: true, inputs: handle.inputs(), last: '' });
    void db.setKv('midiEnabled', true);
  } catch (e) {
    handle = null;
    setMidi({ enabled: false, inputs: [] });
    toast(errorText(e), 'error');
  }
}

export function disableMidi() {
  handle?.close();
  handle = null;
  engine.liveAllOff();
  setMidi({ enabled: false, inputs: [], learn: null });
  void db.setKv('midiEnabled', false);
}

/** At start: note whether the browser can do MIDI and reconnect when it was on last time. */
export async function bootMidi() {
  const supported = midiSupported();
  setMidi({ supported });
  if (supported && (await db.getKv<boolean>('midiEnabled'))) await enableMidi();
}

export function startLearn(target: CcTarget | null) {
  setMidi({ learn: target, last: target ? `Bewege jetzt einen Regler für ${CC_TARGETS.find((t) => t.id === target)?.label} …` : '' });
}

// ---------------------------------------------------------------- MIDI takes (used by the record button)

export const midiConnected = () => !!handle && getState().midi.inputs.length > 0;

/** Start collecting the notes played from now on; notes before `barStart` (the count-in) are ignored. */
export function beginNoteTake(trackId: string, startBar: number, barStart: number, latencyBars: number) {
  take = { rec: new NoteRecorder(startBar), trackId, startBar, barStart, latencyBars };
}

/** The notes of the take (held ones closed at `endBar`); null when none is running. */
export function endNoteTake(endBar: number, quantize: boolean) {
  const t = take;
  take = null;
  return t ? { notes: t.rec.finish(endBar - t.latencyBars, quantize), startBar: t.startBar } : null;
}

export const noteTakeRunning = () => !!take;
