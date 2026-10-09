import { BEATS_PER_BAR } from '../config';
import type { Clip, Project, SampleCategory } from '../types';

const EPS = 1e-9;

export function secondsPerBar(bpm: number, beatsPerBar = BEATS_PER_BAR): number {
  return (60 / bpm) * beatsPerBar;
}

/** Playback rate that makes a loop recorded at sampleBpm play at projectBpm (re-pitch warp, like Ableton's "Re-Pitch"). */
export function warpRate(projectBpm: number, sampleBpm?: number): number {
  if (!sampleBpm || sampleBpm <= 0) return 1;
  return projectBpm / sampleBpm;
}

/**
 * Length of one loop cycle of a sample, in bars.
 * Loops with a known tempo are snapped to the nearest beat so files with a few
 * extra samples of tail still loop exactly on the grid.
 */
export function sampleLengthBars(durationSec: number, projectBpm: number, sampleBpm?: number): number {
  if (sampleBpm && sampleBpm > 0) {
    const bars = durationSec / secondsPerBar(sampleBpm);
    return snapToBeat(bars);
  }
  return durationSec / secondsPerBar(projectBpm);
}

/** Loop end inside the raw buffer (seconds at native speed), snapped to the bar grid of the sample tempo. */
export function loopEndSeconds(durationSec: number, sampleBpm?: number): number {
  if (!sampleBpm) return durationSec;
  const bars = snapToBeat(durationSec / secondsPerBar(sampleBpm));
  const end = bars * secondsPerBar(sampleBpm);
  return Math.min(end, durationSec);
}

export function snapToBeat(bars: number): number {
  const beats = Math.round(bars * BEATS_PER_BAR);
  return Math.max(1, beats) / BEATS_PER_BAR;
}

export function snapBars(bars: number, grid: number): number {
  return Math.round(bars / grid) * grid;
}

/** First grid boundary at or after `time`, for a grid starting at `origin` with the given period. */
export function nextBoundary(time: number, origin: number, period: number): number {
  if (time <= origin) return origin;
  const n = Math.ceil((time - origin) / period - EPS);
  return origin + n * period;
}

export interface ClipPlan {
  /** Bars from `fromBar` until the clip should start sounding. */
  delayBars: number;
  /** Offset into the looping sample, in bars. */
  offsetBars: number;
  /** How long the clip sounds within the window, in bars. */
  durationBars: number;
}

/** Which part of a clip sounds inside the window [fromBar, toBar). */
export function planClip(clip: Clip, fromBar: number, toBar: number, loopBars: number): ClipPlan | null {
  const clipEnd = clip.start + clip.length;
  const begin = Math.max(clip.start, fromBar);
  const end = Math.min(clipEnd, toBar);
  if (end - begin <= EPS) return null;
  const into = begin - clip.start + clip.offset;
  const offsetBars = loopBars > 0 ? ((into % loopBars) + loopBars) % loopBars : 0;
  return { delayBars: begin - fromBar, offsetBars, durationBars: end - begin };
}

export function projectEndBars(project: Project): number {
  let end = 0;
  for (const t of project.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.length);
  return Math.max(end, 4);
}

/** "015.1.1" style position (bar.beat.sixteenth, 1-based). */
export function formatBarPosition(bars: number): string {
  const totalSixteenths = Math.floor(bars * BEATS_PER_BAR * 4 + EPS);
  const bar = Math.floor(totalSixteenths / (BEATS_PER_BAR * 4)) + 1;
  const beat = Math.floor((totalSixteenths % (BEATS_PER_BAR * 4)) / 4) + 1;
  const six = (totalSixteenths % 4) + 1;
  return `${String(bar).padStart(3, '0')}.${beat}.${six}`;
}

/** "00:28.000" style clock. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(3).padStart(6, '0')}`;
}

// ---------- sample name parsing ----------

export interface ParsedName {
  bpm?: number;
  key?: string;
  category: SampleCategory;
}

const KEY_TOKEN = /^([A-Ga-g])([#b]?)(maj|major|min|minor|m)?$/;

export function parseKey(token: string): string | undefined {
  const m = KEY_TOKEN.exec(token);
  if (!m) return undefined;
  const root = m[1].toUpperCase() + m[2];
  const quality = m[3]?.toLowerCase();
  if (!quality) return root;
  if (quality.startsWith('maj')) return `${root} major`;
  return `${root} minor`;
}

export function parseBpm(name: string): number | undefined {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  const explicit = /(\d{2,3})\s?bpm|bpm[\s_-]?(\d{2,3})/i.exec(base);
  if (explicit) {
    const v = Number(explicit[1] ?? explicit[2]);
    if (v >= 60 && v <= 220) return v;
  }
  for (const token of base.split(/[_\-\s.]+/)) {
    if (!/^\d{2,3}$/.test(token) || token.startsWith('0')) continue;
    const v = Number(token);
    if (v >= 60 && v <= 220) return v;
  }
  return undefined;
}

export function parseCategory(name: string, folder = ''): SampleCategory {
  const s = `${folder}/${name}`.toLowerCase();
  if (/vocal|vox|acapella|a_cappella|hook|phrase|lyric/.test(s)) return 'vocal';
  if (/no[_\s-]?kick|top[_\s-]?loop|tops?\b|_top_|hat|hihat|perc|ride|shaker|cymbal|clap/.test(s)) return 'top';
  if (/kick|rumble/.test(s)) return 'kick';
  if (/synth|lead|pluck|arp|screech|acid|stab|pad|chord|hoover|reese|bass|melod|music/.test(s)) return 'synth';
  return 'other';
}

export function parseSampleName(name: string, folder = ''): ParsedName {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  const tokens = base.split(/[_\-\s.]+/).filter(Boolean);
  let key: string | undefined;
  // Keys usually sit at the end of the name, so scan backwards.
  for (let i = tokens.length - 1; i >= Math.max(0, tokens.length - 3); i--) {
    key = parseKey(tokens[i]);
    if (key) break;
  }
  return { bpm: parseBpm(name), key, category: parseCategory(name, folder) };
}
