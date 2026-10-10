import { BEATS_PER_BAR } from '../config';
import type { Note } from '../types';

// Standard MIDI Files (.mid): what Ableton, Serum and every DAW read and write.
// Positions in this app are bars (4/4); files count ticks per quarter note.

const PPQ = 96;
const TICKS_PER_BAR = PPQ * BEATS_PER_BAR;

/** MIDI note number to frequency (A4 = note 69 = 440 Hz). */
export const midiToHz = (pitch: number) => 440 * Math.pow(2, (pitch - 69) / 12);

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Note name the way Ableton shows it: middle C (60) is C3. */
export const noteName = (pitch: number) => `${NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 2}`;

// ---------------- writing ----------------

function varLen(value: number): number[] {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  while ((v >>= 7)) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
}

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0) & 0x7f);

/** A format-0 file with tempo, 4/4, the clip name and its notes; the track ends at the clip end. */
export function writeMidiFile(notes: Note[], opts: { bpm: number; lengthBars: number; name?: string }): Uint8Array {
  type Ev = { tick: number; order: number; bytes: number[] };
  const events: Ev[] = [];
  const usPerQuarter = Math.round(60_000_000 / opts.bpm);
  events.push({ tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff] });
  events.push({ tick: 0, order: 0, bytes: [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08] });
  if (opts.name) {
    const name = ascii(opts.name).slice(0, 100);
    events.push({ tick: 0, order: 0, bytes: [0xff, 0x03, ...varLen(name.length), ...name] });
  }
  for (const n of notes) {
    const on = Math.round(n.start * TICKS_PER_BAR);
    const off = Math.max(on + 1, Math.round((n.start + n.length) * TICKS_PER_BAR));
    const pitch = Math.max(0, Math.min(127, Math.round(n.pitch)));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
    // At the same tick, note-offs go before note-ons so repeated notes retrigger.
    events.push({ tick: on, order: 2, bytes: [0x90, pitch, vel] });
    events.push({ tick: off, order: 1, bytes: [0x80, pitch, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const end = Math.max(Math.round(opts.lengthBars * TICKS_PER_BAR), events[events.length - 1]?.tick ?? 0);
  const track: number[] = [];
  let last = 0;
  for (const e of events) {
    track.push(...varLen(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  track.push(...varLen(end - last), 0xff, 0x2f, 0x00);
  return new Uint8Array([...ascii('MThd'), ...u32(6), 0, 0, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff, ...ascii('MTrk'), ...u32(track.length), ...track]);
}

// ---------------- reading ----------------

/** Notes from every track (channels merged), the first tempo, and the length rounded up to whole bars. */
export function readMidiFile(bytes: Uint8Array): { notes: Note[]; bpm?: number; lengthBars: number } {
  const fail = () => {
    throw new Error('Das ist keine gültige MIDI-Datei.');
  };
  const str = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  const read32 = (at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  if (bytes.length < 14 || str(0) !== 'MThd') fail();
  const headerLen = read32(4);
  const division = (bytes[12] << 8) | bytes[13];
  if (division & 0x8000) throw new Error('MIDI-Dateien mit SMPTE-Zeitbasis werden nicht unterstützt.');
  const ticksPerBar = division * BEATS_PER_BAR;

  const notes: Note[] = [];
  let bpm: number | undefined;
  let endTick = 0;
  let pos = 8 + headerLen;
  while (pos + 8 <= bytes.length) {
    const len = read32(pos + 4);
    const chunkEnd = Math.min(bytes.length, pos + 8 + len);
    if (str(pos) !== 'MTrk') {
      pos = chunkEnd;
      continue;
    }
    let p = pos + 8;
    let tick = 0;
    let status = 0;
    const open = new Map<number, { tick: number; vel: number }[]>(); // channel*128 + pitch
    const readVar = () => {
      let v = 0;
      for (let i = 0; i < 4 && p < chunkEnd; i++) {
        const b = bytes[p++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return v;
    };
    while (p < chunkEnd) {
      tick += readVar();
      let b = bytes[p];
      if (b & 0x80) {
        p++;
        if (b < 0xf0) status = b; // running status only for channel messages
      } else {
        b = status; // running status: this byte is already data
      }
      if (b === 0xff) {
        const type = bytes[p++];
        const n = readVar();
        if (type === 0x51 && n === 3 && bpm === undefined) bpm = Math.round((60_000_000 / ((bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2])) * 100) / 100;
        p += n;
      } else if (b === 0xf0 || b === 0xf7) {
        p += readVar();
      } else {
        const kind = b & 0xf0;
        const channel = b & 0x0f;
        const d1 = bytes[p++];
        const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[p++];
        const key = channel * 128 + d1;
        if (kind === 0x90 && d2 > 0) {
          (open.get(key) ?? open.set(key, []).get(key)!).push({ tick, vel: d2 });
        } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
          const started = open.get(key)?.shift();
          if (started) {
            notes.push({ pitch: d1, start: started.tick / ticksPerBar, length: Math.max(1, tick - started.tick) / ticksPerBar, velocity: started.vel / 127 });
          }
        }
      }
      endTick = Math.max(endTick, tick);
    }
    pos = chunkEnd;
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const lastNoteEnd = notes.reduce((m, n) => Math.max(m, n.start + n.length), 0);
  const lengthBars = Math.max(1, Math.ceil(Math.max(lastNoteEnd, endTick / ticksPerBar) - 1e-6));
  return { notes, bpm, lengthBars };
}
