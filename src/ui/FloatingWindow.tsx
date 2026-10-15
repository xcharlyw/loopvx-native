import { type ReactNode, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { C } from '../constants/theme';
import { closeWindow, focusWindow, moveWindow, resizeWindow, toggleWindow } from '../lib/windowActions';
import { TITLE_H, type WinRect } from '../lib/windows';
import { useDrag, web } from './drag';
import { SheetPlace } from './Sheet';

/**
 * A plugin window (wide screens): the panel's own title row is the title bar you drag, the corner grip resizes, a touch
 * anywhere brings it to the front, the arrow folds it to the title bar. The panel inside is the same one a phone shows as a sheet.
 */
export function FloatingWindow({ win, z, children }: { win: WinRect; z: number; children: ReactNode }) {
  const start = useRef<WinRect | null>(null);
  const drag = useDrag('start', true, (dx, dy, phase) => {
    if (phase === 'cancel') {
      start.current = null;
      return;
    }
    start.current ??= win;
    moveWindow(win.id, start.current.x + dx, start.current.y + dy);
    if (phase === 'end') start.current = null;
  });
  const sizeFrom = useRef<WinRect | null>(null);
  const grip = useDrag('start', !win.collapsed, (dx, dy, phase) => {
    if (phase === 'cancel') {
      sizeFrom.current = null;
      return;
    }
    sizeFrom.current ??= win;
    resizeWindow(win.id, sizeFrom.current.w + dx, sizeFrom.current.h + dy);
    if (phase === 'end') sizeFrom.current = null;
  });
  const place = { column: false, onClose: () => closeWindow(win.id), floating: { drag, collapsed: !!win.collapsed, onToggle: () => toggleWindow(win.id) } };
  return (
    <View
      accessibilityLabel={`Fenster ${win.id}`}
      onStartShouldSetResponderCapture={() => {
        focusWindow(win.id); // a touch anywhere in the window raises it, and still reaches what was touched
        return false;
      }}
      style={[s.win, { left: win.x, top: win.y, width: win.w, height: win.collapsed ? TITLE_H : win.h, zIndex: 25 + z }]}
    >
      <SheetPlace.Provider value={place}>{children}</SheetPlace.Provider>
      {!win.collapsed && <View {...grip} accessibilityLabel="Fenstergröße ziehen" style={[s.grip, web({ touchAction: 'none', cursor: 'nwse-resize' })]} />}
    </View>
  );
}

const s = StyleSheet.create({
  win: {
    position: 'absolute',
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: '#34343a',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  grip: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 22,
    height: 22,
    borderRightWidth: 3,
    borderBottomWidth: 3,
    borderColor: C.dim,
    borderBottomRightRadius: 10,
    opacity: 0.8,
  },
});
