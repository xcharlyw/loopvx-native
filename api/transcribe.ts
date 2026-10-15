// Vercel Function: turns sung or rapped vocals into text (lyrics) with Gemini's audio understanding.
// The audio comes as a small mono WAV (see src/lib/transcribe.ts), multipart field "file"; callers must be signed-in LOOPVX users.
import { DEFAULT_MODEL, FALLBACK_MODEL, extractJson, googleMessage } from './arrange';
import { authorize, text } from './_lib/auth';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Vercel Functions accept at most ~4.5 MB per request. */
const MAX_BYTES = 4_400_000;
const retryMs = () => Number(process.env.GEMINI_RETRY_MS ?? 1200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const SYSTEM = `You transcribe sung or rapped vocals into lyrics.
Answer ONLY with one JSON object, no prose: { "language": "de" | "en" | "es" | "pt" | "other", "lines": string[] }.
Rules: write exactly the words that are performed, in the language they are performed in, one line per phrase or bar (about 3-9 words), no timestamps, no speaker labels, no stage directions, no repeated hallucinated lines. Repeated hooks stay repeated because they are sung repeatedly. Where a word is not understandable write "…" instead of guessing. If there is no voice at all, return an empty "lines" array.`;

export interface Transcript {
  language: string;
  lines: string[];
}

/** Keeps only plain text lines (the app shows them in an editable field). */
export function parseTranscript(answer: unknown): Transcript | null {
  const a = answer as { language?: unknown; lines?: unknown } | null;
  if (!a || !Array.isArray(a.lines)) return null;
  const lines = a.lines.filter((x): x is string => typeof x === 'string').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 200);
  return { language: typeof a.language === 'string' ? a.language.slice(0, 8) : 'other', lines };
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return text(500, 'GEMINI_API_KEY fehlt auf dem Server (Vercel → Settings → Environment Variables)');
  const denied = await authorize(req);
  if (denied) return text(401, denied);

  let file: unknown;
  try {
    file = ((await req.formData()) as unknown as FormData).get('file');
  } catch {
    return text(400, 'Ungültige Anfrage');
  }
  if (!(file instanceof Blob) || file.size === 0) return text(400, 'Keine Aufnahme erhalten');
  if (file.size > MAX_BYTES) return text(413, 'Die Aufnahme ist zu groß (maximal etwa 2 Minuten)');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const data = btoa(binary);

  const main = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const light = process.env.GEMINI_FALLBACK_MODEL || FALLBACK_MODEL;
  const attempts = [main, light, main, light].map((model, i) => ({ model, wait: i * retryMs() }));
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data } }, { text: 'Transcribe the lyrics of this vocal.' }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  });
  let res: Response | undefined;
  let model = main;
  for (const attempt of attempts) {
    if (attempt.wait) await sleep(attempt.wait);
    model = attempt.model;
    res = await fetch(`${GEMINI}/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, body: payload });
    if (res.ok || ![429, 500, 503, 504].includes(res.status)) break;
  }
  if (!res || !res.ok) {
    const status = res?.status ?? 502;
    const detail = googleMessage((await res?.text()) ?? '');
    if (status === 429) return text(429, `Gemini-Limit erreicht (429): ${detail}`);
    if (status === 503) return text(503, `Gemini ist gerade überlastet (503), bitte in einer Minute nochmal versuchen. ${detail}`);
    return text(502, `Gemini (${status}) mit ${model}: ${detail}`);
  }
  const answer = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const raw = (answer.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  const transcript = parseTranscript(extractJson(raw));
  if (!transcript) return text(502, 'Gemini hat keinen Text geliefert, bitte nochmal versuchen');
  if (!transcript.lines.length) return text(422, 'In der Aufnahme wurde keine Stimme erkannt');
  return new Response(JSON.stringify({ ...transcript, model }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
