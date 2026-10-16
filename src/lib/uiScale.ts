// The size of the whole interface (web): Karl wants to see more at once, so everything can be zoomed out. The app
// root is zoomed with CSS (`zoom`) and made 1/scale larger, so it still fills the window; code that measures the
// window (docked panels, windows, breakpoints) uses `scaledSize` to see the room it really has.

export const UI_SCALES = [1, 0.9, 0.8, 0.7] as const;
export const UI_SCALE_LABEL: Record<number, string> = { 1: 'Normal (100 %)', 0.9: 'Klein (90 %)', 0.8: 'Kleiner (80 %)', 0.7: 'Winzig (70 %)' };

/** The nearest allowed scale (anything unknown means normal). */
export function clampUiScale(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  return UI_SCALES.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), 1 as number);
}

/** The window size in the zoomed interface's own pixels. */
export const scaledSize = (win: { width: number; height: number }, scale: number) => ({ width: Math.round(win.width / scale), height: Math.round(win.height / scale) });

/** A drag of `d` screen pixels is `d / scale` pixels of the zoomed interface. */
export const unscaleDrag = (d: number, scale: number) => d / scale;
