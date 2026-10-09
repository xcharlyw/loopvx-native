import { useEffect, useState, useSyncExternalStore } from 'react';
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
