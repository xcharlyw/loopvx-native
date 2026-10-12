import type { AutoParam, AutoPoint, AutomationLane, Track } from '../types';

// Automation lanes: pure maths on curves (value at a bar, sampling for the scheduler, editing points, ready-made
// shapes). The engine turns the samples into AudioParam events; the editor and the arranger build lanes with these.

export interface ParamDef {
  label: string;
  min: number;
  max: number;
  /** What the parameter sits at without automation. */
  rest: number;
  /** Readout in German UI copy. */
  format: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

export const AUTO_PARAMS: Record<AutoParam, ParamDef> = {
  filter: { label: 'Filter', min: -1, max: 1, rest: 0, format: (v) => (Math.abs(v) < 0.02 ? 'Aus' : v < 0 ? `Tiefpass ${Math.round(-v * 100)} %` : `Hochpass ${Math.round(v * 100)} %`) },
  drive: { label: 'Drive', min: 0, max: 1, rest: 0, format: pct },
  reverb: { label: 'Hall', min: 0, max: 1, rest: 0, format: pct },
  delay: { label: 'Echo', min: 0, max: 1, rest: 0, format: pct },
  pan: { label: 'Pan', min: -1, max: 1, rest: 0, format: (v) => (Math.abs(v) < 0.02 ? 'Mitte' : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`) },
  volume: { label: 'Lautstärke', min: 0, max: 1.5, rest: 0.8, format: (v) => `${Math.round(v * 100)} %` },
};
export const AUTO_ORDER: AutoParam[] = ['filter', 'drive', 'reverb', 'delay', 'volume', 'pan'];

/** Points sit on a 1/16-bar grid. */
export const AUTO_GRID = 1 / 16;
const snap = (bar: number) => Math.round(bar / AUTO_GRID) * AUTO_GRID;
const clampValue = (param: AutoParam, v: number) => Math.max(AUTO_PARAMS[param].min, Math.min(AUTO_PARAMS[param].max, v));

/** The curve's value at `bar`: linear between points, held before the first and after the last; undefined without points. */
export function laneValue(points: AutoPoint[], bar: number): number | undefined {
  if (!points.length) return undefined;
  if (bar <= points[0].bar) return points[0].value;
  const last = points[points.length - 1];
  if (bar >= last.bar) return last.value;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (bar <= b.bar) {
      const a = points[i - 1];
      return b.bar === a.bar ? b.value : a.value + ((b.value - a.value) * (bar - a.bar)) / (b.bar - a.bar);
    }
  }
  return last.value;
}

/**
 * The curve's values over [fromBar, toBar] for the scheduler: one sample per `step` bars plus the corner points
 * that fall inside, so a ramp never cuts a corner. The first sample is at `fromBar`, the last at `toBar`.
 */
export function sampleLane(points: AutoPoint[], fromBar: number, toBar: number, step = AUTO_GRID): AutoPoint[] {
  if (!points.length || toBar < fromBar) return [];
  const bars = new Set<number>([fromBar, toBar]);
  for (let b = Math.ceil(fromBar / step) * step; b < toBar; b += step) bars.add(Math.round(b * 1e6) / 1e6);
  for (const p of points) if (p.bar > fromBar && p.bar < toBar) bars.add(p.bar);
  return [...bars].sort((a, b) => a - b).map((bar) => ({ bar, value: laneValue(points, bar)! }));
}

/** Points with one added or moved to `bar` (snapped); a point already on that bar takes the new value. */
export function withPoint(param: AutoParam, points: AutoPoint[], bar: number, value: number): AutoPoint[] {
  const at = Math.max(0, snap(bar));
  const next = points.filter((p) => Math.abs(p.bar - at) > 1e-9);
  next.push({ bar: at, value: Math.round(clampValue(param, value) * 1000) / 1000 });
  return next.sort((a, b) => a.bar - b.bar);
}

export const withoutPoint = (points: AutoPoint[], index: number): AutoPoint[] => points.filter((_, i) => i !== index);

/** The track with `param`'s lane replaced; no points removes the lane (and the field when it was the last). */
export function setLane(track: Track, param: AutoParam, points: AutoPoint[]): Track {
  const others = (track.automation ?? []).filter((l) => l.param !== param);
  const lanes: AutomationLane[] = points.length ? [...others, { param, points }] : others;
  return { ...track, automation: lanes.length ? lanes : undefined };
}

export const laneOf = (track: Track, param: AutoParam): AutoPoint[] => track.automation?.find((l) => l.param === param)?.points ?? [];

/** Whether a track has any curve (the engine skips tracks without). */
export const hasAutomation = (track: Track): boolean => !!track.automation?.some((l) => l.points.length);

// ---------------------------------------------------------------- ready-made shapes

/** A straight ramp from `from` to `to` over [startBar, endBar]. */
export function ramp(param: AutoParam, startBar: number, endBar: number, from: number, to: number): AutoPoint[] {
  return [
    { bar: startBar, value: clampValue(param, from) },
    { bar: endBar, value: clampValue(param, to) },
  ];
}

/** A throw: up to `peak` over the last `rise` bars before `bar`, then straight back to `rest` at `bar` (reverb into the drop). */
export function throwAt(param: AutoParam, bar: number, rise: number, peak: number, rest: number): AutoPoint[] {
  return [
    { bar: Math.max(0, bar - rise), value: clampValue(param, rest) },
    { bar: Math.max(0, bar - AUTO_GRID), value: clampValue(param, peak) },
    { bar, value: clampValue(param, rest) },
  ];
}

/** Several shapes in one lane, sorted; a later point on the same bar wins. */
export function joinPoints(...parts: AutoPoint[][]): AutoPoint[] {
  const byBar = new Map<number, AutoPoint>();
  for (const part of parts) for (const p of part) byBar.set(Math.round(p.bar * 1e6) / 1e6, p);
  return [...byBar.values()].sort((a, b) => a.bar - b.bar);
}
