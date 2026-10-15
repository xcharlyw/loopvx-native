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
  /** A cloned voice (see voice.ts): the generated vocal is converted to it with the Voice Changer. */
  voiceId?: string;
  /** With a voice: speak the text in it (Text-to-Speech) instead of generating a song; a cloned voice does not sing. */
  speak?: boolean;
  gender?: 'male' | 'female';
  style?: 'rap' | 'spoken' | 'sing';
  language?: 'de' | 'es' | 'en';
  /** Spoken-voice settings, 0..1 (speed 0.7..1.2). */
  stability?: number;
  expression?: number;
  speed?: number;
}

const LANGUAGE_NAME = { de: 'German', es: 'Spanish', en: 'English' } as const;
const STYLE_TEXT = { rap: 'rapped, rhythmic rap delivery', spoken: 'spoken word, talking, not sung', sing: 'sung melodic' } as const;

/** Gender, delivery and language as a sentence for the music prompt. */
export function traitsText(b: Body): string {
  const parts: string[] = [];
  if (b.gender === 'male' || b.gender === 'female') parts.push(`${b.gender === 'male' ? 'Male' : 'Female'} vocalist`);
  if (b.style && STYLE_TEXT[b.style]) parts.push(`${STYLE_TEXT[b.style]} vocal`);
  if (b.language && LANGUAGE_NAME[b.language]) parts.push(`in ${LANGUAGE_NAME[b.language]} language, ${LANGUAGE_NAME[b.language]} lyrics only`);
  return parts.length ? `${parts.join(', ')}.` : '';
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);

/** ElevenLabs Text-to-Speech settings from the knobs; rap runs a bit faster than plain speech unless the knob says otherwise. */
export function speechSettings(b: Body) {
  const rap = b.style === 'rap';
  return {
    stability: clamp(b.stability, 0, 1, rap ? 0.35 : 0.5),
    similarity_boost: 0.85,
    style: clamp(b.expression, 0, 1, rap ? 0.6 : 0.3),
    speed: clamp(b.speed, 0.7, 1.2, rap ? 1.1 : 1),
    use_speaker_boost: true,
  };
}

export function buildPrompt(b: Body): string {
  const parts = [b.prompt?.trim() || 'Powerful female vocal hook for a hard techno track'];
  const traits = traitsText(b);
  if (traits) parts.push(traits);
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

  if (body.speak) {
    if (!body.voiceId || !/^[\w-]{6,64}$/.test(body.voiceId)) return text(400, 'Ungültige Stimmen-ID');
    const words = (body.lyrics?.trim() || body.prompt?.trim() || '').slice(0, 2500);
    if (!words) return text(400, 'Bitte gib den Text ein, den deine Stimme sprechen soll');
    const model = process.env.ELEVENLABS_TTS_MODEL ?? 'eleven_multilingual_v2';
    const tts = await fetch(`${ELEVEN}/text-to-speech/${body.voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: words,
        model_id: model,
        voice_settings: speechSettings(body),
        // the multilingual model finds the language in the text; the faster models take it explicitly
        ...(body.language && /turbo|flash/.test(model) ? { language_code: body.language } : {}),
      }),
    });
    if (!tts.ok) return text(tts.status, `ElevenLabs Sprechen: ${await tts.text()}`);
    return new Response(await tts.arrayBuffer(), {
      status: 200,
      headers: { 'Content-Type': tts.headers.get('content-type') ?? 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice-Id': body.voiceId },
    });
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

  if (body.voiceId && !/^[\w-]{6,64}$/.test(body.voiceId)) return text(400, 'Ungültige Stimmen-ID');
  // A voice change needs the vocal on its own, so a cloned voice always works on the separated vocal.
  if (body.vocalsOnly || body.voiceId) {
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

  if (body.voiceId) {
    const sts = new FormData();
    sts.append('audio', new Blob([audio as BlobPart], { type }), /wav/.test(type) ? 'vocal.wav' : 'vocal.mp3');
    sts.append('model_id', process.env.ELEVENLABS_STS_MODEL ?? 'eleven_multilingual_sts_v2');
    sts.append('remove_background_noise', 'true');
    const converted = await fetch(`${ELEVEN}/speech-to-speech/${body.voiceId}`, { method: 'POST', headers: { 'xi-api-key': apiKey }, body: sts });
    if (!converted.ok) return text(converted.status, `ElevenLabs Stimmen-Wechsel: ${await converted.text()}`);
    audio = new Uint8Array(await converted.arrayBuffer());
    type = converted.headers.get('content-type') ?? 'audio/mpeg';
  }

  return new Response(audio as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Song-Id': music.headers.get('song-id') ?? '',
      // Tells the app the vocal really went through the cloned voice.
      ...(body.voiceId ? { 'X-Voice-Id': body.voiceId } : {}),
    },
  });
}
