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
}

/** Generate a vocal with the ElevenLabs Music API (via api/vocals) and drop it on the vocal track at the playhead. */
export async function generateVocal(req: VocalRequest): Promise<Sample> {
  const { project, cursor } = getState();
  const session = await getSession();
  if (!session) throw new Error('Bitte zuerst anmelden (Projekte → Mit Google anmelden).');

  const res = await fetch(VOCALS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ ...req, bpm: project.bpm, key: project.key }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(msg || `Generierung fehlgeschlagen (${res.status})`);
  }
  const ext = (res.headers.get('content-type') ?? '').includes('wav') ? 'wav' : 'mp3';
  const data = await res.arrayBuffer();

  const id = `vocal:${uid()}`;
  const short = req.prompt.slice(0, 32).replace(/[^\w\s-]/g, '').trim() || 'vocal';
  const sample = await storeSampleAudio(
    { id, name: `AI Vocal – ${short}.${ext}`, category: 'vocal', bpm: project.bpm, key: project.key, folder: 'AI Vocals', addedAt: Date.now() },
    data,
    ext,
  );
  setSamples([...getState().samples.filter((x) => x.id !== id), sample]);

  const buffer = await engine.loadBuffer(id);
  const length = Math.min(req.bars, sampleLengthBars(buffer.duration, project.bpm, sample.bpm));
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
