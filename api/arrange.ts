// Vercel Function: turns a text ("dark 160 BPM banger, long break, no pad") into an arrangement plan with Gemini.
// The key (GEMINI_API_KEY) stays on the server; callers must be signed-in LOOPVX users (see _lib/auth.ts).
// The model only answers JSON; the app checks every field (src/lib/arrangePlan.ts) and builds the clips itself.
import { authorize, text } from './_lib/auth';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_MODEL = 'gemini-3.6-flash';

interface Body {
  prompt?: string;
  bpm?: number;
  key?: string;
  /** The project's tracks with the role the arranger sees in them. */
  tracks?: { name?: string; role?: string }[];
  /** How many library samples fit the project per category (kick/top/synth/vocal). */
  library?: Record<string, number>;
}

export const SYSTEM = `You arrange hard techno tracks (usually 145-165 BPM) in a small mobile DAW.
Answer ONLY with one JSON object, no prose, of this shape:
{
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
  "addRoles": string[],         // missing tracks to create, subset of ["drums","bass","lead","pad"]
  "automation": boolean         // filter sweeps, reverb throws, drive build-ups, fade-out
}
Roles for "mute": "drums","bass","lead","pad","kickLoop","topLoop","synthLoop","vocal". Use mute to keep a role out of a
section (e.g. no bass in a break). "name" is a short German or English label shown as a marker (max 24 chars).
Classic hard techno: intro 16, build 16, drop 32, break 16, build 8, drop 32, outro 16. Every arrangement needs a drop.
rumble = rolling sub rumble, offbeat = bouncy offbeat bass, reese = dark detuned reese, acid = 303 acid line;
kit-rolling = busy rolling groove, kit-minimal = sparse, kit-techno = straight driving.`;

export function buildUserText(b: Body): string {
  const tracks = (b.tracks ?? []).slice(0, 24).map((t) => `${String(t.name ?? '').slice(0, 40)} (${String(t.role ?? 'other').slice(0, 12)})`).join(', ');
  const lib = Object.entries(b.library ?? {}).map(([k, n]) => `${k}: ${Number(n) || 0}`).join(', ');
  return [
    `Project: ${Number(b.bpm) || 150} BPM, key ${String(b.key ?? 'unknown').slice(0, 16)}.`,
    `Tracks: ${tracks || 'none'}.`,
    `Library samples that fit the tempo: ${lib || 'none'}.`,
    `Request: ${String(b.prompt ?? '').trim().slice(0, 1500) || 'A classic peak-time hard techno arrangement.'}`,
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

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const res = await fetch(`${GEMINI}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: buildUserText(body) }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) return text(res.status === 429 ? 429 : 502, `Gemini (${res.status}): ${(await res.text()).slice(0, 500)}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const answer = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  const plan = extractJson(answer);
  if (!plan) return text(502, 'Gemini hat keinen gültigen Plan geliefert, bitte nochmal versuchen');
  return new Response(JSON.stringify({ plan, model }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
