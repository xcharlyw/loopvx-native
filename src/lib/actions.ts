import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { strToU8, zipSync } from 'fflate';
import { Platform } from 'react-native';
import { engine } from '../audio/engine';
import { projectEndBars, sampleLengthBars } from '../audio/timing';
import { encodeWav } from '../audio/wav';
import { db } from '../storage/db';
import type { Clip, Project, Sample } from '../types';
import { packProject, unpackProject, usedSampleIds, type PackedSample } from './backup';
import { detectTempo, snapTempo, toMono, type TempoGuess } from '../audio/tempo';
import { withSamplerSample } from '../audio/presets';
import { readMidiFile, writeMidiFile } from './midi';
import { exportableTracks, midiTrackNotes, projectInfoText, readmeText, trackFileName } from './abletonExport';
import { applyGroupEdit, clipsSpan, copyClips, duplicateClips, groupEdit, pasteClips, splitClips, type ClipboardItem } from './clipgroup';
import { consolidateGroups, mergeMidiClips, runSpan } from './consolidate';
import { addClip, mapTrack, trackKind, createMidiClip, editClip, findClip, scaleClip, removeClip, removeTrack, setSlot, splitClip, toggleClipsMuted, duplicateTrack, copyProject, trackForSample, uid, updateClip } from './project';
import { pickFile, readSampleData, storeSampleAudio } from './samples';
import { errorText, getState, openProject, selectedClipIds, setClipSelection, recordHistory, setSamples, setState, toast, updateProject, upsertSample } from './store';

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
  const ids = selectedClipIds();
  if (!ids.length) return;
  updateProject((p) => ids.reduce((acc, id) => removeClip(acc, id), p));
  setClipSelection(null);
}

/** Mute or unmute the selected clips (Live's 0: "Deactivate clip"). */
export function toggleMuteSelectedClips() {
  const ids = selectedClipIds();
  if (!ids.length) return toast('Wähle zuerst einen Clip aus.');
  updateProject((p) => toggleClipsMuted(p, ids));
}

/** Duplicate the selected track right below it and select the copy (Live: Cmd+D on a track). */
export function duplicateSelectedTrack() {
  const { selectedTrackId } = getState();
  if (!selectedTrackId) return toast('Wähle zuerst eine Spur aus.');
  let copyId = '';
  updateProject((p) => {
    const r = duplicateTrack(p, selectedTrackId);
    copyId = r.trackId;
    return r.project;
  });
  if (copyId && copyId !== selectedTrackId) setState({ selectedTrackId: copyId, selectedClipId: null });
}

