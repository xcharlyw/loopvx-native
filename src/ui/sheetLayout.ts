
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
