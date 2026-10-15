import { engine } from '../audio/engine';
import { encodeWav } from '../audio/wav';
import { TRANSCRIBE_ENDPOINT } from '../config';
import { monoClip } from './voiceClip';
import { getSession } from './supabase';

/** 16 kHz mono 16-bit WAV is 32 KB per second; 120 s stay under the 4.4 MB a function accepts. */
const MAX_SECONDS = 120;

export interface Transcript {
  language: string;
  lines: string[];
}

/** Sung or rapped vocals of a library sample as text (Gemini listens to the audio through api/transcribe). */
export async function transcribeSample(sampleId: string): Promise<Transcript> {
  const session = await getSession();
  if (!session) throw new Error('Bitte zuerst anmelden (Projekte → Mit Google anmelden).');
  const buffer = await engine.loadBuffer(sampleId);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const clip = monoClip(channels, buffer.sampleRate, 16000, MAX_SECONDS);
  if (clip.data.length / clip.sampleRate < 1) throw new Error('Die Aufnahme ist zu kurz.');
  const wav = encodeWav({ sampleRate: clip.sampleRate, channels: [clip.data] });
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'vocal.wav');
  const res = await fetch(TRANSCRIBE_ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body: form });
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Umwandeln fehlgeschlagen (${res.status})`);
  return (await res.json()) as Transcript;
}
