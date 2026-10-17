// Plugin windows (wide screens): the Sound, Geräte and MIDI-Effekte panels float above the arrangement like Ableton's plugin
// windows: dragged by their title bar, resized by the corner, brought to the front by a touch, several open at once.
// Pure list functions, so the rules are tested; the store only holds the list (the last entry is the front window).

export type WinId = 'instrument' | 'devices' | 'notefx';
/** The big editors float; the device chain (`devices`) is Live's docked detail view with compact cards that open them. */
export const FLOAT_PANELS: readonly string[] = ['instrument', 'notefx'];
export const isFloatPanel = (p: string): p is WinId => FLOAT_PANELS.includes(p);

export interface WinRect {
  id: WinId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Only the title bar shows. */
  collapsed?: boolean;
}

export const TITLE_H = 44;
export const MIN_W = 300;
export const MIN_H = 180;
/** Of the title bar this much must stay on the screen, so a window can always be grabbed again. */
const KEEP = 90;

export const DEFAULT_SIZE: Record<WinId, { w: number; h: number }> = {
  // The synth is laid out as one plugin screen from 900 px on (see synthLayout); the window is fitted to the screen.
  instrument: { w: 1100, h: 740 },
  devices: { w: 560, h: 560 },
  notefx: { w: 460, h: 600 },
};

export interface Screen {
  width: number;
  height: number;
  /** The first y a window may use (below the menu bar). */
  top: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A rectangle that fits the screen: at least MIN size, at most the screen, and with its title bar reachable. */
export function fitRect(r: WinRect, scr: Screen): WinRect {
  const w = clamp(r.w, Math.min(MIN_W, scr.width), scr.width);
  const h = clamp(r.h, Math.min(MIN_H, scr.height - scr.top), scr.height - scr.top);
  return { ...r, w, h, x: clamp(r.x, KEEP - w, scr.width - KEEP), y: clamp(r.y, scr.top, scr.height - TITLE_H) };
}

/** Open a window (or bring an open one to the front). A new one reuses where it was last, else cascades from the top left. */
export function openWin(list: WinRect[], id: WinId, scr: Screen, remembered?: WinRect): WinRect[] {
  const open = list.find((w) => w.id === id);
  if (open) return [...list.filter((w) => w.id !== id), open];
  const { w, h } = DEFAULT_SIZE[id];
  const n = list.length;
  const start: WinRect = remembered ?? { id, x: 90 + n * 32, y: scr.top + 30 + n * 32, w, h };
  return [...list, fitRect({ ...start, collapsed: false }, scr)];
}

export const closeWin = (list: WinRect[], id: WinId): WinRect[] => list.filter((w) => w.id !== id);

export const focusWin = (list: WinRect[], id: WinId): WinRect[] => {
  const i = list.findIndex((w) => w.id === id);
  return i < 0 || i === list.length - 1 ? list : [...list.filter((w) => w.id !== id), list[i]];
};

const update = (list: WinRect[], id: WinId, fn: (w: WinRect) => WinRect) => list.map((w) => (w.id === id ? fn(w) : w));

export const moveWin = (list: WinRect[], id: WinId, x: number, y: number, scr: Screen): WinRect[] => update(list, id, (w) => fitRect({ ...w, x, y }, scr));
export const resizeWin = (list: WinRect[], id: WinId, w: number, h: number, scr: Screen): WinRect[] => update(list, id, (r) => fitRect({ ...r, w, h }, scr));
export const toggleWin = (list: WinRect[], id: WinId): WinRect[] => update(list, id, (w) => ({ ...w, collapsed: !w.collapsed }));

/** Windows after the screen changed size (a rotated tablet, a resized browser): every one is pulled back on screen. */
export const refitWins = (list: WinRect[], scr: Screen): WinRect[] => list.map((w) => fitRect(w, scr));
