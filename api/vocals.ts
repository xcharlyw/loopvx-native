// Vercel Function: generates vocals with the ElevenLabs Music API.
// The API key never reaches the browser. Requests must carry a Supabase session token,
// optionally restricted to ALLOWED_EMAILS (see _lib/auth.ts), so nobody else can spend your credits.
import { unzipSync } from 'fflate';
import { authorize, text } from './_lib/auth';

const ELEVEN = 'https://api.elevenlabs.io/v1';

interface Body {
  prompt?: string;
  lyrics?: string;
  bpm?: number;
  key?: string;
  bars?: number;
  vocalsOnly?: boolean;
}

export function buildPrompt(b: Body): string {
  const parts = [b.prompt?.trim() || 'Powerful female vocal hook for a hard techno track'];
  if (b.bpm) parts.push(`Tempo exactly ${b.bpm} BPM.`);
  if (b.key) parts.push(`Key: ${b.key}.`);
  if (b.vocalsOnly) parts.push('Focus on a clear, upfront lead vocal with minimal backing.');
  if (b.lyrics?.trim()) parts.push(`Lyrics (sing these words clearly): "${b.lyrics.trim()}"`);
  return parts.join(' ').slice(0, 4000);
}

export function lengthMs(bars: number | undefined, bpm: number | undefined): number {
  const ms = ((bars ?? 8) * 4 * 60 * 1000) / (bpm || 150);
  return Math.round(Math.min(600_000, Math.max(3_000, ms)));
}

function pickVocalStem(zip: Uint8Array): { name: string; data: Uint8Array } | null {
  const files = Object.entries(unzipSync(zip)).filter(([name, data]) => data.length > 0 && !name.endsWith('/'));
  if (!files.length) return null;
  const vocal = files.find(([name]) => /vocal|voice|vox/i.test(name)) ?? files[0];
  return { name: vocal[0], data: vocal[1] };
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return text(500, 'ELEVENLABS_API_KEY fehlt auf dem Server');
  const denied = await authorize(req);
  if (denied) return text(401, denied);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return text(400, 'Ungültige Anfrage');
  }

  const music = await fetch(`${ELEVEN}/music`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: buildPrompt(body),
      music_length_ms: lengthMs(body.bars, body.bpm),
      model_id: process.env.ELEVENLABS_MUSIC_MODEL ?? 'music_v2_5',
      force_instrumental: false,
    }),
  });
  if (!music.ok) return text(music.status, `ElevenLabs: ${await music.text()}`);
  let audio: Uint8Array = new Uint8Array(await music.arrayBuffer());
  let type = music.headers.get('content-type') ?? 'audio/mpeg';

  if (body.vocalsOnly) {
    const form = new FormData();
    form.append('file', new Blob([audio as BlobPart], { type }), 'song.mp3');
    form.append('stem_variation_id', 'two_stems_v1');
    const stems = await fetch(`${ELEVEN}/music/stem-separation`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    });
    if (!stems.ok) return text(stems.status, `ElevenLabs Stem-Trennung: ${await stems.text()}`);
    const vocal = pickVocalStem(new Uint8Array(await stems.arrayBuffer()));
    if (!vocal) return text(502, 'Stem-Trennung lieferte keine Dateien');
    audio = vocal.data;
    type = /\.wav$/i.test(vocal.name) ? 'audio/wav' : 'audio/mpeg';
  }

  return new Response(audio as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Song-Id': music.headers.get('song-id') ?? '',
    },
  });
}
