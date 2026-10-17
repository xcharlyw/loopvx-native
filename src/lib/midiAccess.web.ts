import type { MidiHandle } from './midiAccess';

// Web MIDI (Chrome, Edge, Opera on desktop and Android; not Safari or any browser on iOS). The browser asks for permission.

export type { MidiHandle };

interface WebMidiInput {
  id: string;
  name?: string | null;
  state?: string;
  onmidimessage: ((e: { data: Uint8Array }) => void) | null;
}
interface WebMidiAccess {
  inputs: Map<string, WebMidiInput>;
  onstatechange: (() => void) | null;
}

const request = () => (typeof navigator !== 'undefined' ? (navigator as unknown as { requestMIDIAccess?: () => Promise<WebMidiAccess> }).requestMIDIAccess?.bind(navigator) : undefined);

export const midiSupported = () => !!request();

/** Listen to every connected input (and the ones plugged in later). `onChange` fires when a device appears or goes. */
export async function openMidi(onMessage: (data: Uint8Array) => void, onChange: () => void): Promise<MidiHandle> {
  const ask = request();
  if (!ask) throw new Error('Dieser Browser kann kein Web MIDI. Nimm Chrome am PC oder Android.');
  let access: WebMidiAccess;
  try {
    access = await ask();
  } catch {
    throw new Error('Kein Zugriff auf MIDI. Erlaube ihn in den Browser-Einstellungen für diese Seite.');
  }
  const attach = () => {
    for (const input of access.inputs.values()) input.onmidimessage = (e) => onMessage(e.data);
  };
  attach();
  access.onstatechange = () => {
    attach();
    onChange();
  };
  return {
    inputs: () => [...access.inputs.values()].filter((i) => i.state !== 'disconnected').map((i) => i.name || 'MIDI-Eingang'),
    close() {
      access.onstatechange = null;
      for (const input of access.inputs.values()) input.onmidimessage = null;
    },
  };
}
