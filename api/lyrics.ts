// Vercel Function: endless lyric / hook ideas for AI vocals with Gemini.
// The key (GEMINI_API_KEY) stays on the server; callers must be signed-in LOOPVX users (see _lib/auth.ts).
import { DEFAULT_MODEL, FALLBACK_MODEL, extractJson, googleMessage } from './arrange';
import { authorize, text } from './_lib/auth';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
const retryMs = () => Number(process.env.GEMINI_RETRY_MS ?? 1200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Body {
  /** A theme or a few words ("Hitze, Nacht, Kontrolle"), optional: without it the model picks its own. */
  theme?: string;
  language?: 'de' | 'es' | 'en';
  gender?: 'male' | 'female';
  style?: 'rap' | 'spoken' | 'sing';
  genre?: 'techno' | 'hard-techno' | 'melodic-techno' | 'tech-house' | 'house' | 'trance';
  /** Only the vocal is generated: the style prompt then describes just the voice. */
  vocalsOnly?: boolean;
  /** How many ideas (1..8) and how many lines each (2..8). */
  count?: number;
  lines?: number;
  /** Titles already shown, so "more ideas" are new ones. */
  avoid?: string[];
}

export interface LyricIdea {
  title: string;
  genre: string;
  lines: string[];
  stylePrompt: string;
}

const LANGUAGE = { de: 'German', es: 'Spanish', en: 'English' } as const;

const GENRE = { techno: 'techno', 'hard-techno': 'hard techno', 'melodic-techno': 'melodic techno', 'tech-house': 'tech house', house: 'house', trance: 'trance' } as const;

const BASE = `You write short, high-energy hook lyrics and matching AI-music style prompts for techno / rave vocals (hard techno, peak-time, dark club, neo rave).
Answer ONLY with one JSON object, no prose, of this shape:
{ "ideas": [ { "title": string, "genre": string, "lines": string[], "stylePrompt": string } ] }
Rules for "lines": a catchy, hypnotic, DJ-friendly hook, short punchy lines (3-7 words), a clear rhyme scheme (AABB or ABAB), repetition is welcome, a strong last line that works twice before the drop. No filler, no clichés about "dancing all night" only; every idea needs its own image and mood.
Rules for "title": 1-3 words, upper case.
Rules for "genre": e.g. "Dark Techno / Peak-Time", "Hard Techno / Rave", "Melodic Techno / Dark Club".
Never put a BPM number or a tempo into "stylePrompt", and never name the language of the lyrics in it.
@@STYLE@@
Example idea:
{ "title": "DARK DESIRE", "genre": "Dark Techno / Peak-Time", "lines": ["Feel the pressure, feel the heat,","Dirty rhythm, moving feet,","Take me higher, no retreat,","Lose your mind inside the beat."], "stylePrompt": "@@EXAMPLE@@" }
Keep it tasteful for a club: sensual and dark is fine, nothing hateful or explicit.`;

const STYLE_FULL = 'Rules for "stylePrompt": ONE English paragraph for an AI music generator: the genre, the vocal (gender, voice texture, delivery such as spoken rap or whisper-rap), the bass and kick, synths, percussion, atmosphere and drop, ending with "no pop singing, no acoustic instruments".';
const STYLE_VOCAL = 'Rules for "stylePrompt": ONE short English paragraph that describes ONLY the voice for an AI vocal generator: gender, voice texture, delivery (spoken rap, whisper-rap ...), attitude, emotion, how it is mixed (dry, close-mic, breathy). NO drums, kick, bass, synths, genre arrangement or production, because only the vocal is generated; end with "no pop singing".';
const EXAMPLE_FULL = 'dark peak-time techno, sexy commanding female rap vocals, low sultry voice, hypnotic spoken delivery, distorted rolling bassline, aggressive synth stabs, pounding four-on-the-floor kick, underground warehouse rave, explosive drop, Beatport Top 100 club energy, no pop singing, no acoustic instruments.';
const EXAMPLE_VOCAL = 'sexy commanding female rap vocal, low sultry voice, hypnotic spoken delivery, close-mic, dry, breathy accents, no pop singing.';

/** The system prompt: the style prompt either describes the whole track or, when only the vocal is generated, just the voice. */
export const systemFor = (vocalsOnly: boolean): string => BASE.replace('@@STYLE@@', vocalsOnly ? STYLE_VOCAL : STYLE_FULL).replace('@@EXAMPLE@@', vocalsOnly ? EXAMPLE_VOCAL : EXAMPLE_FULL);
export const SYSTEM = systemFor(false);

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback);

