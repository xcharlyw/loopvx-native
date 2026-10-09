import { Platform } from 'react-native';

// Branding lives here so the app can be renamed in one place (also update app.json).
export const APP_NAME = 'LOOPVX';

export const BEATS_PER_BAR = 4;

/** Brand lime, shared with the SoulVX sister app. */
export const BRAND_COLOR = '#c6ff3d';

// Public by design (a publishable key only works through RLS / Auth); never put a secret key here.
export const SUPABASE_URL = 'https://imjsaqqbfpyegkkqcgzf.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_XlXcSoqbc0Wb5koV_b-nyg_DxhkpgPt';

/** The ElevenLabs proxy (Vercel Function in api/). The web build is served from the same host. */
export const VOCALS_ENDPOINT = Platform.OS === 'web' ? '/api/vocals' : 'https://loopvx-native.vercel.app/api/vocals';
