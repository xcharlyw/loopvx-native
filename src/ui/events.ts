import type { GestureResponderEvent } from 'react-native';

/**
 * Horizontal tap position inside the pressed view.
 * react-native-web leaves `locationX` unset for finger taps (the press arrives as a plain DOM
 * click), so fall back to the pointer position relative to the view's on-screen box.
 */
export function tapX(e: GestureResponderEvent): number {
  const { locationX } = e.nativeEvent;
  if (Number.isFinite(locationX)) return locationX;
  const { clientX } = e.nativeEvent as unknown as { clientX?: number };
  const box = (e.currentTarget as unknown as { getBoundingClientRect?: () => { left: number } }).getBoundingClientRect?.();
  return box && clientX !== undefined && Number.isFinite(clientX) ? clientX - box.left : 0;
}

/** Vertical counterpart of tapX. */
export function tapY(e: GestureResponderEvent): number {
  const { locationY } = e.nativeEvent;
  if (Number.isFinite(locationY)) return locationY;
  const { clientY } = e.nativeEvent as unknown as { clientY?: number };
  const box = (e.currentTarget as unknown as { getBoundingClientRect?: () => { top: number } }).getBoundingClientRect?.();
  return box && clientY !== undefined && Number.isFinite(clientY) ? clientY - box.top : 0;
}
