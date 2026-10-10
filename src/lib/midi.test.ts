import { midiToHz, noteName, readMidiFile, writeMidiFile } from './midi';

describe('MIDI files', () => {
  const notes = [
    { pitch: 36, start: 0, length: 0.25, velocity: 1 },
    { pitch: 36, start: 0.25, length: 0.25, velocity: 0.5 },
    { pitch: 43, start: 1.5, length: 0.125, velocity: 0.8 },
  ];

  it('round-trips notes, tempo and length', () => {
    const file = writeMidiFile(notes, { bpm: 155, lengthBars: 2, name: 'Bassline' });
    const { notes: read, bpm, lengthBars } = readMidiFile(file);
    expect(bpm).toBeCloseTo(155, 1);
    expect(lengthBars).toBe(2);
    expect(read.map((n) => [n.pitch, n.start, n.length])).toEqual(notes.map((n) => [n.pitch, n.start, n.length]));
    expect(read[1].velocity).toBeCloseTo(64 / 127, 3);
  });

  it('writes a standard header: format 0, one track, 96 ticks per quarter', () => {
    const file = writeMidiFile([], { bpm: 120, lengthBars: 1 });
    expect([...file.slice(0, 14)]).toEqual([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96]);
  });

  it('reads running status and note-on with velocity 0 as note-off', () => {
    // 480 ticks per quarter; one track: note on C3, (running status) note "on" vel 0 one quarter later.
    const track = [0x00, 0x90, 60, 100, 0x83, 0x60, 60, 0, 0x00, 0xff, 0x2f, 0x00];
    const bytes = new Uint8Array([
      ...[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 0x01, 0xe0],
      ...[0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length],
      ...track,
    ]);
    const { notes: read, bpm, lengthBars } = readMidiFile(bytes);
    expect(read).toEqual([{ pitch: 60, start: 0, length: 0.25, velocity: 100 / 127 }]);
    expect(bpm).toBeUndefined();
    expect(lengthBars).toBe(1);
  });

  it('rejects other files', () => {
    expect(() => readMidiFile(new Uint8Array([1, 2, 3]))).toThrow('keine gültige MIDI-Datei');
  });

  it('names notes like Ableton and converts to Hz', () => {
    expect(noteName(60)).toBe('C3');
    expect(noteName(69)).toBe('A3');
    expect(noteName(36)).toBe('C1');
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(57)).toBeCloseTo(220);
  });
});
