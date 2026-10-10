import type { ReactNode } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { C } from '../constants/theme';

/** Same 24x24 stroke icons (and path data) as the original web app's icons.tsx. */
type P = { size?: number; color?: string };

function Icon({ size = 18, color = C.text, children }: P & { children: ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      color={color}
    >
      {children}
    </Svg>
  );
}

const solid = { fill: 'currentColor', stroke: 'none' } as const;

export const Play = (p: P) => (
  <Icon {...p}>
    <Path d="M7 4.5v15l12-7.5z" {...solid} />
  </Icon>
);
export const Stop = (p: P) => (
  <Icon {...p}>
    <Rect x="6" y="6" width="12" height="12" rx="2" {...solid} />
  </Icon>
);
export const Rewind = (p: P) => (
  <Icon {...p}>
    <Path d="M11 6 4 12l7 6zM20 6l-7 6 7 6z" {...solid} />
  </Icon>
);
export const LoopIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M17 2l3 3-3 3" />
    <Path d="M4 11V9a4 4 0 0 1 4-4h12" />
    <Path d="M7 22l-3-3 3-3" />
    <Path d="M20 13v2a4 4 0 0 1-4 4H4" />
  </Icon>
);
export const Export = (p: P) => (
  <Icon {...p}>
    <Path d="M14 4h6v6" />
    <Path d="M20 4 10 14" />
    <Path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
  </Icon>
);
export const LibraryIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M4 4v16M8 4v16M13 4l5 16" />
  </Icon>
);
export const Mixer = (p: P) => (
  <Icon {...p}>
    <Path d="M6 4v16M12 4v16M18 4v16" />
    <Rect x="4" y="13" width="4" height="3" rx="1" fill="currentColor" />
    <Rect x="10" y="7" width="4" height="3" rx="1" fill="currentColor" />
    <Rect x="16" y="11" width="4" height="3" rx="1" fill="currentColor" />
  </Icon>
);
export const GridIcon = (p: P) => (
  <Icon {...p}>
    <Rect x="4" y="4" width="7" height="7" rx="1.5" />
    <Rect x="13" y="4" width="7" height="7" rx="1.5" />
    <Rect x="4" y="13" width="7" height="7" rx="1.5" />
    <Rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Icon>
);
export const TimelineIcon = (p: P) => (
  <Icon {...p}>
    <Path d="M4 6h10M4 12h16M4 18h7" />
  </Icon>
);
export const Plus = (p: P) => (
  <Icon {...p}>
    <Path d="M12 5v14M5 12h14" />
  </Icon>
);
export const Close = (p: P) => (
  <Icon {...p}>
    <Path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const ZoomIn = (p: P) => (
  <Icon {...p}>
    <Circle cx="11" cy="11" r="6" />
    <Path d="M20 20l-4.5-4.5M11 8v6M8 11h6" />
  </Icon>
);
export const ZoomOut = (p: P) => (
  <Icon {...p}>
    <Circle cx="11" cy="11" r="6" />
    <Path d="M20 20l-4.5-4.5M8 11h6" />
  </Icon>
);
export const ArrowUp = (p: P) => (
  <Icon {...p}>
    <Path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);
export const Wave = (p: P) => (
  <Icon {...p}>
    <Path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" />
  </Icon>
);
export const Sparkle = (p: P) => (
  <Icon {...p}>
    <Path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" {...solid} />
    <Path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" {...solid} />
  </Icon>
);
export const Trash = (p: P) => (
  <Icon {...p}>
    <Path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);
export const Copy = (p: P) => (
  <Icon {...p}>
    <Rect x="8" y="8" width="12" height="12" rx="2" />
    <Path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </Icon>
);
export const Metronome = (p: P) => (
  <Icon {...p}>
    <Path d="M9.5 3h5l4 18h-13zM12 15l5-8M7.5 17h9" />
  </Icon>
);
export const Undo = (p: P) => (
  <Icon {...p}>
    <Path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);
export const Redo = (p: P) => (
  <Icon {...p}>
    <Path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
);
export const Pencil = (p: P) => (
  <Icon {...p}>
    <Path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
  </Icon>
);
export const Scissors = (p: P) => (
  <Icon {...p}>
    <Circle cx="6" cy="6" r="3" />
    <Circle cx="6" cy="18" r="3" />
    <Path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
  </Icon>
);
export const Check = (p: P) => (
  <Icon {...p}>
    <Path d="M5 12l5 5 9-10" />
  </Icon>
);
export const Upload = (p: P) => (
  <Icon {...p}>
    <Path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
  </Icon>
);
export const More = (p: P) => (
  <Icon {...p}>
    <Circle cx="5" cy="12" r="1.5" fill="currentColor" />
    <Circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <Circle cx="19" cy="12" r="1.5" fill="currentColor" />
  </Icon>
);
/** Chrome's `<select>` arrow (the original's key picker is a native select), measured 1:1 in px. */
export const SelectArrow = ({ color = C.text }: { color?: string }) => (
  <Svg width={22} height={14} viewBox="0 0 22 14">
    <Path d="M10.6 5.2 15 8.8l4.4-3.6" fill="none" stroke={color} strokeWidth={2.2} />
  </Svg>
);
