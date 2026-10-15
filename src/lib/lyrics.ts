import { LYRICS_ENDPOINT } from '../config';
import { getSession } from './supabase';

export interface LyricIdea {
  title: string;
  genre: string;
  lines: string[];
  stylePrompt: string;
}

export interface LyricRequest {
  theme?: string;
  language?: 'de' | 'es' | 'en';
  gender?: 'male' | 'female';
  style?: 'rap' | 'spoken' | 'sing';
  bpm?: number;
  count?: number;
  lines?: number;
  /** Titles shown so far: new ideas must differ. */
  avoid?: string[];
}

/** Asks Gemini (through api/lyrics) for new hook ideas; each has a title, the lyric lines and a matching style prompt. */
export async function requestLyrics(req: LyricRequest): Promise<LyricIdea[]> {
  const session = await getSession();
  if (!session) throw new Error('Bitte zuerst anmelden (Projekte → Mit Google anmelden).');
  const res = await fetch(LYRICS_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Ideen fehlgeschlagen (${res.status})`);
  const { ideas } = (await res.json()) as { ideas?: LyricIdea[] };
  if (!ideas?.length) throw new Error('Keine Ideen erhalten, bitte nochmal versuchen.');
  return ideas;
}

/** The text field gets the lines, one per row. */
export const ideaText = (idea: LyricIdea): string => idea.lines.join('\n');
