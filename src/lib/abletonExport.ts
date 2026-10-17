import { applyNoteFx } from '../audio/notefx';
import { deviceDef } from '../audio/devices';
import type { DeviceType, Note, Project, Sample, Track } from '../types';
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

/** A track that has something to export: at least one clip that is not deactivated. */
export const exportableTracks = (project: Project): Track[] => project.tracks.filter((t) => t.clips.some((c) => !c.muted));

const dbText = (volume: number) => (volume <= 0.0005 ? '-inf dB' : `${(20 * Math.log10(volume)).toFixed(1)} dB`);

/** The instrument of a MIDI track in a few words, for the info file. */
export function instrumentText(track: Track, samples: Pick<Sample, 'id' | 'name'>[]): string {
  const s = track.synth;
  if (!s) return 'kein Instrument gesetzt';
  if (s.wave === 'kit909') return '909-Drum-Maschine (Noten wie im Drum Rack: Kick C1 = 36, Snare D1, Clap D#1, Hats F#1/A#1)';
  if (s.wave === 'kick') return 'synthetischer Kick';
  if (s.wave === 'noise') return 'Rauschen durch einen Hochpass (Hats, Snares, Riser)';
  if (s.wave === 'sample') return `Sampler mit „${samples.find((x) => x.id === s.sampleId)?.name ?? 'einem Sample'}“`;
  const parts = [`Oszillator ${s.wave}`];
  if (s.tableA) parts.push(`Wavetable ${s.tableA}`);
  if (s.unison && s.unison > 1) parts.push(`Unison ${s.unison}`);
  parts.push(`Filter ${Math.round(s.cutoff)} Hz`);
  return parts.join(', ');
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
export function projectInfoText(project: Project, samples: Pick<Sample, 'id' | 'name'>[], files: { track: Track; file: string }[]): string {
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
    if (midi && (track.seq?.on || track.arp?.on)) lines.push(`  ${track.seq?.on ? 'Sequencer' : 'Arpeggiator'} ist schon in die Noten eingerechnet: in Live keinen eigenen Arpeggiator davorsetzen.`);
    for (const hint of trackEffectHints(track)) lines.push(`  - ${hint}`);
  }
  const master = project.master?.devices ?? [];
  if (master.length) {
    lines.push('', 'Master-Effekte:');
    for (const d of master) lines.push(`  - ${deviceDef(d.type).label}${d.on ? '' : ' (aus)'} → ${LIVE_DEVICE[d.type]}`);
  }
  return lines.join('\n') + '\n';
}

export function readmeText(project: Project, bars: number): string {
  return `${project.name} für Ableton Live

So geht es:
1. Neues Live-Set öffnen und das Tempo auf ${project.bpm} BPM stellen (4/4).
2. Alle Dateien aus diesem Ordner ins Arrangement ziehen und bei Takt 1 ablegen (alle sind ${Math.ceil(bars)} Takte lang und beginnen genau auf Takt 1).
   - „.wav“: die Audiospuren, ohne die LOOPVX-Effekte. Lautstärke und Effekte stellst du in Live selbst ein.
   - „.mid“: die MIDI-Spuren. Zieh sie auf eine MIDI-Spur und setz davor einen Synth deiner Wahl (Wavetable, Operator, Serum 2 …).
3. „00 Referenz Mixdown.wav“ ist der fertige Mix aus LOOPVX mit allen Effekten: leg ihn auf eine eigene Spur zum Vergleichen und schalte ihn zum Mischen stumm.
4. In „Projekt-Info.txt“ steht, was nicht in den Dateien steckt: Tonart, Marker, Lautstärken, Instrument und Effekte jeder Spur, mit dem passenden Live-Gerät.

Die Audiodateien sind schon auf ${project.bpm} BPM gedehnt: in Live Warp ausschalten (oder auf „Re-Pitch“ lassen, es ändert nichts).
`;
}
