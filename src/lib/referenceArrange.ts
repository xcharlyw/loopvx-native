import type { PlanSection, PlanSectionType } from './arrangePlan';
import type { Role } from './arranger';

// Rebuilding the structure of a finished tune from its stems: how loud each stem is in every bar tells where the drums,
// the bass, the synths and the vocal play; phrases of 8 bars with the same mix become sections (intro, build-up, drop,
// break, outro), and the stems that are silent in a section become the roles muted there. The arranger then lays the
// project's own tracks out on that structure. Pure, so it is tested.

export type StemKind = 'drums' | 'bass' | 'synth' | 'vocal';

/** Which stem a file is, from the name the stem separation gives it ("<tune> - Drums.mp3"). */
export function stemKindOf(name: string): StemKind | undefined {
  const m = / - (Drums|Bass|Synth \+ FX|Keys|Gitarre|Vocal)\.[a-z0-9]+$/i.exec(name);
  if (!m) return undefined;
  const s = m[1].toLowerCase();
  return s === 'drums' ? 'drums' : s === 'bass' ? 'bass' : s === 'vocal' ? 'vocal' : 'synth';
}

/**
 * The part of the drums a file holds, when the drums were taken apart ("<tune> - Kick.wav", "- Clap + Snare", "- HiHats" from the
 * app's own split, or files from another tool such as Moises: Kick, Snare, Clap, Hi-Hat, Toms, Cymbals ...). undefined for a
 * normal stem or anything else.
 */
export function drumPartLabel(name: string): string | undefined {
  if (stemKindOf(name)) return undefined;
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase();
  if (/clap\s*\+\s*snare/.test(base)) return 'Clap + Snare';
  if (/hi[\s_-]?hats?|\bhh\b|hats?\b/.test(base)) return 'HiHats';
  if (/\bkick|\bbd\b/.test(base)) return 'Kick';
  if (/snare/.test(base)) return 'Snare';
  if (/clap/.test(base)) return 'Clap';
  if (/\btoms?\b/.test(base)) return 'Toms';
  if (/cymbal|\bride\b|crash/.test(base)) return 'Becken';
  return undefined;
}

/** RMS level of every bar (4/4 at `bpm`), bar 1 starting `offsetSec` into the audio. */
export function barLevels(data: Float32Array, sampleRate: number, bpm: number, offsetSec = 0): number[] {
  const perBar = (sampleRate * 240) / bpm;
  const first = Math.round(offsetSec * sampleRate);
  const bars = Math.ceil((data.length - first) / perBar);
  const out: number[] = [];
  for (let b = 0; b < bars; b++) {
    const from = first + Math.round(b * perBar);
    const to = Math.min(data.length, first + Math.round((b + 1) * perBar));
    let sum = 0;
    // Every 4th sample is plenty for a level.
    let n = 0;
    for (let i = from; i < to; i += 4) {
      sum += data[i] * data[i];
      n++;
    }
    out.push(n ? Math.sqrt(sum / n) : 0);
  }
  return out;
}

const PHRASE = 8;
const MAX_SECTION = 64;

/** Bars where a stem plays: louder than a quarter of its own loud level (its 90th percentile). A near-silent stem never plays. */
export function activeBars(levels: number[]): boolean[] {
  const sorted = [...levels].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  if (loud < 0.003) return levels.map(() => false);
  return levels.map((v) => v > loud * 0.25);
}

interface Block {
  bars: number;
  on: Record<StemKind, boolean>;
}

const MUTES: Record<StemKind, Role[]> = { drums: ['drums', 'kickLoop', 'topLoop'], bass: ['bass'], synth: ['lead', 'pad', 'synthLoop'], vocal: ['vocal'] };
const KINDS: StemKind[] = ['drums', 'bass', 'synth', 'vocal'];

