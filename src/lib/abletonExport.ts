import { applyNoteFx } from '../audio/notefx';
import { deviceDef } from '../audio/devices';
import type { Clip, DeviceType, Note, Project, Sample, Track } from '../types';
import { trackKind } from './project';

// Export for Ableton Live: the project's audio without LOOPVX effects (so Live's own plugins take over), the MIDI of every
// MIDI track as one .mid from bar 1, a reference mixdown and a text file with everything that does not travel (tempo, key,
// markers, faders, the instrument and effect settings with the Live device that comes closest). Pure parts only.

/** The Live device that comes closest to each LOOPVX device. */
export const LIVE_DEVICE: Record<DeviceType, string> = {
  eq: 'EQ Eight',
  comp: 'Compressor',
  sat: 'Saturator',
  echo: 'Echo',
  reverb: 'Reverb',
  chorus: 'Chorus-Ensemble',
  filter: 'Auto Filter',
  limiter: 'Limiter',
  utility: 'Utility',
  transient: 'Drum Buss (Regler „Transients“)',
  kickstart: 'Kickstart 2 (Plugin) oder Compressor mit Sidechain auf die Kick',
  shaper: 'ShaperBox (Plugin) oder Auto Pan / Auto Filter',
  splice: '(nichts: nur ein Platz für Splice-Sounds)',
};

const fileSafe = (name: string, fallback: string) => name.replace(/[^\w\s+.-]/g, ' ').replace(/\s+/g, ' ').trim() || fallback;

/** "03 Synth Lead.wav": the number keeps the track order, the name is safe for every file system. */
export const trackFileName = (index: number, name: string, ext: 'wav' | 'mid'): string => `${String(index + 1).padStart(2, '0')} ${fileSafe(name, 'Spur')}.${ext}`;

/**
 * All notes of a MIDI track from bar 0 of the arrangement, as they sound: the sequencer and the arpeggiator are already applied,
 * every note is cut at the end of its clip, deactivated clips are left out.
 */