export function buildUserText(b: Body): string {
  const count = clamp(b.count, 1, 8, 4);
  const lines = clamp(b.lines, 2, 8, 4);
  const lang = LANGUAGE[b.language ?? 'en'] ?? 'English';
  const parts = [`Write ${count} new hook ideas with exactly ${lines} lines each. The lyrics must be in ${lang}; the style prompts always in English.`];
  if (b.theme?.trim()) parts.push(`Theme / words to build on: "${b.theme.replace(/["\n]/g, ' ').trim().slice(0, 200)}".`);
  else parts.push('No theme given: surprise me with different moods (dark desire, control, machines, night, heat, warehouse, signal, hypnosis ...).');
  if (b.gender) parts.push(`The vocalist is ${b.gender}.`);
  if (b.style) parts.push(`Delivery: ${b.style === 'rap' ? 'rhythmic rap' : b.style === 'spoken' ? 'spoken word' : 'melodic singing'}.`);
  if (b.genre && GENRE[b.genre]) parts.push(`Genre: ${GENRE[b.genre]}. Every idea and its style prompt fits this genre.`);
  const avoid = (b.avoid ?? []).filter((t) => typeof t === 'string').slice(0, 40).map((t) => t.replace(/["\n]/g, ' ').slice(0, 60));
  if (avoid.length) parts.push(`Do NOT repeat these titles or their ideas: ${avoid.join(', ')}.`);
  return parts.join('\n');
}

/** Keeps only well-formed ideas: 2..8 non-empty lines, a title and a style prompt. */
export function parseIdeas(answer: unknown, lines = 4): LyricIdea[] {
  const list = (answer as { ideas?: unknown })?.ideas;
  if (!Array.isArray(list)) return [];
  const out: LyricIdea[] = [];
  for (const raw of list) {
    const r = raw as Partial<LyricIdea>;
    const l = Array.isArray(r.lines) ? r.lines.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().slice(0, 140)) : [];
    if (l.length < 2 || typeof r.title !== 'string' || !r.title.trim() || typeof r.stylePrompt !== 'string' || !r.stylePrompt.trim()) continue;
    out.push({ title: r.title.trim().slice(0, 40), genre: typeof r.genre === 'string' ? r.genre.trim().slice(0, 60) : '', lines: l.slice(0, Math.max(lines, 2)), stylePrompt: r.stylePrompt.trim().slice(0, 800) });
  }
  return out;
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return text(500, 'GEMINI_API_KEY fehlt auf dem Server (Vercel → Settings → Environment Variables)');
  const denied = await authorize(req);
  if (denied) return text(401, denied);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return text(400, 'Ungültige Anfrage');
  }

  const main = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const light = process.env.GEMINI_FALLBACK_MODEL || FALLBACK_MODEL;
  const attempts = [main, light, main, light].map((model, i) => ({ model, wait: i * retryMs() }));
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: systemFor(!!body.vocalsOnly) }] },
    contents: [{ role: 'user', parts: [{ text: buildUserText(body) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 1.1 },
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
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const answer = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  const ideas = parseIdeas(extractJson(answer), clamp(body.lines, 2, 8, 4));
  if (!ideas.length) return text(502, 'Gemini hat keine brauchbaren Ideen geliefert, bitte nochmal versuchen');
  return new Response(JSON.stringify({ ideas, model }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
