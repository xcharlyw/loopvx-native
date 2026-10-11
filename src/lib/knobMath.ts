// Rotary knob math: value <-> position on the dial, dragging, snapping and the arc to draw.
// The dial runs 270 degrees: from -135 (lower left) over 12 o'clock to +135 (lower right).

export type KnobCurve = 'linear' | 'log';

export const KNOB_SWEEP = 135;
/** Finger travel for the full range, in px: a long, calm drag for fine control. */
export const KNOB_DRAG_PX = 170;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Position on the dial, 0..1, of a value. Log knobs spread frequencies the way ears hear them. */
export function valueToT(v: number, min: number, max: number, curve: KnobCurve = 'linear'): number {
  if (max === min) return 0;
  if (curve === 'log' && min > 0) return clamp01(Math.log(Math.max(min, Math.min(max, v)) / min) / Math.log(max / min));
  return clamp01((v - min) / (max - min));
}

export function tToValue(t: number, min: number, max: number, curve: KnobCurve = 'linear'): number {
  const c = clamp01(t);
  if (curve === 'log' && min > 0) return min * Math.pow(max / min, c);
  return min + c * (max - min);
}

/** The dial position after dragging `dy` px (up is positive: it turns clockwise, like a real knob). */
export const dragToT = (t0: number, dy: number, px = KNOB_DRAG_PX) => clamp01(t0 - dy / px);

/** A value snapped to `step` (counted from `min`) and kept in range. */
export function snapValue(v: number, min: number, max: number, step?: number): number {
  const c = Math.max(min, Math.min(max, v));
  if (!step) return c;
  const snapped = min + Math.round((c - min) / step) * step;
  return Math.max(min, Math.min(max, +snapped.toFixed(6)));
}

/** A point on a circle; `deg` is measured clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

/** SVG path of an arc on a circle, clockwise from `fromDeg` to `toDeg`. */
export function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const a = polar(cx, cy, r, Math.min(fromDeg, toDeg));
  const b = polar(cx, cy, r, Math.max(fromDeg, toDeg));
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

/** Angle of a dial position. */
export const tToDeg = (t: number) => -KNOB_SWEEP + clamp01(t) * 2 * KNOB_SWEEP;

/**
 * The part of the dial to fill: from the lowest position, or from 12 o'clock for a knob whose range
 * spans zero (a pan or a detune), so the arc shows which way it is turned.
 */
export function fillRange(t: number, min: number, max: number, curve: KnobCurve = 'linear'): { from: number; to: number } {
  const bipolar = min < 0 && max > 0;
  const zero = bipolar ? valueToT(0, min, max, curve) : 0;
  const a = tToDeg(zero);
  const b = tToDeg(t);
  return { from: Math.min(a, b), to: Math.max(a, b) };
}
