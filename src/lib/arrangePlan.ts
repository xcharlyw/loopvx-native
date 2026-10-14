import { FX_KINDS, type ArrangeStyles, type FxHit, type Role, type Section, type SectionId } from './arranger';
import { KEYS } from './project';

// An arrangement plan from a language model (Gemini, via api/arrange): the structure and the styles, chosen from a text
// like "dark 160 BPM banger with a long break and no pad". The model only answers JSON; everything it says is checked
// here, so a wrong or made-up answer can never break a project. The rule based arranger then builds the clips.

export type PlanSectionType = 'intro' | 'build' | 'drop' | 'break' | 'outro';

export interface PlanSection {
  type: PlanSectionType;
  bars: number;
  name?: string;
  mute?: Role[];
}

export interface ArrangePlan {
  sections: PlanSection[];
  bpm?: number;
  key?: string;
  styles: ArrangeStyles;
  /** Missing roles to add as new tracks. */
  addRoles: Role[];
  automation: boolean;
  /** One or two German sentences: what the model made of the text. */
  summary?: string;
  /** One-off effect sounds from the library on their own audio tracks (impact at the vocal break ...). */
  fx: FxHit[];
  /** What the text asked for that a plan cannot express; shown so nothing is silently dropped. */
  notes?: string[];
  /** The model that planned it (the server may fall back to a lighter one). */
  model?: string;
}

const TYPES: PlanSectionType[] = ['intro', 'build', 'drop', 'break', 'outro'];
const ROLES: Role[] = ['drums', 'bass', 'lead', 'pad', 'kickLoop', 'topLoop', 'synthLoop', 'vocal'];
const ADDABLE: Role[] = ['drums', 'bass', 'lead', 'pad'];
const BASS = ['rumble', 'offbeat', 'reese', 'acid'] as const;
const LEAD = ['trance', 'hypnotic', 'arp', 'prog', 'stabs', 'rave'] as const;
const DRUMS = ['kit-techno', 'kit-rolling', 'kit-minimal'] as const;

export const PLAN_LIMITS = { maxFx: 12, maxSections: 16, minBars: 4, maxBars: 64, maxTotal: 256, minBpm: 120, maxBpm: 200 };

const LABEL: Record<PlanSectionType, string> = { intro: 'Intro', build: 'Build-up', drop: 'Drop', break: 'Break', outro: 'Outro' };

const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined);