/**
 * The tune's structure from the per-bar levels of its stems (missing stems count as silent). Phrases of 8 bars, a stem plays in a
 * phrase when it plays in at least half of its bars; neighbouring phrases with the same stems form one section, which is then typed:
 * drums + bass = drop; no drums = break (intro at the start, outro at the end); drums without bass = build-up before a drop, else
 * intro/outro/break by position. Sections longer than 64 bars are split.
 */
export function structureFromStems(levels: Partial<Record<StemKind, number[]>>): PlanSection[] {
  const total = Math.max(0, ...KINDS.map((k) => levels[k]?.length ?? 0));
  if (total < PHRASE) return [];
  const active = Object.fromEntries(KINDS.map((k) => [k, levels[k] ? activeBars(levels[k]!) : []])) as Record<StemKind, boolean[]>;
  const blocks: Block[] = [];
  for (let at = 0; at < total; at += PHRASE) {
    const bars = Math.min(PHRASE, total - at);
    if (bars < 4 && blocks.length) {
      blocks[blocks.length - 1].bars += bars; // a short tail joins the last phrase
      break;
    }
    const on = Object.fromEntries(KINDS.map((k) => [k, active[k].slice(at, at + bars).filter(Boolean).length * 2 >= bars])) as Record<StemKind, boolean>;
    const last = blocks[blocks.length - 1];
    if (last && KINDS.every((k) => last.on[k] === on[k])) last.bars += bars;
    else blocks.push({ bars, on });
  }
  const isDrop = (b?: Block) => !!b && b.on.drums && b.on.bass;
  const firstDrop = blocks.findIndex(isDrop);
  const lastDrop = blocks.length - 1 - [...blocks].reverse().findIndex(isDrop);
  const typed = blocks.map((b, i): PlanSection => {
    let type: PlanSectionType;
    if (isDrop(b)) type = 'drop';
    else if (firstDrop < 0) type = i === 0 ? 'intro' : i === blocks.length - 1 ? 'outro' : 'break';
    else if (i < firstDrop) type = b.on.drums && isDrop(blocks[i + 1]) && i > 0 ? 'build' : 'intro';
    else if (i > lastDrop) type = 'outro';
    else type = b.on.drums && isDrop(blocks[i + 1]) ? 'build' : 'break';
    const mute = KINDS.filter((k) => !b.on[k]).flatMap((k) => MUTES[k]);
    return { type, bars: Math.round(b.bars / 4) * 4 || 4, ...(mute.length ? { mute } : {}) };
  });
  // No section longer than the arranger takes; a long drop becomes two drops.
  return typed.flatMap((s) => {
    const out: PlanSection[] = [];
    for (let left = s.bars; left > 0; left -= MAX_SECTION) out.push({ ...s, bars: Math.min(MAX_SECTION, left) });
    return out;
  });
}

/** "Intro 16 · Build-up 8 · Drop 32 …" */
export function structureText(sections: PlanSection[]): string {
  const LABEL: Record<PlanSectionType, string> = { intro: 'Intro', build: 'Build-up', drop: 'Drop', break: 'Break', outro: 'Outro' };
  return sections.map((s) => `${LABEL[s.type]} ${s.bars}`).join(' · ');
}

/**
 * Where one stem plays in the tune, as clip ranges on the found sections: a section gets the stem when it plays in at least half
 * of that section's bars; neighbouring sections merge into one range. A clip placed at `start` with offset `start` plays exactly
 * that part of the original stem.
 */
export function stemClipRanges(levels: number[], sections: PlanSection[]): { start: number; length: number }[] {
  const active = activeBars(levels);
  const out: { start: number; length: number }[] = [];
  let at = 0;
  for (const sec of sections) {
    const end = Math.min(at + sec.bars, levels.length);
    const on = end > at && active.slice(at, end).filter(Boolean).length * 2 >= end - at;
    if (on) {
      const last = out[out.length - 1];
      if (last && last.start + last.length === at) last.length += end - at;
      else out.push({ start: at, length: end - at });
    }
    at += sec.bars;
  }
  return out;
}
