
// The panel sheet has three sizes: full (a side panel / the whole screen on a phone, with a dimmed backdrop), half (docked
// at the bottom, the arrangement stays visible and usable above it) and bar (only its title row). Pure, so it is tested.

import type { SheetSize } from '../lib/store';

export const BAR_HEIGHT = 56;

export interface SheetLayout {
  /** Docked above the transport bar and taking space from the arrangement, instead of covering the screen. */
  docked: boolean;
  width: number;
  /** undefined: as tall as the screen. */
  height?: number;
}

/** A full-size panel can be scaled down (a handle drags it, the arrows step to 67 %): it then docks at the bottom like the half size. */
export const SCALE_STEP = 0.67;
export const MIN_SCALE = 0.25;
const MIN_DOCKED = 160;
/** Scales above this count as full size again (snap). */
export const clampScale = (v: number) => (v > 0.96 ? 1 : Math.max(MIN_SCALE, Math.round(v * 100) / 100));

export function sheetLayout(size: SheetSize, win: { width: number; height: number }, scale = 1): SheetLayout {
  if (size === 'full' && scale < 1) return { docked: true, width: Math.min(560, win.width), height: Math.max(MIN_DOCKED, Math.round(win.height * scale)) };
  if (size === 'full') return { docked: false, width: Math.min(420, win.width) };
  const width = Math.min(560, win.width);
  if (size === 'bar') return { docked: true, width, height: BAR_HEIGHT };
  return { docked: true, width, height: Math.max(240, Math.min(440, Math.round(win.height * 0.42))) };
}

export const smaller = (size: SheetSize): SheetSize => (size === 'full' ? 'half' : 'bar');
export const bigger = (size: SheetSize): SheetSize => (size === 'bar' ? 'half' : 'full');

/** The arrows: full → 67 % → half → title bar, and back. */
export function stepSheet(cur: { size: SheetSize; scale: number }, dir: 'smaller' | 'bigger'): { size: SheetSize; scale: number } {
  if (dir === 'smaller') {
    if (cur.size === 'full') return cur.scale >= 1 ? { size: 'full', scale: SCALE_STEP } : { size: 'half', scale: 1 };
    return { size: 'bar', scale: 1 };
  }
  if (cur.size === 'bar') return { size: 'half', scale: 1 };
  if (cur.size === 'half') return { size: 'full', scale: SCALE_STEP };
  return { size: 'full', scale: 1 };
}

/** Panels that are Live's detail view: on a wide screen they dock at the bottom across the whole width, under the arrangement. */
export const DETAIL_PANELS = ['clip', 'piano', 'devices', 'instrument', 'automation', 'mixer'] as const;

/** Where a panel goes. `wide` = a desktop browser (menu bar shown): detail panels dock below, the rest keep their sheet. */
export function placementFor(panel: string, size: SheetSize, win: { width: number; height: number }, wide: boolean, scale = 1): SheetLayout & { detail: boolean } {
  if (!wide || !(DETAIL_PANELS as readonly string[]).includes(panel)) return { ...sheetLayout(size, win, scale), detail: false };
  if (size === 'bar') return { docked: true, width: win.width, height: BAR_HEIGHT, detail: true };
  // The mixer needs the room of its faders; the other detail views share the screen with the arrangement.
  const share = panel === 'mixer' ? (size === 'full' ? 0.62 : 0.5) : size === 'full' ? (panel === 'devices' ? 0.56 : 0.46) : 0.32;
  const factor = size === 'full' ? scale : 1;
  return { docked: true, width: win.width, height: Math.max(factor < 1 ? MIN_DOCKED : 220, Math.round(win.height * share * factor)), detail: true };
}

/** The height a panel has at full size (the scale is a fraction of it): the whole window, or the detail view's share on a wide screen. */
export function fullHeight(panel: string, win: { height: number }, wide: boolean): number {
  if (!wide || !(DETAIL_PANELS as readonly string[]).includes(panel)) return win.height;
  return Math.round(win.height * (panel === 'mixer' ? 0.62 : panel === 'devices' ? 0.56 : 0.46));
}

/** Width of the browser column (Library) on the left of a wide screen. */
export const browserWidth = (winWidth: number) => Math.max(260, Math.min(340, Math.round(winWidth * 0.24)));