/** "f minor", "Fm", "F# min", "a moll" -> an entry of KEYS, or undefined. */
export function normalizeKey(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^\s*([a-g])\s*([#b♯♭]|sharp|flat)?\s*(m|min|minor|moll|maj|major|dur)?\s*$/i.exec(v.trim());
  if (!m) return undefined;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  let i = names.indexOf(m[1].toUpperCase());
  const acc = (m[2] ?? '').toLowerCase();
  if (acc === '#' || acc === '♯' || acc === 'sharp') i += 1;
  if (acc === 'b' || acc === '♭' || acc === 'flat') i -= 1;
  const mode = m[3] && /^(maj|major|dur)$/i.test(m[3]) ? 'major' : 'minor'; // no mode given: minor, the techno default
  const key = `${names[(i + 12) % 12]} ${mode}`;
  return KEYS.includes(key) ? key : undefined;
}

/** The effect list of a plan: `bar` comes in as the 1-based bar number shown in the ruler and goes out 0-based; unknown kinds and nonsense are dropped. */
export function parseFx(raw: unknown): FxHit[] {
  const out: FxHit[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (out.length >= PLAN_LIMITS.maxFx || !item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const kind = pick(FX_KINDS, it.kind) ?? 'other';
    const n = Number(it.bar);
    if (!Number.isFinite(n) || n < 1 || n > PLAN_LIMITS.maxTotal) continue;
    const len = Number(it.length);
    const length = Number.isFinite(len) && len > 0 ? Math.min(16, Math.max(0.25, Math.round(len * 4) / 4)) : undefined;
    const track = typeof it.track === 'string' && it.track.trim() ? it.track.trim().slice(0, 24) : undefined;
    const search = Array.isArray(it.search) ? it.search.filter((w): w is string => typeof w === 'string' && !!w.trim()).slice(0, 6).map((w) => w.trim().slice(0, 24)) : [];
    const sample = typeof it.sample === 'string' && it.sample.trim() ? it.sample.trim().slice(0, 80) : undefined;
    out.push({ kind, bar: Math.round(n) - 1, ...(length ? { length } : {}), ...(track ? { track } : {}), ...(search.length ? { search } : {}), ...(sample ? { sample } : {}) });
  }
  return out;
}

/** Checks and repairs a model's answer: unknown fields go, bars snap to whole phrases of 4, the total is capped. Null when nothing usable is left. */
export function parsePlan(raw: unknown): ArrangePlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const sections: PlanSection[] = [];
  let total = 0;
  for (const item of Array.isArray(r.sections) ? r.sections : []) {
    if (sections.length >= PLAN_LIMITS.maxSections || !item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const type = pick(TYPES, it.type);
    const n = Number(it.bars);
    if (!type || !Number.isFinite(n)) continue;
    const bars = Math.min(PLAN_LIMITS.maxBars, Math.max(PLAN_LIMITS.minBars, Math.round(n / 4) * 4), PLAN_LIMITS.maxTotal - total);
    if (bars < PLAN_LIMITS.minBars) break;
    const mute = Array.isArray(it.mute) ? [...new Set(it.mute.map((x) => pick(ROLES, x)).filter((x): x is Role => !!x))] : [];
    const name = typeof it.name === 'string' && it.name.trim() ? it.name.trim().slice(0, 24) : undefined;
    sections.push({ type, bars, ...(name ? { name } : {}), ...(mute.length ? { mute } : {}) });
    total += bars;
  }
  if (!sections.some((sec) => sec.type === 'drop')) return null; // a track without a drop is not what anyone asked for
  const bpmN = Number(r.bpm);
  const bpm = Number.isFinite(bpmN) && bpmN >= PLAN_LIMITS.minBpm && bpmN <= PLAN_LIMITS.maxBpm ? Math.round(bpmN) : undefined;
  const st = (r.styles && typeof r.styles === 'object' ? r.styles : {}) as Record<string, unknown>;
  const styles: ArrangeStyles = {};
  const bass = pick(BASS, st.bass);
  const lead = pick(LEAD, st.lead);
  const drums = pick(DRUMS, st.drums);
  if (bass) styles.bass = bass;
  if (lead) styles.lead = lead;
  if (drums) styles.drums = drums;
  const addRoles = Array.isArray(r.addRoles) ? [...new Set(r.addRoles.map((x) => pick(ADDABLE, x)).filter((x): x is Role => !!x))] : []; // the plan decides: no list, no new tracks
  const summary = typeof r.summary === 'string' && r.summary.trim() ? r.summary.trim().slice(0, 300) : undefined;
  const notes = Array.isArray(r.notes) ? r.notes.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 6).map((x) => x.trim().slice(0, 200)) : [];
  return { sections, bpm, key: normalizeKey(r.key), styles, addRoles, automation: r.automation === true, fx: parseFx(r.fx), ...(notes.length ? { notes } : {}), ...(summary ? { summary } : {}) };
}

/** The plan's sections laid out in bars. A second drop or build plays the arranger's "2" variant (reese bass, the drop's vocal half). */
export function planSections(plan: Pick<ArrangePlan, 'sections'>): Section[] {
  const out: Section[] = [];
  const seen: Partial<Record<PlanSectionType, number>> = {};
  let at = 0;
  for (const sec of plan.sections) {
    const n = (seen[sec.type] = (seen[sec.type] ?? 0) + 1);
    const id: SectionId = sec.type === 'drop' && n > 1 ? 'drop2' : sec.type === 'build' && n > 1 ? 'build2' : sec.type;
    const total = plan.sections.filter((x) => x.type === sec.type).length;
    const label = sec.name ?? (total > 1 ? `${LABEL[sec.type]} ${n}` : LABEL[sec.type]);
    out.push({ id, label, start: at, bars: sec.bars, ...(sec.mute ? { mute: sec.mute } : {}) });
    at += sec.bars;
  }
  return out;
}
