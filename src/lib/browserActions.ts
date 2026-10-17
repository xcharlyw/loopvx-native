import { engine } from '../audio/engine';
import { DEVICE_DEFS, MAX_DEVICES, deviceParams } from '../audio/devices';
import { DEVICE_PRESETS } from '../audio/devicepresets';
import { applyPreset, presetById } from '../audio/presets';
import type { DeviceType, Project } from '../types';
import { fxTarget, midiTarget } from './browser';
import { applyArpPreset, applySeqPreset, setArp, setSeq } from './notefxActions';
import { MASTER_ID, addDevice, createMidiTrack, mapTrack, trackKind, uid, updateDevice } from './project';
import { getState, setDevicePresets, setState, toast, updateProject } from './store';
import { removeUserPreset, saveUserPreset, userPresetOf } from './userPresets';

// What the browser does with an item (Live's workflow): a sound goes onto the selected MIDI track (or a new one), an audio effect into
// the selected track's chain, a MIDI effect onto the MIDI track. Tapping an item, Enter and dropping it on a target all end here.

/** A new MIDI track right after the selected one (like Live's Cmd+Shift+T); returns its id. */
function newMidiTrack(name: string): string {
  const track = createMidiTrack(getState().project.sceneCount, name);
  updateProject((p) => {
    const at = p.tracks.findIndex((t) => t.id === getState().selectedTrackId);
    const tracks = [...p.tracks];
    tracks.splice(at < 0 ? tracks.length : at + 1, 0, track);
    return { ...p, tracks };
  });
  return track.id;
}

/** Loads an instrument sound onto `trackId` (a MIDI track), else the selected MIDI track, else a new MIDI track; plays it once. */
export function loadSound(presetId: string, trackId?: string) {
  const preset = presetById(presetId);
  if (!preset) return;
  const { project, selectedTrackId } = getState();
  const given = trackId ? project.tracks.find((t) => t.id === trackId) : undefined;
  if (given && trackKind(given) !== 'midi') return toast('Sounds gehören auf MIDI-Spuren: zieh ihn auf eine MIDI-Spur oder ins Leere.');
  const id = given?.id ?? midiTarget(project, selectedTrackId) ?? newMidiTrack(preset.name);
  updateProject((p) => mapTrack(p, id, (t) => applyPreset(t, preset)));
  setState({ selectedTrackId: id });
  void engine.previewNote(preset.synth, preset.note);
  toast(`${preset.name} → ${getState().project.tracks.find((t) => t.id === id)?.name ?? 'MIDI'}`);
}

/** The parameters of a device preset: the user's own or a factory one (none = the device's defaults). */
function presetValues(type: DeviceType, presetId?: string): Record<string, number> | undefined {
  if (!presetId) return undefined;
  const own = getState().devicePresets.find((p) => p.id === presetId && p.type === type);
  if (own) return deviceParams({ type, params: own.params });
  const factory = DEVICE_PRESETS[type]?.find((p) => p.id === presetId);
  return factory ? deviceParams({ type, params: factory.params }) : undefined;
}

const chainOf = (p: Project, trackId: string) => (trackId === MASTER_ID ? p.master?.devices : p.tracks.find((t) => t.id === trackId)?.devices) ?? [];

/**
 * Adds an audio effect (optionally set to a preset) to a chain: `trackId` (a track or MASTER_ID) at `index`, else the end of the selected
 * track's chain. One undo step. Returns whether it was added.
 */
export function addDeviceFrom(type: DeviceType, opts: { presetId?: string; trackId?: string; index?: number } = {}): boolean {
  const { project, selectedTrackId } = getState();
  const target = opts.trackId ?? fxTarget(project, selectedTrackId);
  if (!target) {
    toast('Wähle zuerst eine Spur aus.');
    return false;
  }
  const before = chainOf(project, target);
  if (before.length >= MAX_DEVICES) {
    toast(`Mehr als ${MAX_DEVICES} Geräte pro Spur sind nicht möglich.`);
    return false;
  }
  const params = presetValues(type, opts.presetId);
  updateProject(
    (p) => {
      const next = addDevice(p, target, type, opts.index);
      const known = new Set(before.map((d) => d.id));
      const added = chainOf(next, target).find((d) => !known.has(d.id));
      return added && params ? updateDevice(next, target, added.id, { params }) : next;
    },
    { reschedule: false },
  );
  const where = target === MASTER_ID ? 'Master' : (getState().project.tracks.find((t) => t.id === target)?.name ?? '');
  toast(`${DEVICE_DEFS[type].label} → ${where}`);
  return true;
}

/** Switches a MIDI effect preset on: on `trackId`, else the selected MIDI track, else a new MIDI track. */
export function applyMidiFx(kind: 'arp' | 'seq', presetId: string, trackId?: string) {
  const { project, selectedTrackId } = getState();
  const id = trackId ?? midiTarget(project, selectedTrackId) ?? newMidiTrack(kind === 'arp' ? 'Arp' : 'Sequencer');
  if (kind === 'arp') {
    applyArpPreset(id, presetId);
    setArp(id, { on: true }, true);
  } else {
    applySeqPreset(id, presetId);
    setSeq(id, { on: true }, true);
  }
  setState({ selectedTrackId: id });
  toast(`${kind === 'arp' ? 'Arpeggiator' : 'Sequencer'} an auf ${getState().project.tracks.find((t) => t.id === id)?.name ?? 'MIDI'}`);
}

/** Saves a device's settings as the user's own preset (same name of the same device replaces it). */
export function saveDevicePreset(device: { type: DeviceType; params: Record<string, number> }, name: string) {
  const list = saveUserPreset(getState().devicePresets, device, name, `user:${uid()}`);
  if (list === getState().devicePresets) return;
  setDevicePresets(list);
  toast(`Preset „${name.trim()}“ gespeichert`);
}

export function deleteDevicePreset(id: string) {
  setDevicePresets(removeUserPreset(getState().devicePresets, id));
}

/** The user's preset a device matches right now (shown instead of "Eigene Einstellung"). */
export const ownPresetOf = (device: { type: DeviceType; params: Record<string, number> }) => userPresetOf(getState().devicePresets, device);
