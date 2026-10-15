import { engine } from '../audio/engine';
import { sampleLengthBars } from '../audio/timing';
import { VOCALS_ENDPOINT } from '../config';
import type { Sample } from '../types';
import { addClip, createTrack, uid } from './project';
import { storeSampleAudio } from './samples';
import { getState, setSamples, updateProject } from './store';
import { getSession } from './supabase';

export interface VocalRequest {
  prompt: string;
  lyrics: string;
  bars: number;
  vocalsOnly: boolean;
  /** A cloned voice (lib/voices.ts): the generated vocal is sung in it. */
  voiceId?: string;
  /** Name of that voice, only for the sample name and the message. */
  voiceName?: string;
  /** With a voice the text is spoken in it (a cloned voice does not sing); without, these steer the AI vocal. */
  gender?: 'male' | 'female';
  style?: 'rap' | 'spoken' | 'sing';
  language?: 'de' | 'es' | 'en';
  /** Knobs for the spoken voice: stability and expression 0..1, speed 0.7..1.2. */
  stability?: number;
  expression?: number;
  speed?: number;
}

/** Generate a vocal with the ElevenLabs Music API (via api/vocals) and drop it on the vocal track at the playhead. */
export async function generateVocal(req: VocalRequest): Promise<Sample> {
  const { project, cursor } = getState();
  const session = await getSession();
  if (!session) throw new Error('Bitte zuerst anmelden (Projekte → Mit Google anmelden).');

  const res = await fetch(VOCALS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ prompt: req.prompt, lyrics: req.lyrics, bars: req.bars, vocalsOnly: req.vocalsOnly, voiceId: req.voiceId, speak: !!req.voiceId, gender: req.gender, style: req.style, language: req.language, stability: req.stability, expression: req.expression, speed: req.speed, bpm: project.bpm, key: project.key }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(msg || `Generierung fehlgeschlagen (${res.status})`);
  }
  if (req.voiceId && res.headers.get('x-voice-id') !== req.voiceId) {
    throw new Error('Die geklonte Stimme wurde vom Server nicht angewendet (die Funktion ist noch nicht auf dem neuesten Stand). Bitte kurz warten und noch einmal versuchen.');
  }
  const ext = (res.headers.get('content-type') ?? '').includes('wav') ? 'wav' : 'mp3';
  const data = await res.arrayBuffer();

  const id = `vocal:${uid()}`;
  const short = req.prompt.slice(0, 32).replace(/[^\w\s-]/g, '').trim() || 'vocal';
  const sample = await storeSampleAudio(
    { id, name: `${req.voiceId ? `Stimme ${req.voiceName ?? ''} – ` : 'AI Vocal – '}${short}.${ext}`, category: 'vocal', ...(req.voiceId ? {} : { bpm: project.bpm, key: project.key }), folder: 'AI Vocals', addedAt: Date.now() },
    data,
    ext,
  );
  setSamples([...getState().samples.filter((x) => x.id !== id), sample]);

  const buffer = await engine.loadBuffer(id);
  // generated vocals are cut to the chosen bars; spoken ones keep their natural length (rounded up to whole bars)
  const length = req.voiceId ? Math.max(1, Math.ceil(sampleLengthBars(buffer.duration, project.bpm))) : Math.min(req.bars, sampleLengthBars(buffer.duration, project.bpm, sample.bpm));
  updateProject((p) => {
    let track = p.tracks.find((t) => t.category === 'vocal');
    let next = p;
    if (!track) {
      track = createTrack('vocal', p.sceneCount);
      next = { ...p, tracks: [...p.tracks, track] };
    }
    return addClip(next, track.id, { id: uid(), sampleId: id, start: Math.floor(cursor), length, offset: 0 });
  });
  return sample;
}
