import type { Note } from '../types';

// Piano roll dragging, as plain math: a finger offset in pixels becomes whole steps (16ths) and semitones.
// Every result is computed from the note as it was when the drag began, so a drag never accumulates error.

const STEPS_PER_BAR = 16;

/** The note after dragging it by (dx, dy) pixels: along the grid in 16ths, up/down in semitones. */
export function movedNote(from: Note, dx: number, dy: number, stepW: number, rowH: number): Partial<Note> {
  const steps = Math.round(dx / stepW);
  const rows = Math.round(dy / rowH);
  return { start: from.start + steps / STEPS_PER_BAR, pitch: from.pitch - rows };
}

/** The note with its end dragged by `dx` pixels; the end snaps to the 16th grid and the note keeps a minimum length. */
export function resizedNote(from: Note, dx: number, stepW: number): Partial<Note> {
  const endStep = Math.round((from.start + from.length) * STEPS_PER_BAR + dx / stepW);
  return { length: Math.max(1 / STEPS_PER_BAR, endStep / STEPS_PER_BAR - from.start) };
}

/** Keep a dragged pitch inside the rows the grid shows, so the grid does not jump under the finger. */
export const clampPitch = (pitch: number, low: number, high: number) => Math.max(low, Math.min(high, pitch));

export const GRIP_W = 28;

/**
 * Where the touch areas of a selected note sit, in grid pixels. The move area is the note; the length grip
 * sits just behind its end so a short note (a single 16th is 24 px) can still be grabbed in its middle.
 * A long note carries the grip inside its last stretch instead (it would cover its neighbour), and a note
 * ending at the clip end keeps it inside too, because there is no room behind it.
 */
export function noteHitAreas(x: number, w: number, gridWidth: number): { move: { left: number; width: number }; grip: { left: number; width: number }; gripInside: boolean } {
  const end = x + w;
  const inside = w >= 3 * GRIP_W || end + GRIP_W > gridWidth;
  if (inside) {
    const gripW = Math.min(GRIP_W, w / 2);
    return { move: { left: x, width: Math.max(8, w - gripW) }, grip: { left: end - gripW, width: gripW }, gripInside: true };
  }
  return { move: { left: x, width: Math.max(10, w) }, grip: { left: end - 2, width: GRIP_W }, gripInside: false };
}


/** How close to the edge of the visible grid the finger must be before it scrolls, in px. */
export const EDGE_ZONE = 56;
/** Scroll speed at the very edge, in px per second. */
export const EDGE_MAX_SPEED = 900;

/**
 * Auto-scroll while dragging: 0 in the middle, growing the nearer the finger gets to an edge of the
 * visible area (negative = scroll left, positive = right). Past the edge it stays at the maximum, so a
 * finger dragged off-screen keeps scrolling at full speed.
 */
export function edgeScrollSpeed(fingerX: number, viewLeft: number, viewRight: number, zone = EDGE_ZONE, max = EDGE_MAX_SPEED): number {
  if (!(viewRight > viewLeft) || !Number.isFinite(fingerX)) return 0;
  const z = Math.min(zone, (viewRight - viewLeft) / 3); // a tiny view still keeps a calm middle
  const intoLeft = (viewLeft + z - fingerX) / z;
  const intoRight = (fingerX - (viewRight - z)) / z;
  if (intoLeft > 0) return -Math.min(1, intoLeft) * max;
  if (intoRight > 0) return Math.min(1, intoRight) * max;
  return 0;
}

/** A scroll offset kept inside the content: 0 .. contentWidth - viewWidth. */
export const clampScroll = (x: number, contentWidth: number, viewWidth: number) => Math.max(0, Math.min(Math.max(0, contentWidth - viewWidth), x));
