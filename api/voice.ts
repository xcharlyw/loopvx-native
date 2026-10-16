// Vercel Function: voice cloning with ElevenLabs Instant Voice Cloning.
// POST multipart (name, file, consent=1) creates a voice from the uploaded recording and returns { voiceId, name };
// POST JSON { action: 'delete', voiceId } removes it. The API key stays on the server; callers need a Supabase session.
import { authorize, text } from './_lib/auth';

const ELEVEN = 'https://api.elevenlabs.io/v1';
/** Vercel Functions accept at most ~4.5 MB per request. */
const MAX_BYTES = 4_400_000;

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return text(500, 'ELEVENLABS_API_KEY fehlt auf dem Server');
  const denied = await authorize(req);
  if (denied) return text(401, denied);

  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    const body = (await req.json().catch(() => ({}))) as { action?: string; voiceId?: string };
    if (body.action !== 'delete' || !body.voiceId || !/^[\w-]{6,64}$/.test(body.voiceId)) return text(400, 'Ungültige Anfrage');
    const res = await fetch(`${ELEVEN}/voices/${body.voiceId}`, { method: 'DELETE', headers: { 'xi-api-key': apiKey } });
    if (!res.ok && res.status !== 404) return text(res.status, `ElevenLabs: ${await res.text()}`);
    return json(200, { ok: true });
  }

  let form: FormData;
  try {
    form = (await req.formData()) as unknown as FormData;
  } catch {
    return text(400, 'Ungültige Anfrage');
  }
  if (form.get('consent') !== '1') return text(400, 'Bitte bestätige, dass du die Stimme verwenden darfst (eigene Stimme oder Erlaubnis der Person).');
  const name = String(form.get('name') ?? '').trim().slice(0, 60);
  const file = form.get('file');
  if (!name) return text(400, 'Bitte gib der Stimme einen Namen');
  if (!(file instanceof Blob) || file.size === 0) return text(400, 'Keine Aufnahme erhalten');
  if (file.size > MAX_BYTES) return text(413, 'Die Aufnahme ist zu groß (maximal etwa 4 MB, ungefähr 80 Sekunden)');

  const out = new FormData();
  out.append('name', name);
  out.append('description', 'LOOPVX');
  // noise removal can change the timbre of a clean recording, so it is only on when asked for
  out.append('remove_background_noise', form.get('denoise') === '1' ? 'true' : 'false');
  out.append('files', file, 'voice.wav');
  const res = await fetch(`${ELEVEN}/voices/add`, { method: 'POST', headers: { 'xi-api-key': apiKey }, body: out });
  if (!res.ok) {
    const detail = await res.text();
    if (/missing_permissions|voices_write/.test(detail)) {
      return text(res.status, 'Der ElevenLabs-API-Key darf keine Stimmen anlegen: aktiviere beim Key in ElevenLabs (Developers → API Keys) die Berechtigung „Voices: Write“ (voices_write) oder nimm einen Key ohne Einschränkung, und trag ihn bei Vercel als ELEVENLABS_API_KEY neu ein.');
    }
    return text(res.status, `ElevenLabs: ${detail}`);
  }
  const data = (await res.json()) as { voice_id?: string };
  if (!data.voice_id) return text(502, 'ElevenLabs lieferte keine Stimmen-ID');
  return json(200, { voiceId: data.voice_id, name });
}
