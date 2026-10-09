import type { TextStyle } from 'react-native';

/** Design tokens, copied 1:1 from the original web app's `:root` in styles.css. */
export const C = {
  bg: '#0d0d0f',
  bg2: '#121214',
  panel: '#18181b',
  panel2: '#1f1f23',
  line: '#26262b',
  lineSoft: '#1b1b1f',
  text: '#ececef',
  muted: '#8b8b93',
  dim: '#5b5b63',
  accent: '#c6ff3d',
  accentInk: '#0d0d0f',
  danger: '#ff5a5a',
  mute: '#ff9a3d',
} as const;

export const RADIUS = 14;
export const RULER_H = 28;

/** Breakpoint-dependent sizes (the original's `@media (max-width: 720px)`). */
export const layout = (small: boolean) => ({
  headerW: small ? 112 : 176,
  rowH: small ? 60 : 68,
  slotW: small ? 118 : 150,
});

type Weight = 400 | 500 | 600 | 700;

const INTER: Record<Weight, string> = {
  400: 'Inter_400Regular',
  500: 'Inter_500Medium',
  600: 'Inter_600SemiBold',
  700: 'Inter_700Bold',
};

/** Custom fonts need one family per weight on native, so weights go through here. */
export const font = (weight: Weight = 400): TextStyle => ({ fontFamily: INTER[weight] });
export const mono = (weight: 400 | 500 = 400): TextStyle => ({
  fontFamily: weight === 500 ? 'JetBrainsMono_500Medium' : 'JetBrainsMono_400Regular',
});
