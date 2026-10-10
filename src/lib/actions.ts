import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { zipSync } from 'fflate';
import { Platform } from 'react-native';
import { engine } from '../audio/engine';
import { projectEndBars, sampleLengthBars } from '../audio/timing';
import { encodeWav } from '../audio/wav';
import { db } from '../storage/db';
import type { Clip, Project, Sample } from '../types';
import { packProject, unpackProject, usedSampleIds, type PackedSample } from './backup';
import { readMidiFile, writeMidiFile } from './midi';
import { addClip, createMidiClip, editClip, findClip, scaleClip, removeClip, removeTrack, setSlot, splitClip, trackForSample, uid, updateClip } from './project';
import { pickFile, readSampleData, storeSampleAudio } from './samples';
import { errorText, getState, openProject, recordHistory, setSamples, setState, toast, updateProject, upsertSample } from './store';

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

/** Remove the selected track (after asking) and select its neighbour. */
export async function deleteSelectedTrack(confirm: (title: string, message?: string) => Promise<boolean>) {
  const { project, selectedTrackId } = getState();
  const index = project.tracks.findIndex((t) => t.id === selectedTrackId);
  const track = project.tracks[index];
  if (!track) return;
  const clips = track.clips.length + track.slots.filter(Boolean).length;
  const message = clips ? `Die Spur enthält ${clips === 1 ? '1 Clip' : `${clips} Clips`}, die mit gelöscht werden.` : undefined;
  if (!(await confirm(`Spur „${track.name}“ löschen?`, message))) return;
  updateProject((p) => removeTrack(p, track.id));
  const rest = getState().project.tracks;
  setState({ selectedTrackId: rest[Math.min(index, rest.length - 1)]?.id ?? null, selectedClipId: null });
}

export function duplicateSelectedClip() {
  const { project, selectedClipId } = getState();
  const found = selectedClipId ? findClip(project, selectedClipId) : null;
  if (!found) return;
  const copy = { ...found.clip, id: uid(), start: found.clip.start + found.clip.length };
  updateProject((p) => addClip(p, found.track.id, copy));
  setState({ selectedClipId: copy.id });
}

/** Split the selected clip at the playhead (Ableton: Cmd+E). */
export function splitSelectedClip() {
  const { project, selectedClipId, cursor } = getState();
  const found = selectedClipId ? findClip(project, selectedClipId) : null;
  if (!found) return;
  const rightId = uid();
  const next = splitClip(project, found.clip.id, cursor, rightId);
  if (next === project) {
    toast('Tippe auf die Stelle im Clip, an der geschnitten werden soll, dann auf Teilen.');
    return;
  }
  updateProject(() => next);
  setState({ selectedClipId: rightId });
}

/** Move the selected clip by `bars` (arrow keys: a beat, with Shift a bar). */
export function nudgeSelectedClip(bars: number) {
  const { project, selectedClipId } = getState();
  const found = selectedClipId ? findClip(project, selectedClipId) : null;
  if (!found) return;
  updateProject((p) => updateClip(p, found.clip.id, editClip(found.clip, 'move', bars, Math.abs(bars))));
}

/**
 * Set the tempo a sample was recorded at. Clips warp from it to the project tempo
 * (re-pitch); `undefined` plays the sample at its own speed.
 */
export async function setSampleBpm(sample: Sample, bpm: number | undefined) {
  if (sample.bpm === bpm) return;
  recordHistory();
  await upsertSample({ ...sample, bpm });
  updateProject((p) => p); // no project change: only reschedules the audio
}

/** Re-pitch (speed and pitch together) or stretch (pitch stays) when the sample follows the project tempo. */
export async function setSampleWarp(sample: Sample, warp: 'repitch' | 'stretch') {
  if ((sample.warp ?? 'repitch') === warp) return;
  recordHistory();
  await upsertSample({ ...sample, warp });
  updateProject((p) => p); // no project change: only reschedules the audio
}

