import { Platform } from 'react-native';
import { BRAND_COLOR } from '../config';
import type { SampleCategory } from '../types';

/** Dark, Suno-studio-style palette. LOOPVX is dark-first; a light theme is not a current goal. */
export const Colors = {
  background: '#0b0b0d',
  surface: '#15151a',
  surfaceRaised: '#1d1d24',
  border: '#2a2a32',
  text: '#f2f2f5',
  textSecondary: '#8c8c96',
  accent: BRAND_COLOR,
  danger: '#ff5a5a',
} as const;

export const CategoryColors: Record<SampleCategory, string> = {
  kick: '#ff5a36',
  top: '#ffc53d',
  synth: '#3dd6ff',
  vocal: BRAND_COLOR,
  other: '#b28cff',
};

export const Fonts = Platform.select({
  ios: { mono: 'ui-monospace', sans: 'system-ui' },
  default: { mono: 'monospace', sans: 'normal' },
});

export const Spacing = { half: 2, one: 4, two: 8, three: 16, four: 24, five: 32 } as const;
