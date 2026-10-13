import { ARRANGE_ENDPOINT } from '../config';
import type { Project, Sample } from '../types';
import { candidates, roleOf } from './arranger';
import { parsePlan, type ArrangePlan } from './arrangePlan';
import { getSession } from './supabase';

/** Asks Gemini (through api/arrange) for a plan that fits the text; the answer is checked by `parsePlan`. */
export async function requestPlan(prompt: string, project: Project, samples: Sample[]): Promise<ArrangePlan> {
  const session = await getSession();
  if (!session) throw new Error('Bitte zuerst anmelden (Projekte → Mit Google anmelden).');
  const library = Object.fromEntries((['kick', 'top', 'synth', 'vocal'] as const).map((c) => [c, candidates(samples, c, project).length]));
  const res = await fetch(ARRANGE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ prompt, bpm: project.bpm, key: project.key, tracks: project.tracks.map((t) => ({ name: t.name, role: roleOf(t) ?? 'other' })), library }),
  });
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `KI-Planung fehlgeschlagen (${res.status})`);
  const plan = parsePlan(((await res.json()) as { plan?: unknown }).plan);
  if (!plan) throw new Error('Die KI hat keinen brauchbaren Plan geliefert, bitte nochmal versuchen.');
  return plan;
}
