import { DEVICE_DEFS, deviceParams, formatParam } from '../audio/devices';
import type { AutoParam, AutoPoint, AutomationLane, Device, Track, TrackAutoParam } from '../types';
import { tToValue, valueToT } from './knobMath';

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

export const AUTO_PARAMS: Record<TrackAutoParam, ParamDef> = {
  filter: { label: 'Filter', min: -1, max: 1, rest: 0, format: (v) => (Math.abs(v) < 0.02 ? 'Aus' : v < 0 ? `Tiefpass ${Math.round(-v * 100)} %` : `Hochpass ${Math.round(v * 100)} %`) },
  drive: { label: 'Drive', min: 0, max: 1, rest: 0, format: pct },
  reverb: { label: 'Hall', min: 0, max: 1, rest: 0, format: pct },
  delay: { label: 'Echo', min: 0, max: 1, rest: 0, format: pct },
  pan: { label: 'Pan', min: -1, max: 1, rest: 0, format: (v) => (Math.abs(v) < 0.02 ? 'Mitte' : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`) },
  /** A multiplier of the track's fader (1 = as the fader stands), so the mixer fader keeps working under a fade. */
  volume: { label: 'Lautstärke', min: 0, max: 1, rest: 1, format: (v) => `${Math.round(v * 100)} %` },
};
export const AUTO_ORDER: TrackAutoParam[] = ['filter', 'drive', 'reverb', 'delay', 'volume', 'pan'];

// ---------------------------------------------------------------- device knobs

export const isDeviceParam = (p: AutoParam): p is `dev:${string}` => p.startsWith('dev:');
export const deviceParamKey = (deviceId: string, key: string): AutoParam => `dev:${deviceId}:${key}`;
/** `dev:<id>:<key>` split up; undefined for a track parameter. */
export function parseDeviceParam(p: AutoParam): { deviceId: string; key: string } | undefined {
  if (!isDeviceParam(p)) return undefined;
  const [, deviceId, key] = p.split(':');
  return deviceId && key ? { deviceId, key } : undefined;
}

/** A device knob's position (0..1) for a value, and back: lanes of device knobs move like the knob (log for frequencies). */
export function knobPosition(device: Device, key: string, value: number): number {
  const def = DEVICE_DEFS[device.type]?.params.find((p) => p.key === key);
  return def ? valueToT(value, def.min, def.max, def.curve ?? 'linear') : 0;
}
export function knobValue(device: Device, key: string, t: number): number {
  const def = DEVICE_DEFS[device.type]?.params.find((p) => p.key === key);
  return def ? tToValue(Math.max(0, Math.min(1, t)), def.min, def.max, def.curve ?? 'linear') : 0;
}

/** The knobs of a track's devices that a lane can drive (continuous ones: switches and pickers stay put). */
export function deviceAutoParams(track: Pick<Track, 'devices'>): { param: AutoParam; label: string }[] {
  return (track.devices ?? []).flatMap((d) => {
    const def = DEVICE_DEFS[d.type];
    return (def?.params ?? []).filter((p) => p.unit !== 'enum' && p.unit !== 'switch').map((p) => ({ param: deviceParamKey(d.id, p.key), label: `${def.label}: ${p.label}` }));
  });
}

/** What the editor shows for any parameter of a track: track parameters from `AUTO_PARAMS`, device knobs as 0..1 with the knob's readout. */
export function paramDef(track: Pick<Track, 'devices'>, param: AutoParam): ParamDef {
  const dev = parseDeviceParam(param);
  if (!dev) return AUTO_PARAMS[param as TrackAutoParam];
  const device = track.devices?.find((d) => d.id === dev.deviceId);
  const pdef = device ? DEVICE_DEFS[device.type]?.params.find((p) => p.key === dev.key) : undefined;
  if (!device || !pdef) return { label: 'Gerät fehlt', min: 0, max: 1, rest: 0, format: () => '–' };
  return {
    label: `${DEVICE_DEFS[device.type].label}: ${pdef.label}`,
    min: 0,
    max: 1,
    rest: knobPosition(device, dev.key, deviceParams(device)[dev.key]),
    format: (t) => formatParam(pdef, knobValue(device, dev.key, t)),
  };
}

/** Points sit on a 1/16-bar grid. */
export const AUTO_GRID = 1 / 16;
const snap = (bar: number) => Math.round(bar / AUTO_GRID) * AUTO_GRID;
const clampValue = (param: AutoParam, v: number) => {
  const def = isDeviceParam(param) ? { min: 0, max: 1 } : AUTO_PARAMS[param];
  return Math.max(def.min, Math.min(def.max, v));
};

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

// ---------------------------------------------------------------- drawing (Ableton's draw mode)

/** Drops points that sit on the straight line between their neighbours (within `tolerance`): a drawn line stays light. */
export function simplifyLane(points: AutoPoint[], tolerance: number): AutoPoint[] {
  if (points.length < 3) return points;
  const out: AutoPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i + 1];
    const p = points[i];
    const onLine = b.bar === a.bar ? p.value : a.value + ((b.value - a.value) * (p.bar - a.bar)) / (b.bar - a.bar);
    if (Math.abs(p.value - onLine) > tolerance) out.push(p);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * A freehand line drawn over a lane: the finger's path (`stroke`, in bars and values, in the order drawn) replaces the
 * curve over the bars it covers, one point per `step` bars (gaps from a fast finger are filled in a straight line; going
 * back over a bar redraws it). Outside the drawn range the old curve stays as it was: an extra point right before and
 * after the line keeps its values there. `base` is the curve before the stroke began.
 */
export function drawStroke(param: AutoParam, base: AutoPoint[], stroke: AutoPoint[], step = AUTO_GRID): AutoPoint[] {
  if (!stroke.length) return base;
  const cells = new Map<number, number>();
  const put = (bar: number, value: number) => cells.set(Math.max(0, Math.round(bar / step)), value);
  put(stroke[0].bar, stroke[0].value);
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1];
    const b = stroke[i];
    const lo = Math.min(a.bar, b.bar);
    const hi = Math.max(a.bar, b.bar);
    for (let k = Math.ceil(lo / step); k * step <= hi; k++) {
      const bar = k * step;
      put(bar, hi === lo ? b.value : a.value + ((b.value - a.value) * (bar - a.bar)) / (b.bar - a.bar));
    }
    put(b.bar, b.value);
  }
  const keys = [...cells.keys()].sort((x, y) => x - y);
  const from = keys[0] * step;
  const to = keys[keys.length - 1] * step;
  const drawn = keys.map((k) => ({ bar: k * step, value: Math.round(clampValue(param, cells.get(k)!) * 1000) / 1000 }));
  const outside = base.filter((p) => p.bar < from - 1e-9 || p.bar > to + 1e-9);
  const anchors: AutoPoint[] = [];
  if (base.length) {
    if (from - AUTO_GRID >= 0) anchors.push({ bar: from - AUTO_GRID, value: laneValue(base, from - AUTO_GRID)! });
    anchors.push({ bar: to + AUTO_GRID, value: laneValue(base, to + AUTO_GRID)! });
  }
  const def = isDeviceParam(param) ? { min: 0, max: 1 } : AUTO_PARAMS[param];
  // Points of the old curve win over the anchors on the same bar (the anchors only repeat them).
  return simplifyLane(joinPoints(anchors, outside, drawn), (def.max - def.min) * 0.004);
}

/** The drawing resolution for a lane `pxPerBar` wide per bar: 1/16 bar when zoomed in, coarser so points stay ~6 px apart. */
export function drawStep(pxPerBar: number): number {
  let step = AUTO_GRID;
  while (step < 1 && step * pxPerBar < 6) step *= 2;
  return step;
}
