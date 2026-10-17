import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { C, font } from '../constants/theme';
import type { DeviceType } from '../types';
import { Txt } from './kit';
import { web } from './drag';

// Drag and drop between parts of the app (web), like Live's browser: a sample (a Library row or an audio clip), an instrument
// sound or an audio effect is picked up and dropped on a target such as the sampler, a track header or the device chain. Sources and targets live in different panels, so the drag state is a module store, the targets
// register their element and the hit test reads their rectangles while the pointer moves. On touch a drag starts with a long
// press (so a swipe still scrolls the list); with a mouse it starts after a few pixels.

export interface SamplePayload {
  kind?: 'sample';
  sampleId: string;
  name: string;
  /** Carried from an arrangement clip (not the browser): only targets that take any sample light up, not audio track headers. */
  fromClip?: boolean;
}
/** An audio effect from the browser (optionally one of its presets, factory or the user's own). */
export interface DevicePayload {
  kind: 'device';
  device: DeviceType;
  presetId?: string;
  name: string;
}
/** An instrument sound (a preset of the sound library). */
export interface SoundPayload {
  kind: 'sound';
  presetId: string;
  name: string;
}
export type DragPayload = SamplePayload | DevicePayload | SoundPayload;
type Kind = 'sample' | 'librarySample' | 'device' | 'sound';
const kindOf = (p: DragPayload): Kind => p.kind ?? 'sample';
/** The handler kinds a payload can land on: a sample from the browser also on `librarySample` targets. */
const kindsOf = (p: DragPayload): Kind[] => (p.kind === 'device' || p.kind === 'sound' ? [p.kind] : p.fromClip ? ['sample'] : ['sample', 'librarySample']);

/** What a target does with each kind it takes; a kind without a handler is not taken (the target does not light up for it). */
export interface DropHandlers {
  sample?: (p: SamplePayload) => void;
  /** A sample carried from the browser only (an audio track header places it; a clip dragged over it keeps moving). */
  librarySample?: (p: SamplePayload) => void;
  device?: (p: DevicePayload) => void;
  sound?: (p: SoundPayload) => void;
}

interface DragState {
  payload: DragPayload;
  x: number;
  y: number;
  /** The target under the pointer. */
  over: string | null;
}

interface Target {
  el: () => HTMLElement | null;
  kinds: () => Kind[];
  drop: (p: DragPayload) => void;
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

/** The smallest registered target under (x, y) that takes this kind: a card inside a panel wins over the panel. */
function targetAt(x: number, y: number, kinds: Kind[]): string | null {
  let best: string | null = null;
  let area = Infinity;
  for (const [id, t] of targets) {
    const own = t.kinds();
    if (!kinds.some((k) => own.includes(k))) continue;
    const r = t.el()?.getBoundingClientRect();
    if (!r || !r.width || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    if (r.width * r.height < area) {
      area = r.width * r.height;
      best = id;
    }
  }
  return best;
}

export function startSampleDrag(payload: DragPayload, x: number, y: number) {
  state = { payload, x, y, over: targetAt(x, y, kindsOf(payload)) };
  emit();
}
export function moveSampleDrag(x: number, y: number) {
  if (!state) return;
  state = { ...state, x, y, over: targetAt(x, y, kindsOf(state.payload)) };
  emit();
}
/** Ends the drag; true when it landed on a target (which has then taken what was carried). */
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
/** Whether the pointer is over a target for a sample (an arrangement clip drag uses it to tell a drop from a move). */
export const overDropTarget = (x: number, y: number) => targetAt(x, y, ['sample']) !== null;

/**
 * Registers a drop target for the kinds it has handlers for; returns the ref for its View, whether something it takes hovers over it
 * right now, and whether something it takes is being carried at all (`dragging`, to show the drop zones).
 */
export function useDropTarget(id: string, handlers: DropHandlers) {
  const ref = useRef<View>(null);
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!isWeb) return;
    targets.set(id, {
      el: () => ref.current as unknown as HTMLElement | null,
      kinds: () => (Object.keys(latest.current) as Kind[]).filter((k) => latest.current[k]),
      drop: (p) => {
        const h = latest.current;
        if (p.kind === 'device') h.device?.(p);
        else if (p.kind === 'sound') h.sound?.(p);
        else if (h.sample) h.sample(p);
        else if (!p.fromClip) h.librarySample?.(p);
      },
    });
    return () => {
      targets.delete(id);
    };
  }, [id]);
  const over = useSyncExternalStore(subscribe, () => state?.over === id, () => false);
  const dragging = useSyncExternalStore(subscribe, () => !!state && kindsOf(state.payload).some((k) => !!latest.current[k]), () => false);
  return { ref, over, dragging };
}

/** A target for samples only. */
export const useSampleDropTarget = (id: string, drop: (p: SamplePayload) => void) => useDropTarget(id, { sample: drop });

const LONG_PRESS_MS = 350;

/**
 * Makes a View a drag source for a sample, a sound or an effect (web). Mouse: press and move a few pixels. Touch: hold still for a moment, then
 * drag (the page does not scroll while a sample is carried). Returns the ref for the View.
 */
export function useSampleDragSource(payload: DragPayload | null) {
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

const GLYPH: Record<Kind, string> = { sample: '♪', librarySample: '♪', device: '≋', sound: '◆' };

/** What is carried, following the pointer (rendered once at the top of the app). */
export function SampleDragGhost() {
  const s = useSyncExternalStore(subscribe, () => state, () => null);
  if (!s) return null;
  return (
    <View pointerEvents="none" style={[st.ghost, web({ position: 'fixed' }), { left: s.x + 12, top: s.y - 34 }, s.over ? st.ghostOver : null]}>
      <Txt numberOfLines={1} style={[st.ghostText, s.over ? { color: C.accentInk } : null]}>
        {`${GLYPH[kindOf(s.payload)]} ${s.payload.name.replace(/\.[a-z0-9]+$/i, '')}`}
      </Txt>
    </View>
  );
}

const st = StyleSheet.create({
  ghost: { position: 'absolute', zIndex: 1000, maxWidth: 240, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1c1c22', borderWidth: 1, borderColor: C.accent },
  ghostOver: { backgroundColor: C.accent },
  ghostText: { ...font(600), fontSize: 12, color: C.text },
});
