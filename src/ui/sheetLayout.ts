
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

export function sheetLayout(size: SheetSize, win: { width: number; height: number }): SheetLayout {
  if (size === 'full') return { docked: false, width: Math.min(420, win.width) };
  const width = Math.min(560, win.width);
  if (size === 'bar') return { docked: true, width, height: BAR_HEIGHT };
  return { docked: true, width, height: Math.max(240, Math.min(440, Math.round(win.height * 0.42))) };
}

export const smaller = (size: SheetSize): SheetSize => (size === 'full' ? 'half' : 'bar');
export const bigger = (size: SheetSize): SheetSize => (size === 'bar' ? 'half' : 'full');

/** Panels that are Live's detail view: on a wide screen they dock at the bottom across the whole width, under the arrangement. */
export const DETAIL_PANELS = ['clip', 'piano', 'devices', 'instrument', 'automation', 'mixer'] as const;

/** Where a panel goes. `wide` = a desktop browser (menu bar shown): detail panels dock below, the rest keep their sheet. */
export function placementFor(panel: string, size: SheetSize, win: { width: number; height: number }, wide: boolean): SheetLayout & { detail: boolean } {
  if (!wide || !(DETAIL_PANELS as readonly string[]).includes(panel)) return { ...sheetLayout(size, win), detail: false };
  if (size === 'bar') return { docked: true, width: win.width, height: BAR_HEIGHT, detail: true };
  // The mixer needs the room of its faders; the other detail views share the screen with the arrangement.
  const share = panel === 'mixer' ? (size === 'full' ? 0.62 : 0.5) : size === 'full' ? 0.46 : 0.32;
  return { docked: true, width: win.width, height: Math.max(220, Math.round(win.height * share)), detail: true };
}

/** Width of the browser column (Library) on the left of a wide screen. */
export const browserWidth = (winWidth: number) => Math.max(260, Math.min(340, Math.round(winWidth * 0.24)));