export function midiTrackNotes(track: Track): Note[] {
  const fx = { arp: track.arp, seq: track.seq };
  const notes: Note[] = [];
  for (const clip of track.clips) {
    if (clip.muted || !clip.notes) continue;
    for (const n of applyNoteFx(clip.notes, fx, clip.length)) {
      if (n.start >= clip.length - 1e-9) continue;
      notes.push({ ...n, start: n.start + clip.start, length: Math.min(n.length, clip.length - n.start) });
    }
  }
  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** The notes of one MIDI clip as they sound (sequencer and arpeggiator applied), relative to the clip start, cut at its end. */
export function clipNotes(track: Track, clip: Clip): Note[] {
  if (!clip.notes) return [];
  return applyNoteFx(clip.notes, { arp: track.arp, seq: track.seq }, clip.length)
    .filter((n) => n.start < clip.length - 1e-9)
    .map((n) => ({ ...n, length: Math.min(n.length, clip.length - n.start) }));
}

/** Live's colour indices that look different from each other, handed out in track order. */
const LIVE_COLORS = [26, 13, 20, 8, 36, 48, 3, 56, 30, 17, 41, 25];
export const liveColor = (index: number): number => LIVE_COLORS[index % LIVE_COLORS.length];

/** What the WAV that `encodeWav` writes holds (16-bit PCM): frames and sample rate, read from its header. */
export function wavInfo(wav: Uint8Array): { frames: number; sampleRate: number } {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const channels = v.getUint16(22, true);
  const sampleRate = v.getUint32(24, true);
  const bytesPerFrame = channels * (v.getUint16(34, true) / 8);
  return { frames: Math.floor((wav.byteLength - 44) / bytesPerFrame), sampleRate };
}

/**
 * Whether a track has LOOPVX effects that deserve a "wet" version next to the dry one: a device that is on, the DJ filter, drive,
 * a reverb or delay send, the pump or automation. A pan alone is not a plugin.
 */
export function hasEffects(track: Track): boolean {
  const fx = track.fx;
  return !!(fx?.filter || fx?.drive || fx?.reverb || fx?.delay || fx?.pump || (track.devices ?? []).some((d) => d.on && d.type !== 'splice') || track.automation?.length);
}

/**
 * The project for the wet render of one track: its effects, sends, pump and automation stay, the fader and the pan do not (Live's
 * mixer carries them). A sidechain source is kept silent (volume 0) so the pump still ducks on its hits, not on every beat.
 */
export function wetProject(project: Project, track: Track): Project {
  const mine: Track = { ...track, clips: track.clips.filter((c) => !c.muted), volume: 1, muted: false, solo: false, fx: track.fx ? { ...track.fx, pan: 0 } : undefined };
  const source = track.fx?.pumpFrom ? project.tracks.find((t) => t.id === track.fx?.pumpFrom && t.id !== track.id) : undefined;
  const silent: Track[] = source ? [{ ...source, clips: source.clips.filter((c) => !c.muted), volume: 0, muted: false, solo: false, devices: undefined, automation: undefined, fx: undefined }] : [];
  return { ...project, tracks: [mine, ...silent], master: undefined };
}

/** A track that has something to export: at least one clip that is not deactivated. */
export const exportableTracks = (project: Project): Track[] => project.tracks.filter((t) => t.clips.some((c) => !c.muted));

const dbText = (volume: number) => (volume <= 0.0005 ? '-inf dB' : `${(20 * Math.log10(volume)).toFixed(1)} dB`);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Ableton's naming: 60 = C3. */
export const noteName = (pitch: number): string => `${NOTE_NAMES[((Math.round(pitch) % 12) + 12) % 12]}${Math.floor(Math.round(pitch) / 12) - 2}`;

/** The file name a sampler's sample gets in the export: a safe name with its own extension. */
export function samplerFileName(sample: Pick<Sample, 'name'>): string {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(sample.name)?.[1]?.toLowerCase() ?? 'wav';
  return `${fileSafe(sample.name.replace(/\.[a-z0-9]{2,5}$/i, ''), 'Sample')}.${ext}`;
}

/** The sample a MIDI track's sampler plays, or undefined (other instruments, or the sample is gone). */
export const samplerSample = <T extends Pick<Sample, 'id'>>(track: Track, samples: T[]): T | undefined => (track.synth?.wave === 'sample' ? samples.find((x) => x.id === track.synth?.sampleId) : undefined);

/** The instrument of a MIDI track in a few words, for the info file. */
export function instrumentText(track: Track, samples: Pick<Sample, 'id' | 'name'>[]): string {
  const s = track.synth;
  if (!s) return 'kein Instrument gesetzt';
  if (s.wave === 'kit909') return '909-Drum-Maschine (Noten wie im Drum Rack: Kick C1 = 36, Snare D1, Clap D#1, Hats F#1/A#1)';
  if (s.wave === 'kick') return 'synthetischer Kick';
  if (s.wave === 'noise') return 'Rauschen durch einen Hochpass (Hats, Snares, Riser)';
  if (s.wave === 'sample') {
    const sample = samples.find((x) => x.id === s.sampleId);
    if (!sample) return 'Sampler (das Sample ist nicht mehr in der Library)';
    const extra = [`Grundton ${noteName(s.sampleRoot ?? 60)}`, s.tune ? `${s.tune > 0 ? '+' : ''}${s.tune} Cent` : '', s.gainDb ? `${s.gainDb > 0 ? '+' : ''}${s.gainDb} dB` : '', s.oneShot ? 'One-Shot' : ''].filter(Boolean).join(', ');
    return `Sampler mit „${sample.name}“ (Datei: Samples/Sampler/${samplerFileName(sample)}; ${extra}). Zieh die Datei auf die MIDI-Spur, Live macht einen Simpler daraus: sein Grundton ist ebenfalls C3, bei One-Shot den Modus „One-Shot“ wählen.`;
  }
  const parts = [`Oszillator ${s.wave}`];
  if (s.tableA) parts.push(`Wavetable ${s.tableA}`);
  if (s.unison && s.unison > 1) parts.push(`Unison ${s.unison}`);
  parts.push(`Filter ${Math.round(s.cutoff)} Hz`);
  return `${parts.join(', ')} (in der Set-Spur „… (Audio)“ als Audio mitgeliefert)`;
}

/** What the track's own effects and sends were, and what to put into Live for them. */
export function trackEffectHints(track: Track): string[] {
  const out: string[] = [];
  const fx = track.fx;
  if (fx?.filter) out.push(`DJ-Filter ${fx.filter < 0 ? 'Tiefpass' : 'Hochpass'} ${Math.round(Math.abs(fx.filter) * 100)} % → Auto Filter`);
  if (fx?.drive) out.push(`Drive ${Math.round(fx.drive * 100)} % → Saturator`);
  if (fx?.reverb) out.push(`Hall-Send ${Math.round(fx.reverb * 100)} % → Send an eine Return-Spur mit Reverb`);
  if (fx?.delay) out.push(`Delay-Send ${Math.round(fx.delay * 100)} % → Send an eine Return-Spur mit Echo`);
  if (fx?.pump) out.push(`Pump ${Math.round(fx.pump * 100)} % (${fx.pumpFrom ? 'auf eine andere Spur' : 'auf jeden Beat'}) → ${LIVE_DEVICE.kickstart}`);
  for (const d of track.devices ?? []) out.push(`${deviceDef(d.type).label}${d.on ? '' : ' (aus)'} → ${LIVE_DEVICE[d.type]}`);
  if (track.automation?.length) out.push(`Automation (${track.automation.map((a) => a.param).join(', ')}) wird nicht mit exportiert`);
  return out;
}

/** Everything that does not travel in the files, as plain German text. */
export function projectInfoText(project: Project, samples: Pick<Sample, 'id' | 'name'>[], files: { track: Track; file: string }[], problems: string[] = []): string {
  const lines: string[] = [];
  lines.push(`${project.name}`, '', `Tempo: ${project.bpm} BPM, 4/4`, `Tonart: ${project.key}${project.scale ? `, Skala ${project.scale}` : ''}`, '');
  if (project.markers?.length) {
    lines.push('Marker (Locators):');
    for (const m of [...project.markers].sort((a, b) => a.bar - b.bar)) lines.push(`  Takt ${Math.floor(m.bar) + 1}: ${m.name}`);
    lines.push('');
  }
  lines.push('Spuren:');
  for (const { track, file } of files) {
    const midi = trackKind(track) === 'midi';
    lines.push('', `${file}  (${midi ? 'MIDI' : 'Audio'})`);
    lines.push(`  Name in LOOPVX: ${track.name}`, `  Lautstärke: ${dbText(track.volume)}${track.fx?.pan ? `, Pan ${track.fx.pan < 0 ? 'L' : 'R'} ${Math.round(Math.abs(track.fx.pan) * 100)} %` : ''}`);
    if (midi) lines.push(`  Instrument: ${instrumentText(track, samples)}`);
    if (hasEffects(track)) lines.push(`  Wet-Version (mit den LOOPVX-Effekten, in Live stummgeschaltet): ${file.replace(/\.(wav|mid)$/, midi ? ' Audio wet.wav' : ' wet.wav')}`);
    if (midi && (track.seq?.on || track.arp?.on)) lines.push(`  ${track.seq?.on ? 'Sequencer' : 'Arpeggiator'} ist schon in die Noten eingerechnet: in Live keinen eigenen Arpeggiator davorsetzen.`);
    for (const hint of trackEffectHints(track)) lines.push(`  - ${hint}`);
  }
  if (problems.length) {
    lines.push('', 'NICHT EXPORTIERT / PROBLEME:');
    for (const p of problems) lines.push(`  - ${p}`);
  }
  const master = project.master?.devices ?? [];
  if (master.length) {
    lines.push('', 'Master-Effekte:');
    for (const d of master) lines.push(`  - ${deviceDef(d.type).label}${d.on ? '' : ' (aus)'} → ${LIVE_DEVICE[d.type]}`);
  }
  return lines.join('\n') + '\n';
}

export function readmeText(project: Project, bars: number, folder: string): string {
  return `${project.name} für Ableton Live 12

So geht es:
1. ZIP entpacken. Im Ordner „${folder}“ liegt „${project.name.replace(/[^\w\s+.-]/g, ' ').replace(/\s+/g, ' ').trim() || 'loopvx'}.als“: mit Doppelklick in Live 12 öffnen. Den Ordner nicht umbenennen oder verschieben, die Audiodateien liegen in „Samples/Imported“.
2. Im Set sind schon da: Tempo ${project.bpm} BPM, alle Spuren mit Name, Lautstärke und Pan, die Clips an ihrer Stelle (${Math.ceil(bars)} Takte), die MIDI-Noten, die Marker und die zwei Sends (A Reverb, B Delay) mit dem Hall- und Delay-Anteil aus LOOPVX.
   - Audiospuren: ohne die LOOPVX-Effekte („dry“), deine Ableton-Plugins setzt du selbst davor. Hatte eine Spur Effekte, steht dahinter zusätzlich eine stummgeschaltete Spur „… (wet)“ mit dem Klang inklusive Effekten, Hall- und Delay-Anteil (ohne Lautstärke und Pan): zum Vergleichen oder falls du den LOOPVX-Klang behalten willst.
   - MIDI-Spuren: mit Noten (Sequencer und Arpeggiator sind schon eingerechnet), aber ohne Instrument. Damit du es trotzdem hörst, steht direkt dahinter eine Audiospur „… (Audio)“ mit dem LOOPVX-Klang dieser Spur (Synth, Sampler, Drums, ohne Effekte). Willst du stattdessen ein Ableton-Instrument (Wavetable, Operator, Serum 2 …): Instrument auf die MIDI-Spur ziehen und die Audiospur „(Audio)“ stummschalten.
   - Sampler: das Sample liegt in „Samples/Sampler“. Ziehe es auf die MIDI-Spur, dann macht Live einen Simpler daraus (Grundton und Einstellungen stehen in „Projekt-Info.txt“).
3. „Referenz Mixdown.wav“ ist der fertige Mix aus LOOPVX mit allen Effekten, zum Vergleichen (nicht im Set).
4. „Projekt-Info.txt“ listet pro Spur Instrument und Effekte aus LOOPVX mit dem passenden Live-Gerät. Automation wird nicht übertragen.

Falls Live das Set nicht öffnet oder Dateien als fehlend meldet: die Audiodateien liegen in „Samples/Imported“ und die MIDI-Dateien in „MIDI“. Ziehe sie bei Takt 1 in ein neues Set auf ${project.bpm} BPM (die Audiodateien sind schon auf dieses Tempo gedehnt).
`;
}
