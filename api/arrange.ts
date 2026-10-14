// Vercel Function: turns a text ("dark 160 BPM banger, long break, no pad") into an arrangement plan with Gemini.
// The key (GEMINI_API_KEY) stays on the server; callers must be signed-in LOOPVX users (see _lib/auth.ts).
// The model only answers JSON; the app checks every field (src/lib/arrangePlan.ts) and builds the clips itself.
import { authorize, text } from './_lib/auth';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_MODEL = 'gemini-3.6-flash';
export const FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const retryMs = () => Number(process.env.GEMINI_RETRY_MS ?? 1200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Body {
  prompt?: string;
  bpm?: number;
  key?: string;
  /** The project's tracks with the role the arranger sees in them. */
  tracks?: { name?: string; role?: string }[];
  /** How many library samples fit the project per category (kick/top/synth/vocal). */
  library?: Record<string, number>;
  /** Names of library samples (effect-like ones first), so effects can be picked by name. */
  samples?: { name?: string; category?: string; bpm?: number }[];
}

export const SYSTEM = `You arrange hard techno tracks (usually 145-165 BPM) in a small mobile DAW.
Answer ONLY with one JSON object, no prose, of this shape:
{
  "scope": "full" | "fx_only",  // "fx_only" = the request only asks for single additions (an effect/sound at a bar): then ONLY "summary", "fx" and "notes" matter, "sections" stays []
                                // "full" = the request wants an arrangement planned or changed (structure, sections, length, "arrangement", "aufbau", a whole track)
  "summary": string,            // 1-2 sentences in German (Austrian user): what you planned and why
  "bpm": number | null,         // only if the user asks for a tempo, else null
  "key": string | null,         // e.g. "F minor", only if the user asks for a key, else null
  "sections": [                 // in order; 6 to 12 sections; each "bars" a multiple of 4 (4..64); total 64..256 bars
    { "type": "intro" | "build" | "drop" | "break" | "outro", "bars": number, "name": string, "mute": string[] }
  ],
  "styles": {
    "bass": "rumble" | "offbeat" | "reese" | "acid",
    "lead": "trance" | "hypnotic" | "arp" | "prog" | "stabs" | "rave",
    "drums": "kit-techno" | "kit-rolling" | "kit-minimal"
  },
  "addRoles": string[],         // new MIDI tracks to create, subset of ["drums","bass","lead","pad"]: ONLY roles the request needs and the project lacks; [] when the existing tracks are enough
  "automation": boolean,        // true = filter sweeps, reverb throws, drive build-ups and a fade-out are added (normally true for a full arrangement), false = none
  "fx": [                       // one-off sounds from the user's library, each on an audio track of its own (may be empty)
    { "kind": "impact" | "riser" | "downlifter" | "crash" | "other",
      "bar": number,            // bar NUMBER as shown in the ruler (1 = first bar) where the sound starts; a riser starts "length" bars BEFORE the bar it leads into
      "length": number | null,  // bars, only if the sound must be cut or stretched, else null
      "track": string | null,   // name of the new audio track, e.g. "Impact FX"
      "search": string[],       // 1-4 words that appear in fitting sample names, best first: the word(s) the USER used for the sound (e.g. "impact" -> ["impact"]), then close synonyms
      "sample": string | null } // ONLY a sample name the user typed himself (copy it exactly); otherwise null. Never pick or invent a name yourself: the app searches the library with "search"
  ],
  "notes": string[]             // German: every request you could NOT express in this JSON (empty if none)
}
Roles for "mute": "drums","bass","lead","pad","kickLoop","topLoop","synthLoop","vocal". Use mute to keep a role out of a
section (e.g. no bass in a break). "name" is a short German or English label shown as a marker (max 24 chars).
Classic hard techno: intro 16, build 16, drop 32, break 16, build 8, drop 32, outro 16. Every arrangement needs a drop.
When in doubt choose "fx_only": a request like "impact fx at bar 65 on a new track" must NOT rebuild the arrangement.
The app does exactly what the JSON says and nothing else: "summary" must only describe what is in the JSON. A single sound at one position (impact,
riser, downlifter, crash) goes into "fx", never into "sections". Anything the JSON cannot express goes into "notes", do not pretend.
"summary" and "notes" are always in German, never in English.
rumble = rolling sub rumble, offbeat = bouncy offbeat bass, reese = dark detuned reese, acid = 303 acid line;
kit-rolling = busy rolling groove, kit-minimal = sparse, kit-techno = straight driving.`;

/** The human part of a Google error body ({"error":{"message":...}}), cut short. */
export function googleMessage(body: string): string {
  try {
    const m = (JSON.parse(body) as { error?: { message?: string } }).error?.message;
    if (m) return m.slice(0, 300);
  } catch {
    // not JSON
  }
  return body.slice(0, 300);
}

export function buildUserText(b: Body): string {
  const tracks = (b.tracks ?? []).slice(0, 24).map((t) => `${String(t.name ?? '').slice(0, 40)} (${String(t.role ?? 'other').slice(0, 12)})`).join(', ');
  const lib = Object.entries(b.library ?? {}).map(([k, n]) => `${k}: ${Number(n) || 0}`).join(', ');
  const names = (b.samples ?? [])
    .slice(0, 120)
    .map((x) => String(x?.name ?? '').replace(/[\u0000-\u001f"]/g, ' ').trim().slice(0, 60))
    .filter(Boolean)
    .join('; ');
  return [
    `Project: ${Number(b.bpm) || 150} BPM, key ${String(b.key ?? 'unknown').slice(0, 16)}.`,
    `Tracks: ${tracks || 'none'}.`,
    `Library samples that fit the tempo: ${lib || 'none'}.`,
    ...(names ? [`Library sample names (for "sample" in fx, effect-like first): ${names}.`] : []),
    `Request: ${String(b.prompt ?? '').trim().slice(0, 1500) || 'A classic peak-time hard techno arrangement.'}`,
    'Answer "summary" and "notes" in German.',
  ].join('\n');
}

/** The JSON object in a model answer, also when it came wrapped in a ```json fence or with text around it. */
export function extractJson(answer: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(answer);
  const body = fenced ? fenced[1] : answer;
  const from = body.indexOf('{');
  const to = body.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  try {
    return JSON.parse(body.slice(from, to + 1));
  } catch {
    return null;
  }
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

  // Google answers 503 "high demand" in spikes and 429 when a shared key is at its per-minute limit: alternate the main and the
  // lighter model with growing pauses (about 10 s in all) before giving up.
  const main = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const light = process.env.GEMINI_FALLBACK_MODEL || FALLBACK_MODEL;
  const attempts = [main, light, main, light, main].map((model, i) => ({ model, wait: i * retryMs() }));
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: buildUserText(body) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
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
  const plan = extractJson(answer);
  if (!plan) return text(502, 'Gemini hat keinen gültigen Plan geliefert, bitte nochmal versuchen');
  return new Response(JSON.stringify({ plan, model }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
