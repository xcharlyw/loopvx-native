import { useEffect, useRef, type RefObject } from 'react';
import { Platform, type View } from 'react-native';

// Arrow keys in the browser (web, like Live): once the pointer went down inside the browser it has the keyboard, ↑/↓ move the
// selection, → opens a folder or a device's presets, ← goes back, Enter loads the item. A pointer down anywhere else gives the keys
// back to the arrangement (↑/↓ select tracks there). The keys are taken in the capture phase, before a clicked row (a focused button
// on web) could treat Enter as a press of itself.

export type BrowserKey = 'up' | 'down' | 'left' | 'right' | 'enter';

let focused = false;
let handler: ((key: BrowserKey) => boolean) | null = null;

const KEYS: Record<string, BrowserKey> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'enter' };

/** True when the browser took the key. */
function browserKey(e: KeyboardEvent): boolean {
  const key = KEYS[e.key];
  if (!focused || !handler || !key || e.metaKey || e.ctrlKey || e.altKey) return false;
  return handler(key);
}

/** Registers the browser's key handler and tracks whether the browser has the keyboard; returns the ref for the browser's root View. */
export function useBrowserKeys(onKey: (key: BrowserKey) => boolean): RefObject<View | null> {
  const ref = useRef<View>(null);
  const latest = useRef(onKey);
  useEffect(() => {
    latest.current = onKey;
  });
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    handler = (k) => latest.current(k);
    const down = (e: PointerEvent) => {
      const el = ref.current as unknown as HTMLElement | null;
      focused = !!el && el.contains(e.target as Node);
    };
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (!browserKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      handler = null;
      focused = false;
    };
  }, []);
  return ref;
}

/** Scrolls the selected row into view (web) after the arrow keys moved the selection. */
export function revealRow(id: string | null) {
  if (Platform.OS !== 'web' || !id || typeof document === 'undefined') return;
  document.getElementById(rowDomId(id))?.scrollIntoView?.({ block: 'nearest' });
}

/** The DOM id of a browser row (`nativeID` on web). */
export const rowDomId = (id: string) => `browser-row:${id}`;
