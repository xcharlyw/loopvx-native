import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { scaledSize } from '../lib/uiScale';
import { engine } from '../audio/engine';
import { useStore } from '../lib/store';

/** Re-render whenever the engine reports transport changes. */
export function useEngine<T>(read: () => T): T {
  return useSyncExternalStore((cb) => engine.subscribe(cb), read);
}

/** Playhead position in bars, updated every animation frame while playing. */
export function usePlayhead(): number {
  const playing = useEngine(() => engine.playing);
  const [pos, setPos] = useState(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      setPos(engine.position());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  const cursor = useStore((s) => s.cursor);
  return playing ? pos : cursor;
}

/** The original's `@media (max-width: 720px)` breakpoint. */
export function useSmall(): boolean {
  return useAppDims().width <= 720;
}

/** The window size in the interface's own pixels: a zoomed-out interface (`uiScale` < 1) has more room than the window says. */
export function useAppDims(): { width: number; height: number } {
  const win = useWindowDimensions();
  const scale = useStore((st) => (Platform.OS === 'web' ? st.uiScale : 1));
  return scaledSize(win, scale);
}