export function scaleSelectedClip(factor: number) {
  const { project, selectedClipId } = getState();
  const found = selectedClipId ? findClip(project, selectedClipId) : null;
  if (!found) return;
  updateProject((p) => updateClip(p, found.clip.id, scaleClip(found.clip, factor)));
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

/** What gets exported: the loop when it is on, otherwise the whole arrangement. */
export function exportRegion(project = getState().project): { from: number; to: number } {
  return project.loop.enabled ? { from: project.loop.start, to: project.loop.end } : { from: 0, to: projectEndBars(project) };
}

const fileSafe = (name: string, fallback: string) => name.replace(/[^\w\s+.-]/g, ' ').replace(/\s+/g, ' ').trim() || fallback;

async function renderWav(project: Project, region: { from: number; to: number }): Promise<Uint8Array> {
  const buffer = await engine.render(project, region);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  return new Uint8Array(encodeWav({ sampleRate: buffer.sampleRate, channels }));
}

export async function exportWav() {
  const { project } = getState();
  if (!project.tracks.some((t) => t.clips.length)) {
    toast('Nichts zu exportieren – lege zuerst Clips ins Arrangement.');
    return;
  }
  toast('Export läuft …');
  try {
    const wav = await renderWav(project, exportRegion(project));
    await saveFile(wav, `${fileSafe(project.name, 'loopvx')} ${project.bpm}bpm.wav`, 'audio/wav', 'com.microsoft.waveform-audio');
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

/** One WAV per track (post-fader, mute and solo ignored), zipped: drag them straight into Ableton. */
export async function exportStems() {
  const { project } = getState();
  const region = exportRegion(project);
  const tracks = project.tracks.filter((t) => t.clips.some((c) => c.start < region.to && c.start + c.length > region.from));
  if (!tracks.length) {
    toast('Im Exportbereich liegen keine Clips.');
    return;
  }
  toast(`Stems werden gerendert (${tracks.length} Spuren) …`);
  try {
    const files: Record<string, Uint8Array> = {};
    for (const [i, track] of tracks.entries()) {
      const solo = { ...project, tracks: [{ ...track, muted: false, solo: false }] };
      files[`${String(i + 1).padStart(2, '0')} ${fileSafe(track.name, 'Spur')}.wav`] = await renderWav(solo, region);
    }
    // level 0: WAV barely compresses, and storing is instant.
    const zip = zipSync(files, { level: 0 });
    await saveFile(zip, `${fileSafe(project.name, 'loopvx')} ${project.bpm}bpm Stems.zip`, 'application/zip', 'public.zip-archive');
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

/** Save a sample's original audio file (e.g. an AI vocal) to the device. */
export async function downloadSample(sample: Sample) {
  try {
    const data = new Uint8Array(await readSampleData(sample));
    const ext = (/\.([a-z0-9]{2,5})$/i.exec(sample.name)?.[1] ?? 'wav').toLowerCase();
    await saveFile(data, sample.name, ext === 'mp3' ? 'audio/mpeg' : ext === 'wav' ? 'audio/wav' : 'application/octet-stream', 'public.audio');
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

/** Save a project and the audio of every sample it uses as one ".loopvx" file. */
export async function exportProjectFile(project: Project) {
  const ids = usedSampleIds(project);
  const packed: PackedSample[] = [];
  const missing: string[] = [];
  for (const sample of getState().samples.filter((x) => ids.has(x.id))) {
    try {
      packed.push({ sample, data: new Uint8Array(await readSampleData(sample)) });
    } catch {
      missing.push(sample.name);
    }
  }
  if (missing.length) toast(`Ohne Audio gesichert: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' …' : ''}`, 'error');
  try {
    await saveFile(packProject(project, packed), `${fileSafe(project.name, 'loopvx')}.loopvx`, 'application/zip', 'public.zip-archive');
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

/** Open a ".loopvx" file: its samples join the library, the project opens (as a copy if it already exists here). */
export async function importProjectFile() {
  try {
    const picked = await pickFile();
    if (!picked) return;
    const { project, samples } = unpackProject(new Uint8Array(picked.data));
    const have = new Set(getState().samples.map((x) => x.id));
    for (const { sample, data } of samples) {
      if (have.has(sample.id)) continue;
      const ext = (/\.([a-z0-9]{2,5})$/i.exec(sample.name)?.[1] ?? 'wav').toLowerCase();
      await storeSampleAudio(sample, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, ext);
    }
    setSamples(await db.getSamples());
    const exists = (await db.getProjects()).some((x) => x.id === project.id);
    const opened = exists ? { ...project, id: uid(), name: `${project.name} (Kopie)` } : project;
    const saved = { ...opened, updatedAt: Date.now() };
    await db.putProject(saved);
    await openProject(saved);
    toast(`„${saved.name}“ geöffnet${samples.length ? ` (${samples.length} Samples)` : ''}.`);
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

// ---------------- MIDI ----------------

/** A new, empty MIDI clip (4 bars) on a track at the playhead, selected and opened in the piano roll. */
export function createMidiClipOnTrack(trackId: string) {
  const clip = createMidiClip(Math.floor(getState().cursor), 4);
  updateProject((p) => addClip(p, trackId, clip));
  setState({ selectedClipId: clip.id, selectedTrackId: trackId, panel: 'piano' });
}

/** Load a .mid file as a MIDI clip on a track at the playhead (all its tracks and channels merged). */
export async function importMidiToTrack(trackId: string) {
  try {
    const picked = await pickFile();
    if (!picked) return;
    const { notes, lengthBars } = readMidiFile(new Uint8Array(picked.data));
    if (!notes.length) {
      toast('In der MIDI-Datei sind keine Noten.', 'error');
      return;
    }
    const clip = { ...createMidiClip(Math.floor(getState().cursor), lengthBars), notes };
    updateProject((p) => addClip(p, trackId, clip));
    setState({ selectedClipId: clip.id, selectedTrackId: trackId, panel: 'piano' });
    toast(`${notes.length} Noten aus „${picked.name}“ importiert.`);
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

/** Save a MIDI clip as a .mid file (for Ableton, Serum and co.). */
export async function exportMidiClip(clip: Clip, name: string) {
  try {
    const { project } = getState();
    const file = writeMidiFile(clip.notes ?? [], { bpm: project.bpm, lengthBars: clip.length, name });
    await saveFile(file, `${fileSafe(project.name, 'loopvx')} ${fileSafe(name, 'MIDI')}.mid`, 'audio/midi', 'public.midi-audio');
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

/** Web: download through a link. Native: write to the cache and open the share sheet. */
async function saveFile(data: Uint8Array, name: string, mimeType: string, uti: string) {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mimeType }));
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
  file.write(data);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name, UTI: uti });
}
