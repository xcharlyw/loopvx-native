import { gzipSync, strToU8 } from 'fflate';
import type { Note } from '../../types';
import { ALS_AUDIO_CLIP, ALS_AUDIO_TRACK, ALS_BASE_POINTEE, ALS_MIDI_CLIP, ALS_MIDI_TRACK, ALS_RETURNS, ALS_SKELETON } from './templates';

// An Ableton Live 12 set (.als = gzipped XML) from a LOOPVX project: tracks with volume, pan and sends, arrangement clips
// (audio as pieces of one dry WAV per track, MIDI with its notes), tempo and locators. Built by filling templates that were
// taken from a real Live 12.3.7 set (`templates.ts`), so the structure is Live's own. Positions and lengths in bars (4/4),
// Live counts beats. No devices yet: the audio is dry, the MIDI tracks have no instrument.

const BEATS = 4;
const MIN_SEND = 0.0003162277571; // Live's "-inf"
const MAX_VOLUME = 1.99526238;

export interface AlsAudio {
  /** Path of the WAV relative to the project folder ("Samples/Imported/01 Kick.wav"). */
  relPath: string;
  bytes: number;
  frames: number;
  sampleRate: number;
  /** Unix seconds. */
  modDate: number;
  /** Length of the WAV in bars: it starts on bar 1 of the arrangement. */
  totalBars: number;
  clips: { start: number; length: number }[];
}
export interface AlsMidiClip {
  start: number;
  length: number;
  /** Positions relative to the clip start, in bars. */
  notes: Note[];
}
export interface AlsTrack {
  name: string;
  /** Live's colour index 0..69. */
  color: number;
  /** Linear gain (1 = 0 dB). */
  volume: number;
  /** -1 (left) … 1 (right). */
  pan: number;
  /** Send levels to the two return tracks (reverb, delay), 0..1. */
  sends: [number, number];
  audio?: AlsAudio;
  midi?: { clips: AlsMidiClip[] };
}
export interface AlsInput {
  bpm: number;
  tracks: AlsTrack[];
  /** Locators; `bar` is 0-based. */
  markers: { bar: number; name: string }[];
}

const num = (x: number) => String(Number(x.toFixed(9)));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));

/** Replaces every {{KEY}} (values must already be escaped). */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = values[key];
    if (v === undefined) throw new Error(`Live-Set: Platzhalter ${key} ohne Wert`);
    return v;
  });
}

/** Hands out the ids Live wants unique across the whole set (tracks, automation and modulation targets). */
class Ids {
  private next = ALS_BASE_POINTEE;
  take = () => this.next++;
  get nextFree() {
    return this.next;
  }
  /** Gives every automation/modulation target and pointee in `xml` a fresh id. */
  renumber(xml: string): string {
    return xml.replace(/(<(?:\w*AutomationTarget|\w*ModulationTarget|Pointee) Id=")\d+(")/g, (_m, a: string, b: string) => `${a}${this.take()}${b}`);
  }
}

/**
 * The pieces of the WAV that the clips show. Live does not allow two clips on top of each other: an earlier clip ends where the
 * next one starts (both play the same stretch of the same file, so nothing is lost).
 */
export function audioRegions(clips: { start: number; length: number }[]): { start: number; length: number }[] {
  const sorted = clips.filter((c) => c.length > 1e-9).sort((a, b) => a.start - b.start);
  const out: { start: number; length: number }[] = [];
  for (const [i, c] of sorted.entries()) {
    const next = sorted[i + 1];
    const end = Math.min(c.start + c.length, next ? next.start : Infinity);
    if (end - c.start > 1e-9) out.push({ start: c.start, length: end - c.start });
  }
  return out;
}

/** MIDI clips without overlap (an earlier clip is shortened, its notes cut with it) and without empty ones. */
export function midiRegions(clips: AlsMidiClip[]): AlsMidiClip[] {
  const sorted = clips.filter((c) => c.length > 1e-9).sort((a, b) => a.start - b.start);
  return sorted.map((c, i) => {
    const next = sorted[i + 1];
    const length = Math.min(c.length, next ? next.start - c.start : Infinity);
    const notes = c.notes.filter((n) => n.start < length - 1e-9).map((n) => ({ ...n, length: Math.min(n.length, length - n.start) }));
    return { ...c, length, notes };
  }).filter((c) => c.length > 1e-9);
}

