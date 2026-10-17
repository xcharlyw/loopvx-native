// Native builds have no Web MIDI (a native MIDI module is future work); the web build uses midiAccess.web.ts.

export interface MidiHandle {
  inputs(): string[];
  close(): void;
}

export const midiSupported = () => false;

export async function openMidi(_onMessage: (data: Uint8Array) => void, _onChange: () => void): Promise<MidiHandle> {
  throw new Error('MIDI-Controller gehen hier nur im Browser (Chrome am PC oder Android).');
}