/** Cmd/Ctrl+D: the selected clips, or the selected track when no clip is selected (like Live). */
export function duplicateSelection() {
  if (selectedClipIds().length) duplicateSelectedClip();
  else duplicateSelectedTrack();
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

let clipboard: ClipboardItem[] = [];

/** Copy the selected clips (Ctrl/Cmd+C). */
export function copySelectedClips() {
  clipboard = copyClips(getState().project, selectedClipIds());
  if (clipboard.length) toast(`${clipboard.length} ${clipboard.length === 1 ? 'Clip' : 'Clips'} kopiert`);
}

/** Paste the copied clips at the playhead (Ctrl/Cmd+V), the block's top on the selected track when it fits. */
export function pasteClipsAtCursor() {
  if (!clipboard.length) {
    toast('Nichts kopiert: Clips auswählen und Strg/Cmd + C.');
    return;
  }
  const { project, cursor, selectedTrackId } = getState();
  const target = project.tracks.findIndex((t) => t.id === selectedTrackId);
  const r = pasteClips(project, clipboard, cursor, target >= 0 ? target : undefined);
  if (!r.ids.length) return;
  updateProject(() => r.project);
  setClipSelection(r.ids[0], r.ids.slice(1));
}

/** Loop region = the bars of the selected clips (Ctrl/Cmd+L, or a double tap on a clip). */
export function loopSelection() {
  const span = clipsSpan(getState().project, selectedClipIds());
  if (!span) return;
  updateProject((p) => ({ ...p, loop: { enabled: true, start: Math.floor(span.start), end: Math.max(Math.floor(span.start) + 1, Math.ceil(span.end)) } }), { reschedule: true });
}

/** Copies of the selected clips right after them (Ableton: Cmd+D); the copies become the selection. */
export function duplicateSelectedClip() {
  const ids = selectedClipIds();
  if (!ids.length) return;
  const r = duplicateClips(getState().project, ids);
  if (!r.ids.length) return;
  updateProject(() => r.project);
  setClipSelection(r.ids[0], r.ids.slice(1));
}

/**
 * Consolidate (Ableton: Cmd/Ctrl+J): the selected clip and the clips of its track that touch it become one clip. MIDI clips
 * merge their notes; audio clips are rendered (clip gain, fades, warping and looping included, track effects not) into a
 * new sample in the folder "Konsolidiert".
 */
export async function consolidateSelectedClip() {
  const { project } = getState();
  const ids = selectedClipIds();
  if (!ids.length) {
    toast('Wähle einen Clip aus, dann Konsolidieren (Strg/Cmd + J).');
    return;
  }
  const groups = consolidateGroups(project.tracks, ids).filter((g) => {
    const track = project.tracks.find((t) => t.id === g.trackId)!;
    return !(track.clips.find((c) => c.id === g.run[0].id)?.notes && g.run.length < 2);
  });
  if (!groups.length) {
    toast('Nichts zu konsolidieren: MIDI-Clips brauchen einen zweiten Clip (Mehrfachauswahl oder direkt daneben).');
    return;
  }
  try {
    toast('Konsolidiere …');
    const replaced = new Map<string, { remove: Set<string>; merged: Clip }>();
    for (const { trackId, run } of groups) {
      const track = project.tracks.find((t) => t.id === trackId)!;
      let merged: Clip;
      if (run[0].notes) {
        merged = mergeMidiClips(run);
      } else {
        const { start, length } = runSpan(run);
        const bare = { ...track, clips: run, fx: undefined, devices: undefined, automation: undefined, volume: 1, muted: false, solo: false };
        const data = await renderWav({ ...project, tracks: [bare] }, { from: start, to: start + length });
        const sample: Sample = { id: `cons:${uid()}`, name: `${track.name} konsolidiert.wav`, category: track.category, bpm: project.bpm, folder: 'Konsolidiert', duration: (length * 240) / project.bpm, size: data.byteLength, addedAt: Date.now() };
        const stored = await storeSampleAudio(sample, data.buffer as ArrayBuffer, 'wav');
        setSamples([...getState().samples, stored]);
        merged = { id: uid(), sampleId: stored.id, start, length, offset: 0 };
      }
      replaced.set(trackId, { remove: new Set(run.map((c) => c.id)), merged });
    }
    updateProject((p) => ({ ...p, tracks: p.tracks.map((t) => { const r = replaced.get(t.id); return r ? { ...t, clips: [...t.clips.filter((c) => !r.remove.has(c.id)), r.merged] } : t; }) }));
    const first = [...replaced.values()][0].merged;
    setClipSelection(first.id, [...replaced.values()].slice(1).map((r) => r.merged.id));
    toast(`${groups.length === 1 ? '1 Clip' : `${groups.length} Clips`} konsolidiert`);
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

/** Select every clip of the selected track (Ctrl/Cmd+A). */
export function selectAllClipsOfTrack() {
  const { project, selectedTrackId } = getState();
  const track = project.tracks.find((t) => t.id === selectedTrackId);
  if (!track?.clips.length) return;
  setClipSelection(track.clips[0].id, track.clips.slice(1).map((c) => c.id));
}

/** Split the selected clip at the playhead (Ableton: Cmd+E). */
export function splitSelectedClip() {
  const { project, cursor } = getState();
  const ids = selectedClipIds();
  if (!ids.length) return;
  const r = splitClips(project, ids, cursor);
  if (!r.ids.length) {
    toast('Tippe auf die Stelle im Clip, an der geschnitten werden soll, dann auf Teilen.');
    return;
  }
  updateProject(() => r.project);
  setClipSelection(r.ids[0], r.ids.slice(1));
}

/** Move the selected clip by `bars` (arrow keys: a beat, with Shift a bar). */
export function nudgeSelectedClip(bars: number) {
  const { project, selectedClipId } = getState();
  if (!selectedClipId) return;
  updateProject((p) => applyGroupEdit(p, groupEdit(project, selectedClipIds(), selectedClipId, 'move', bars, 0, Math.abs(bars))));
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

/** Estimate a sample's tempo from its audio; undefined when nothing repeats clearly (speech, pads). */
export async function detectSampleTempo(sample: Sample): Promise<TempoGuess | undefined> {
  const buffer = await engine.loadBuffer(sample.id);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const guess = detectTempo(toMono(channels), buffer.sampleRate);
  return guess && { ...guess, bpm: snapTempo(guess.bpm, buffer.duration) };
}

/**
 * Give freshly imported loops without a tempo in their name one from their audio. Only confident
 * results are applied, and never to vocals (speech has no beat). Returns how many were set.
 */
export async function autoDetectTempos(added: Sample[]): Promise<number> {
  let set = 0;
  for (const sample of added) {
    if (sample.bpm || sample.category === 'vocal') continue;
    try {
      const guess = await detectSampleTempo(sample);
      if (!guess || guess.confidence < (guess.source === 'loop' ? 0.35 : 0.5)) continue;
      const current = getState().samples.find((x) => x.id === sample.id) ?? sample;
      await upsertSample({ ...current, bpm: guess.bpm });
      set++;
    } catch {
      /* undecodable: leave the sample as it is */
    }
  }
  return set;
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
  const mix = await renderMixdown();
  if (mix) await saveFile(mix.data, mix.name, 'audio/wav', 'com.microsoft.waveform-audio').catch((e) => toast(errorText(e), 'error'));
}

/** The mixdown of the export region as a WAV, or null (nothing to render, or the render failed: already told). */
export async function renderMixdown(): Promise<{ data: Uint8Array; name: string } | null> {
  const { project } = getState();
  if (!project.tracks.some((t) => t.clips.length)) {
    toast('Nichts zu exportieren – lege zuerst Clips ins Arrangement.');
    return null;
  }
  toast('Export läuft …');
  try {
    const data = await renderWav(project, exportRegion(project));
    return { data, name: `${fileSafe(project.name, 'loopvx')} ${project.bpm}bpm.wav` };
  } catch (e) {
    toast(errorText(e), 'error');
    return null;
  }
}

/** True when this browser can hand a file to the system share sheet (iPhone Safari, Android Chrome). Native always can. */
export function canShareFiles(): boolean {
  if (Platform.OS !== 'web') return true;
  try {
    const probe = new globalThis.File([new Uint8Array(1)], 'probe.wav', { type: 'audio/wav' });
    return typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Share a rendered mixdown (WhatsApp, AirDrop, Mail ...). On web this must run straight inside a tap:
 * browsers only open the share sheet with a fresh user gesture, so render first, then share on the next tap.
 * Falls back to a download where files can't be shared.
 */
export async function shareMixdown(mix: { data: Uint8Array; name: string }) {
  if (Platform.OS !== 'web' || !canShareFiles()) {
    await saveFile(mix.data, mix.name, 'audio/wav', 'com.microsoft.waveform-audio');
    return;
  }
  const file = new globalThis.File([mix.data as BlobPart], mix.name, { type: 'audio/wav' });
  try {
    await navigator.share({ files: [file], title: mix.name });
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') toast(errorText(e), 'error');
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

/**
 * A folder for Ableton Live as one ZIP: every audio track without LOOPVX effects (Live's own plugins take over), every MIDI
 * track as a .mid with the sequencer and arpeggiator applied, all from bar 1 and equally long, a reference mixdown with the
 * effects, and a text file with tempo, key, markers, faders and the Live device for each LOOPVX effect.
 */
export async function exportForAbleton() {
  const { project, samples } = getState();
  const tracks = exportableTracks(project);
  if (!tracks.length) {
    toast('Nichts zu exportieren – lege zuerst Clips ins Arrangement.');
    return;
  }
  const bars = projectEndBars(project);
  const region = { from: 0, to: bars };
  try {
    const files: Record<string, Uint8Array> = {};
    const listed: { track: (typeof tracks)[number]; file: string }[] = [];
    for (const [i, track] of tracks.entries()) {
      toast(`Ableton-Export: Spur ${i + 1} von ${tracks.length} „${track.name}“ …`);
      if (trackKind(track) === 'midi') {
        const file = trackFileName(i, track.name, 'mid');
        files[file] = writeMidiFile(midiTrackNotes(track), { bpm: project.bpm, lengthBars: Math.ceil(bars), name: track.name });
        listed.push({ track, file });
      } else {
        const file = trackFileName(i, track.name, 'wav');
        // bare copy: no fader, effects, devices, automation or master chain; clip gain, fades and looping stay
        const bare = { ...track, clips: track.clips.filter((c) => !c.muted), fx: undefined, devices: undefined, automation: undefined, volume: 1, muted: false, solo: false };
        files[file] = await renderWav({ ...project, tracks: [bare], master: undefined }, region);
        listed.push({ track, file });
      }
    }
    toast('Ableton-Export: Referenz-Mixdown …');
    files['00 Referenz Mixdown.wav'] = await renderWav(project, region);
    files['Projekt-Info.txt'] = strToU8(projectInfoText(project, samples, listed));
    files['LIES MICH.txt'] = strToU8(readmeText(project, bars));
    // level 0: WAV barely compresses, and storing is instant.
    await saveFile(zipSync(files, { level: 0 }), `${fileSafe(project.name, 'loopvx')} ${project.bpm}bpm Ableton.zip`, 'application/zip', 'public.zip-archive');
    toast('Ableton-Paket fertig: ZIP entpacken und die Dateien auf Takt 1 ziehen (siehe „LIES MICH.txt“).');
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

/** Save a copy of a project next to it and open the copy (e.g. to try the AI arrangement without touching the original). */
export async function duplicateProject(project: Project) {
  try {
    const copy = copyProject(project);
    await db.putProject(copy);
    await openProject(copy);
    toast(`„${copy.name}“ angelegt und geöffnet.`);
  } catch (e) {
    toast(errorText(e), 'error');
  }
}

// ---------------- MIDI ----------------

/** A new, empty MIDI clip (4 bars) on a track at the playhead, selected and opened in the piano roll. */
export function createMidiClipOnTrack(trackId: string) {
  const track = getState().project.tracks.find((t) => t.id === trackId);
  if (!track || trackKind(track) !== 'midi') {
    toast('Das ist eine Audio-Spur. Lege eine MIDI-Spur an (Spur + MIDI) oder ändere den Spurtyp einer leeren Spur.');
    return;
  }
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

/** A sample dropped on a MIDI track's instrument: the sampler takes it (or replaces the instrument), one undo step, played once. */
export function loadSampleIntoSampler(trackId: string, sampleId: string) {
  const { project, samples } = getState();
  const track = project.tracks.find((t) => t.id === trackId);
  const sample = samples.find((x) => x.id === sampleId);
  if (!track || !sample) return;
  if (trackKind(track) !== 'midi') return toast('Der Sampler sitzt auf MIDI-Spuren: zieh das Sample auf eine MIDI-Spur.');
  updateProject((p) => mapTrack(p, trackId, (t) => withSamplerSample(t, sampleId)));
  const synth = getState().project.tracks.find((t) => t.id === trackId)?.synth;
  if (synth) void engine.previewNote(synth, synth.sampleRoot ?? 60);
  toast(`${sample.name.replace(/\.[a-z0-9]+$/i, '')} → Sampler auf ${track.name}`);
}

export interface AuditionInfo {
  bpm?: number;
  /** The tempo was found just now by listening (and stored on the sample). */
  detected: boolean;
}

/**
 * Audition a library sample in the project tempo, like Live's browser: a loop without a tempo is measured first (confident
 * results are stored on the sample, so the next clip warps right too), then it plays warped and, while the song runs, joins
 * on the next bar.
 */
export async function auditionSample(sample: Sample): Promise<AuditionInfo> {
  let current = sample;
  let detected = false;
  if (!current.bpm && current.category !== 'vocal' && (current.duration === undefined || current.duration > 1.2)) {
    const guess = await detectSampleTempo(current).catch(() => null);
    if (guess && guess.confidence >= (guess.source === 'loop' ? 0.35 : 0.5)) {
      current = { ...(getState().samples.find((x) => x.id === sample.id) ?? sample), bpm: guess.bpm };
      await upsertSample(current);
      detected = true;
    }
  }
  await engine.preview(current, getState().project.bpm);
  return { bpm: current.bpm, detected };
}
