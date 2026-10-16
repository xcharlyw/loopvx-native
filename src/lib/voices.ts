import { engine } from '../audio/engine';
import { encodeWav } from '../audio/wav';
import { VOICE_ENDPOINT } from '../config';
import { db } from '../storage/db';
import { getSession } from './supabase';
import { voiceClip } from './voiceClip';

/** A voice cloned with ElevenLabs; only its id and name are kept on the device (the audio stays in the library). */
export interface Voice {
  id: string;
  name: string;
  addedAt: number;
}

export const loadVoices = async (): Promise<Voice[]> => (await db.getKv<Voice[]>('voices')) ?? [];
const saveVoices = (v: Voice[]) => db.setKv('voices', v);

/** Clone a voice from a library sample (an own recording, an uploaded mp3 or a vocal sample). `consent` must be confirmed by the user. */
export async function cloneVoice(sampleId: string, name: string, consent: boolean, denoise = false): Promise<Voice> {
  if (!consent) throw new Error('Bitte bestätige, dass du die Stimme verwenden darfst (eigene Stimme oder Erlaubnis der Person).');
  if (!name.trim()) throw new Error('Bitte gib der Stimme einen Namen.');
  const session = await getSession();
  if (!session) throw new Error('Bitte zuerst anmelden (Projekte → Mit Google anmelden).');

  const buffer = await engine.loadBuffer(sampleId);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const clip = voiceClip(channels, buffer.sampleRate);
  if (clip.data.length / clip.sampleRate < 5) throw new Error('Die Aufnahme ist zu kurz: für eine gute Stimme brauchst du mindestens etwa eine Minute klare Sprache oder Gesang.');
  const wav = encodeWav({ sampleRate: clip.sampleRate, channels: [clip.data] });

  const form = new FormData();
  form.append('name', name.trim());
  form.append('consent', '1');
  if (denoise) form.append('denoise', '1');
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'voice.wav');
  const res = await fetch(VOICE_ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body: form });
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Klonen fehlgeschlagen (${res.status})`);
  const { voiceId } = (await res.json()) as { voiceId: string };

  const voice: Voice = { id: voiceId, name: name.trim(), addedAt: Date.now() };
  await saveVoices([...(await loadVoices()), voice]);
  return voice;
}

/** Remove a cloned voice at ElevenLabs and on the device. */
export async function removeVoice(id: string): Promise<void> {
  const session = await getSession();
  if (session) {
    const res = await fetch(VOICE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'delete', voiceId: id }),
    });
    if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Löschen fehlgeschlagen (${res.status})`);
  }
  await saveVoices((await loadVoices()).filter((v) => v.id !== id));
}
