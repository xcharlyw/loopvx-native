import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { engine } from '../audio/engine';
import { projectEndBars, sampleLengthBars } from '../audio/timing';
import { encodeWav } from '../audio/wav';
import type { Sample } from '../types';
import { addClip, findClip, removeClip, setSlot, trackForSample, uid, updateClip } from './project';
import { errorText, getState, setState, toast, updateProject } from './store';

export async function togglePlay() {
  const { project, view, cursor } = getState();
  try {
    if (engine.playing) {
      engine.stop();
      return;
    }
    if (view === 'arrange') {
      await engine.play(project, cursor);
    } else {
      const scene = project.tracks.length
        ? [...Array(project.sceneCount).keys()].find((i) => project.tracks.some((t) => t.slots[i])) ?? 0
        : 0;
      await engine.launchScene(project, scene);
    }
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

export function setCursor(bars: number) {
  if (!Number.isFinite(bars)) return;
  setState({ cursor: Math.max(0, bars) });
  if (engine.playing && engine.mode === 'arrange') void engine.play(getState().project, Math.max(0, bars));
}

/** Put a library sample on its matching track at the playhead (arrange) or into the next free slot (session). */
export async function placeSample(sample: Sample, target?: { trackId: string; bar?: number; scene?: number }) {
  const { project, selectedTrackId, cursor, view } = getState();
  const track = target ? project.tracks.find((t) => t.id === target.trackId) : trackForSample(project, sample, selectedTrackId);
  if (!track) return;
  try {
    const buffer = await engine.loadBuffer(sample.id);
    if (view === 'session' || target?.scene !== undefined) {
      const scene = target?.scene ?? Math.max(0, track.slots.findIndex((s) => !s));
      updateProject((p) => setSlot(p, track.id, scene === -1 ? 0 : scene, sample.id), { reschedule: false });
      toast(`${sample.name} → ${track.name}, Szene ${scene + 1}`);
      return;
    }
    const length = sampleLengthBars(buffer.duration, project.bpm, sample.bpm);
    const start = Math.floor(target?.bar ?? cursor);
    // Loops fill the loop region (or at least 4 bars) so a stack plays right away.
    const fill = project.loop.enabled && start < project.loop.end ? project.loop.end - start : 4;
    const clipLength = length < fill ? Math.ceil(fill / length) * length : length;
    const clip = { id: uid(), sampleId: sample.id, start, length: clipLength, offset: 0 };
    updateProject((p) => addClip(p, track.id, clip));
    setState({ selectedClipId: clip.id, selectedTrackId: track.id, armedSampleId: null });
    if (sample.bpm && sample.bpm !== project.bpm) {
      toast(`Hinweis: Sample hat ${sample.bpm} BPM und wird auf ${project.bpm} BPM gezogen (Tonhöhe ändert sich).`);
    }
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

export function deleteSelectedClip() {
  const id = getState().selectedClipId;
  if (!id) return;
  updateProject((p) => removeClip(p, id));
  setState({ selectedClipId: null });
}

export function duplicateSelectedClip() {
  const { project, selectedClipId } = getState();
  const found = selectedClipId ? findClip(project, selectedClipId) : null;
  if (!found) return;
  const copy = { ...found.clip, id: uid(), start: found.clip.start + found.clip.length };
  updateProject((p) => addClip(p, found.track.id, copy));
  setState({ selectedClipId: copy.id });
}

export function scaleSelectedClip(factor: number) {
  const { project, selectedClipId } = getState();
  const found = selectedClipId ? findClip(project, selectedClipId) : null;
  if (!found) return;
  updateProject((p) => updateClip(p, found.clip.id, { length: Math.max(0.25, found.clip.length * factor) }));
}

/** Copy a session scene into the arrangement at the playhead. */
export async function sceneToArrangement(scene: number) {
  const { project, cursor } = getState();
  const start = Math.floor(cursor);
  let next = project;
  let maxLen = 0;
  for (const t of project.tracks) {
    const slot = t.slots[scene];
    if (!slot) continue;
    const sample = getState().samples.find((s) => s.id === slot.sampleId);
    const buffer = await engine.loadBuffer(slot.sampleId);
    const length = sampleLengthBars(buffer.duration, project.bpm, sample?.bpm);
    const len = Math.max(4, Math.ceil(4 / length) * length);
    maxLen = Math.max(maxLen, len);
    next = addClip(next, t.id, { id: uid(), sampleId: slot.sampleId, start, length: len, offset: 0 });
  }
  updateProject(() => next);
  setState({ cursor: start + maxLen });
  toast(`Szene ${scene + 1} ins Arrangement übernommen`);
}

export async function exportWav() {
  const { project } = getState();
  const region = project.loop.enabled
    ? { from: project.loop.start, to: project.loop.end }
    : { from: 0, to: projectEndBars(project) };
  if (!project.tracks.some((t) => t.clips.length)) {
    toast('Nichts zu exportieren – lege zuerst Clips ins Arrangement.');
    return;
  }
  toast('Export läuft …');
  try {
    const buffer = await engine.render(project, region);
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    const wav = encodeWav({ sampleRate: buffer.sampleRate, channels });
    const name = `${project.name.replace(/[^\w\s-]/g, '').trim() || 'loopvx'} ${project.bpm}bpm.wav`;
    await saveWav(wav, name);
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

async function saveWav(wav: ArrayBuffer, name: string) {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(new Uint8Array(wav));
  await Sharing.shareAsync(file.uri, { mimeType: 'audio/wav', dialogTitle: name, UTI: 'com.microsoft.waveform-audio' });
}
