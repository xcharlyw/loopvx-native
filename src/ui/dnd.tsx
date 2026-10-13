import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { C, font } from '../constants/theme';
import { Txt } from './kit';
import { web } from './drag';

// Drag and drop of samples between parts of the app (web): a Library row or an audio clip is picked up and dropped on a
// target such as the sampler. Sources and targets live in different panels, so the drag state is a module store, the targets
// register their element and the hit test reads their rectangles while the pointer moves. On touch a drag starts with a long
// press (so a swipe still scrolls the list); with a mouse it starts after a few pixels.

export interface SamplePayload {
  sampleId: string;
  name: string;
}

interface DragState {
  payload: SamplePayload;
  x: number;
  y: number;
  /** The target under the pointer. */
  over: string | null;
}

interface Target {
  el: () => HTMLElement | null;
  drop: (p: SamplePayload) => void;
}

const isWeb = Platform.OS === 'web';
let state: DragState | null = null;
let endedAt = 0;
const targets = new Map<string, Target>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The smallest registered target under (x, y): a card inside a panel wins over the panel. */
function targetAt(x: number, y: number): string | null {
  let best: string | null = null;
  let area = Infinity;
  for (const [id, t] of targets) {
    const r = t.el()?.getBoundingClientRect();
    if (!r || !r.width || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    if (r.width * r.height < area) {
      area = r.width * r.height;
      best = id;
    }
  }
  return best;
}

export function startSampleDrag(payload: SamplePayload, x: number, y: number) {
  state = { payload, x, y, over: targetAt(x, y) };
  emit();
}
export function moveSampleDrag(x: number, y: number) {
  if (!state) return;
  state = { ...state, x, y, over: targetAt(x, y) };
  emit();
}
/** Ends the drag; true when it landed on a target (which has then taken the sample). */
export function endSampleDrag(): boolean {
  const s = state;
  state = null;
  endedAt = Date.now();
  emit();
  if (!s?.over) return false;
  targets.get(s.over)?.drop(s.payload);
  return true;
}
export function cancelSampleDrag() {
  if (!state) return;
  state = null;
  emit();
}
/** The release of a drag also arrives as a press on the row it started on: callers skip that press. */
export const sampleDragJustEnded = () => Date.now() - endedAt < 350;
/** Whether the pointer is over a drop target (an arrangement clip drag uses it to tell a drop from a move). */
export const overDropTarget = (x: number, y: number) => targetAt(x, y) !== null;

/** Registers a drop target; returns the ref for its View and whether a sample hovers over it right now. */
export function useSampleDropTarget(id: string, drop: (p: SamplePayload) => void) {
  const ref = useRef<View>(null);
  const latest = useRef(drop);
  useEffect(() => {
    latest.current = drop;
  });
  useEffect(() => {
    if (!isWeb) return;
    targets.set(id, { el: () => ref.current as unknown as HTMLElement | null, drop: (p) => latest.current(p) });
    return () => {
      targets.delete(id);
    };
  }, [id]);
  const over = useSyncExternalStore(subscribe, () => state?.over === id, () => false);
  const dragging = useSyncExternalStore(subscribe, () => !!state, () => false);
  return { ref, over, dragging };
}

const LONG_PRESS_MS = 350;

/**
 * Makes a View a drag source for a sample (web). Mouse: press and move a few pixels. Touch: hold still for a moment, then
 * drag (the page does not scroll while a sample is carried). Returns the ref for the View.
 */
export function useSampleDragSource(payload: SamplePayload | null) {
  const ref = useRef<View>(null);
  const latest = useRef(payload);
  useEffect(() => {
    latest.current = payload;
  });
  useEffect(() => {
    const el = ref.current as unknown as HTMLElement | null;
    if (!isWeb || !el?.addEventListener) return;
    let cleanup: (() => void) | null = null;
    const onDown = (e: PointerEvent) => {
      const p = latest.current;
      if (!p || (e.pointerType === 'mouse' && e.button !== 0)) return;
      cleanup?.();
      const x0 = e.clientX;
      const y0 = e.clientY;
      let active = false;
      const begin = (x: number, y: number) => {
        active = true;
        startSampleDrag(p, x, y);
      };
      if (e.pointerType === 'mouse') {
        const move = (m: PointerEvent) => {
          if (!active && Math.hypot(m.clientX - x0, m.clientY - y0) > 6) begin(m.clientX, m.clientY);
          if (active) moveSampleDrag(m.clientX, m.clientY);
        };
        const up = () => {
          if (active) endSampleDrag();
          cleanup?.();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        cleanup = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          cleanup = null;
        };
        return;
      }
      // Touch: a long press picks the sample up; moving before that is a scroll and cancels it.
      const timer = setTimeout(() => {
        begin(x0, y0);
        navigator.vibrate?.(15);
      }, LONG_PRESS_MS);
      const tmove = (t: TouchEvent) => {
        const touch = t.touches[0];
        if (!touch) return;
        if (!active) {
          if (Math.hypot(touch.clientX - x0, touch.clientY - y0) > 8) cleanup?.();
          return;
        }
        t.preventDefault(); // carrying a sample: no scrolling
        moveSampleDrag(touch.clientX, touch.clientY);
      };
      const tend = () => {
        if (active) endSampleDrag();
        cleanup?.();
      };
      window.addEventListener('touchmove', tmove, { passive: false });
      window.addEventListener('touchend', tend);
      window.addEventListener('touchcancel', tend);
      cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener('touchmove', tmove);
        window.removeEventListener('touchend', tend);
        window.removeEventListener('touchcancel', tend);
        cleanup = null;
      };
    };
    el.addEventListener('pointerdown', onDown);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      cleanup?.();
    };
  }, []);
  return ref;
}

/** The carried sample, following the pointer (rendered once at the top of the app). */
export function SampleDragGhost() {
  const s = useSyncExternalStore(subscribe, () => state, () => null);
  if (!s) return null;
  return (
    <View pointerEvents="none" style={[st.ghost, web({ position: 'fixed' }), { left: s.x + 12, top: s.y - 34 }, s.over ? st.ghostOver : null]}>
      <Txt numberOfLines={1} style={[st.ghostText, s.over ? { color: C.accentInk } : null]}>
        {`♪ ${s.payload.name.replace(/\.[a-z0-9]+$/i, '')}`}
      </Txt>
    </View>
  );
}

const st = StyleSheet.create({
  ghost: { position: 'absolute', zIndex: 1000, maxWidth: 240, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1c1c22', borderWidth: 1, borderColor: C.accent },
  ghostOver: { backgroundColor: C.accent },
  ghostText: { ...font(600), fontSize: 12, color: C.text },
});
