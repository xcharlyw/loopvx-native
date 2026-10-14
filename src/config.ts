import { Platform } from 'react-native';

// Branding lives here so the app can be renamed in one place (also update app.json).
export const APP_NAME = 'LOOPVX';

export const BEATS_PER_BAR = 4;

/** Brand lime, shared with the SoulVX sister app. */
export const BRAND_COLOR = '#c6ff3d';

// Public by design (a publishable key only works through RLS / Auth); never put a secret key here.
export const SUPABASE_URL = 'https://imjsaqqbfpyegkkqcgzf.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_XlXcSoqbc0Wb5koV_b-nyg_DxhkpgPt';

/** Vercel Functions in api/. The web build is served from the same host. */
const API_BASE = Platform.OS === 'web' ? '/api' : 'https://loopvx-native.vercel.app/api';
/** The ElevenLabs proxy. */
export const VOCALS_ENDPOINT = `${API_BASE}/vocals`;
/** Stem separation (ElevenLabs; the tune and its stems travel through the user's Drive). */
export const STEMS_ENDPOINT = `${API_BASE}/stems`;
/** Gemini arrangement planner (the key stays on the server). */
export const ARRANGE_ENDPOINT = `${API_BASE}/arrange`;
/** Splice connection (OAuth + MCP proxy; the user's Splice tokens stay on the device). */
export const SPLICE_ENDPOINT = `${API_BASE}/splice`;
/** Trades the Google refresh token for a Drive access token (needs the client secret, so server-side). */
export const DRIVE_TOKEN_ENDPOINT = `${API_BASE}/drive-token`;

/** Drive access: the app's own LOOPVX folder (drive.file) for sync ... */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** ... plus read-only access to the rest of Drive, only used to import loops the user picks (never writes there). */
export const DRIVE_READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const DRIVE_SCOPE = `${DRIVE_FILE_SCOPE} ${DRIVE_READ_SCOPE}`;
