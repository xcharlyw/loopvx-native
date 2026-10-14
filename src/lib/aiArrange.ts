import { ARRANGE_ENDPOINT } from '../config';
import type { Project, Sample } from '../types';
import { candidates, roleOf } from './arranger';
import { keepNamedSamples, parsePlan, type ArrangePlan } from './arrangePlan';
import { getSession } from './supabase';

/** Asks Gemini (through api/arrange) for a plan that fits the text; the answer is checked by `parsePlan`. */
export async function requestPlan(prompt: string, project: Project, samples: Sample[]): Promise<ArrangePlan> {
  const session = await getSession();
  if (!session) throw new Error('Bitte zuerst anmelden (Projekte → Mit Google anmelden).');
  // The model picks effect sounds by name, so it sees the sample names (effect-like ones first, at most 120).
  const FX_LIKE = /fx|impact|hit|crash|riser|rise|sweep|uplift|downlift|boom|slam|noise|cymbal|reverse|transition|swell|texture|atmos/i;
  const names = samples.filter((x) => x.category !== 'vocal').map((x) => ({ name: x.name.replace(/\.[a-z0-9]{2,5}$/i, ''), category: x.category, bpm: x.bpm }));
  // Names with the user's own words first (so "impact" shows the impact samples), then effect-like ones, then the rest.
  const words = prompt.toLowerCase().split(/[^a-z0-9äöüß]+/).filter((w) => w.length >= 4);
  const said = (x: { name: string }) => words.some((w) => x.name.toLowerCase().includes(w));
  const sampleList = [...names.filter(said), ...names.filter((x) => !said(x) && FX_LIKE.test(x.name)), ...names.filter((x) => !said(x) && !FX_LIKE.test(x.name))].slice(0, 120);
  const library = Object.fromEntries((['kick', 'top', 'synth', 'vocal'] as const).map((c) => [c, candidates(samples, c, project).length]));
  const res = await fetch(ARRANGE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ prompt, bpm: project.bpm, key: project.key, tracks: project.tracks.map((t) => ({ name: t.name, role: roleOf(t) ?? 'other' })), library, samples: sampleList }),
  });
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `KI-Planung fehlgeschlagen (${res.status})`);
  const answer = (await res.json()) as { plan?: unknown; model?: string };
  const plan = parsePlan(answer.plan);
  if (!plan) throw new Error('Die KI hat keinen brauchbaren Plan geliefert, bitte nochmal versuchen.');
  return { ...plan, fx: keepNamedSamples(plan.fx, prompt), ...(typeof answer.model === 'string' ? { model: answer.model } : {}) };
}