/** <KeyTrack> blocks: one per pitch, notes in beats. */
export function keyTracksXml(notes: Note[]): string {
  const byPitch = new Map<number, Note[]>();
  for (const n of notes) {
    const p = Math.max(0, Math.min(127, Math.round(n.pitch)));
    byPitch.set(p, [...(byPitch.get(p) ?? []), n]);
  }
  let noteId = 1;
  return [...byPitch.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pitch, list], i) => {
      const events = list
        .sort((a, b) => a.start - b.start)
        .map((n) => `<MidiNoteEvent Time="${num(n.start * BEATS)}" Duration="${num(Math.max(n.length * BEATS, 0.0625))}" Velocity="${Math.max(1, Math.min(127, Math.round(n.velocity * 127)))}" OffVelocity="64" NoteId="${noteId++}" />`)
        .join('');
      return `<KeyTrack Id="${i}"><Notes>${events}</Notes><MidiKey Value="${pitch}" /></KeyTrack>`;
    })
    .join('');
}

function audioClipsXml(track: AlsTrack, audio: AlsAudio, bpm: number): string {
  const totalBeats = audio.totalBars * BEATS;
  return audioRegions(audio.clips)
    .map((c, i) =>
      fill(ALS_AUDIO_CLIP, {
        CLIPID: String(i),
        START: num(c.start * BEATS),
        END: num((c.start + c.length) * BEATS),
        // the clip shows the stretch of the file that lies under it: the file starts on bar 1
        LOOPSTART: num(c.start * BEATS),
        LOOPEND: num((c.start + c.length) * BEATS),
        OUTMARKER: num(totalBeats),
        NAME: esc(track.name),
        COLOR: String(track.color),
        RELPATH: esc(audio.relPath),
        ABSPATH: esc(audio.relPath),
        FILESIZE: String(audio.bytes),
        MODDATE: String(Math.round(audio.modDate)),
        FRAMES: String(audio.frames),
        RATE: String(audio.sampleRate),
        SEC: num((totalBeats * 60) / bpm),
        BEATS: num(totalBeats),
      }),
    )
    .join('');
}

function midiClipsXml(track: AlsTrack, clips: AlsMidiClip[]): string {
  return midiRegions(clips)
    .map((c, i) =>
      fill(ALS_MIDI_CLIP, {
        CLIPID: String(i),
        START: num(c.start * BEATS),
        END: num((c.start + c.length) * BEATS),
        LEN: num(c.length * BEATS),
        NAME: esc(track.name),
        COLOR: String(track.color),
        KEYTRACKS: keyTracksXml(c.notes),
        NEXTNOTE: String(c.notes.length + 1),
      }),
    )
    .join('');
}

/** The Live set as XML text. */
export function buildLiveSetXml(input: AlsInput): string {
  const ids = new Ids();
  const tracks = input.tracks
    .map((t) => {
      const midi = !!t.midi;
      const clips = midi ? midiClipsXml(t, t.midi!.clips) : audioClipsXml(t, t.audio!, input.bpm);
      const xml = fill(midi ? ALS_MIDI_TRACK : ALS_AUDIO_TRACK, {
        TRACKID: '@@TRACKID@@',
        NAME: esc(t.name),
        COLOR: String(t.color),
        VOLUME: num(clamp(t.volume, 0, MAX_VOLUME)),
        PAN: num(clamp(t.pan, -1, 1)),
        SEND0: num(clamp(t.sends[0], MIN_SEND, 1)),
        SEND1: num(clamp(t.sends[1], MIN_SEND, 1)),
        DEVICES: '',
        CLIPS: clips,
      });
      return ids.renumber(xml).replace('@@TRACKID@@', String(ids.take()));
    })
    .join('');
  const locators = [...input.markers]
    .sort((a, b) => a.bar - b.bar)
    .map((m, i) => `<Locator Id="${i}"><LomId Value="0" /><Time Value="${num(m.bar * BEATS)}" /><Name Value="${esc(m.name)}" /><Annotation Value="" /><IsSongStart Value="false" /></Locator>`)
    .join('');
  const xml = fill(ALS_SKELETON, {
    NEXTPOINTEE: String(ids.nextFree),
    TRACKS: tracks,
    RETURNS: ALS_RETURNS,
    TEMPO: num(clamp(input.bpm, 20, 999)),
    LOCATORS: locators ? `<Locators>${locators}</Locators>` : '<Locators />',
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}\n`;
}

/** The .als file: the XML, gzipped. */
export const buildLiveSet = (input: AlsInput): Uint8Array => gzipSync(strToU8(buildLiveSetXml(input)), { level: 6 });
