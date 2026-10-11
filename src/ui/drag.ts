import { useMemo, useRef } from 'react';
import { PanResponder, Platform, type ViewStyle } from 'react-native';

/** Web-only style keys RN's types don't know. */
export const web = (style: Record<string, string>) => (Platform.OS === 'web' ? (style as ViewStyle) : undefined);

export type DragPhase = 'move' | 'end' | 'cancel';

/** Where the finger is on the page (absolute), for gestures that care about screen edges. */
export interface DragPoint {
  x: number;
  y: number;
}

/** The responder system's touch record (present on native and react-native-web, missing from RN's event type). */
interface TouchHistory {
  indexOfSingleActiveTouch: number;
  touchBank: ({ startPageX: number; startPageY: number; currentPageX: number; currentPageY: number } | undefined)[];
}

/** Pan gesture that reports its offset; `claim` decides whether it takes over the touch. */
export function useDrag(claim: 'start' | 'move', enabled: boolean, onDrag: (dx: number, dy: number, phase: DragPhase, at?: DragPoint) => void) {
  const latest = useRef({ enabled, onDrag });
  latest.current = { enabled, onDrag };
  // The gesture's dx/dy restart at 0 when it takes over mid-move; add back the distance travelled before that.
  const lead = useRef({ dx: 0, dy: 0 });
  return useMemo(
    () =>
      PanResponder.create({
        onPanResponderGrant: (e) => {
          const history = (e as unknown as { touchHistory: TouchHistory }).touchHistory;
          const touch = history.touchBank[history.indexOfSingleActiveTouch];
          lead.current = touch ? { dx: touch.currentPageX - touch.startPageX, dy: touch.currentPageY - touch.startPageY } : { dx: 0, dy: 0 };
        },
        // Edge handles take the touch at once; the clip body only once it moves, so a tap still reaches its Pressable.
        onStartShouldSetPanResponder: () => claim === 'start' && latest.current.enabled,
        onMoveShouldSetPanResponderCapture: (_, g) =>
          claim === 'move' && latest.current.enabled && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 6),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => latest.current.onDrag(lead.current.dx + g.dx, lead.current.dy + g.dy, 'move', { x: g.moveX, y: g.moveY }),
        onPanResponderRelease: (_, g) => latest.current.onDrag(lead.current.dx + g.dx, lead.current.dy + g.dy, 'end', { x: g.moveX, y: g.moveY }),
        onPanResponderTerminate: () => latest.current.onDrag(0, 0, 'cancel'),
      }).panHandlers,
    [claim],
  );
}
