import { Dimensions } from 'react-native';
import { getState, setState } from './store';
import { closeWin, focusWin, moveWin, openWin, refitWins, resizeWin, toggleWin, type Screen, type WinId } from './windows';

/** The room plugin windows have: the whole window below the desktop menu bar. */
export function screenArea(): Screen {
  const { width, height } = Dimensions.get('window');
  return { width, height, top: MENU_BAR_TOP };
}
const MENU_BAR_TOP = 30; // = MENU_BAR_H

export const openWindow = (id: WinId) =>
  setState((s) => ({ windows: openWin(s.windows, id, screenArea(), s.winMemory[id]), panel: s.panel === id ? 'none' : s.panel }));

export const closeWindow = (id: WinId) =>
  setState((s) => {
    const rect = s.windows.find((w) => w.id === id);
    return { windows: closeWin(s.windows, id), winMemory: rect ? { ...s.winMemory, [id]: rect } : s.winMemory };
  });

export const focusWindow = (id: WinId) => {
  const next = focusWin(getState().windows, id);
  if (next !== getState().windows) setState({ windows: next });
};
export const moveWindow = (id: WinId, x: number, y: number) => setState((s) => ({ windows: moveWin(s.windows, id, x, y, screenArea()) }));
export const resizeWindow = (id: WinId, w: number, h: number) => setState((s) => ({ windows: resizeWin(s.windows, id, w, h, screenArea()) }));
export const toggleWindow = (id: WinId) => setState((s) => ({ windows: toggleWin(s.windows, id) }));
export const refitWindows = () => setState((s) => (s.windows.length ? { windows: refitWins(s.windows, screenArea()) } : {}));
