import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { SPLICE_ENDPOINT } from '../config';
import type { Sample } from '../types';
import { PACK_FACETS, mergeResults, parseSearchResults, sampleFromSplice, spliceSampleId, type SpliceResult } from './spliceResults';
import { getSession } from './supabase';
import { getState, setSamples } from './store';
import { storeSampleAudio } from './samples';

// Splice in LOOPVX: log in once (OAuth with PKCE, through the Vercel function), then search the catalog and download
// sounds into the library. The user's Splice tokens are kept on this device only.

const TOKENS_KEY = 'loopvx:splice';
const PENDING_KEY = 'loopvx:splice:pending';

interface Stored {
  clientId: string;
  redirectUri: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

/** The token is no longer valid and cannot be renewed: connect to Splice again. */
export class SpliceAuthError extends Error {}

export const spliceAvailable = () => Platform.OS === 'web';

async function stored(): Promise<Stored | null> {
  const raw = await AsyncStorage.getItem(TOKENS_KEY);
  return raw ? (JSON.parse(raw) as Stored) : null;
}

export async function spliceConnected(): Promise<boolean> {
  return Boolean(await stored());
}

export async function disconnectSplice(): Promise<void> {
  await AsyncStorage.removeItem(TOKENS_KEY);
}

// ---------------------------------------------------------------- PKCE

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomString(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** S256 code challenge of a PKCE verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

// ---------------------------------------------------------------- calls to the Vercel function

async function post(body: object): Promise<Response> {
  const session = await getSession();
  if (!session) throw new Error('Bitte zuerst anmelden');
  const res = await fetch(SPLICE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
  if (!res.ok) {
    const message = (await res.text().catch(() => '')) || `Splice-Fehler ${res.status}`;
    throw res.status === 401 && /Splice/.test(message) ? new SpliceAuthError(message) : new Error(message);
  }
  return res;
}

async function saveTokens(prev: Pick<Stored, 'clientId' | 'redirectUri'>, t: { accessToken: string; refreshToken?: string; expiresIn: number }, oldRefresh?: string) {
  const next: Stored = { ...prev, accessToken: t.accessToken, refreshToken: t.refreshToken ?? oldRefresh, expiresAt: Date.now() + t.expiresIn * 1000 };
  await AsyncStorage.setItem(TOKENS_KEY, JSON.stringify(next));
  return next;
}

/** A valid access token, renewed with the refresh token when it ran out. */
async function accessToken(): Promise<string> {
  const s = await stored();
  if (!s) throw new SpliceAuthError('Splice ist nicht verbunden');
  if (s.expiresAt > Date.now() + 60_000) return s.accessToken;
  if (!s.refreshToken) throw new SpliceAuthError('Splice-Zugriff abgelaufen, bitte neu verbinden');
  try {
    const t = await (await post({ action: 'refresh', refreshToken: s.refreshToken, clientId: s.clientId })).json();
    return (await saveTokens(s, t, s.refreshToken)).accessToken;
  } catch (e) {
    await disconnectSplice();
    throw e instanceof SpliceAuthError ? e : new SpliceAuthError('Splice-Zugriff abgelaufen, bitte neu verbinden');
  }
}

// ---------------------------------------------------------------- login

/** Opens Splice's login page; Splice comes back to /splice-callback, which calls `completeSpliceLogin`. */
export async function connectSplice(): Promise<void> {
  if (!spliceAvailable()) throw new Error('Die Splice-Anbindung gibt es bisher nur in der Web-Version.');
  const redirectUri = `${window.location.origin}/splice-callback`;
  const verifier = randomString(48);
  const state = randomString(16);
  const { authUrl, clientId } = (await (await post({ action: 'start', redirectUri, codeChallenge: await pkceChallenge(verifier), state })).json()) as { authUrl: string; clientId: string };
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, clientId, redirectUri }));
  window.location.assign(authUrl);
}

/** Finishes the login when Splice sends the user back with ?code=...&state=... Returns an error text, or null on success. */
export async function completeSpliceLogin(search: string): Promise<string | null> {
  const params = new URLSearchParams(search);
  const pendingRaw = await AsyncStorage.getItem(PENDING_KEY);
  await AsyncStorage.removeItem(PENDING_KEY);
  if (params.get('error')) return `Splice: ${params.get('error_description') ?? params.get('error')}`;
  const code = params.get('code');
  if (!code || !pendingRaw) return 'Die Splice-Anmeldung wurde nicht abgeschlossen.';
  const pending = JSON.parse(pendingRaw) as { verifier: string; state: string; clientId: string; redirectUri: string };
  if (params.get('state') !== pending.state) return 'Die Splice-Anmeldung passt nicht zur Anfrage (state).';
  try {
    const t = await (await post({ action: 'token', code, codeVerifier: pending.verifier, redirectUri: pending.redirectUri, clientId: pending.clientId })).json();
    await saveTokens(pending, t);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Splice-Anmeldung fehlgeschlagen';
  }
}

// ---------------------------------------------------------------- search and download

export interface SearchOptions {
  query: string;
  type?: 'loop' | 'oneshot';
  bpmMin?: number;
  bpmMax?: number;
}

export async function searchSplice(opts: SearchOptions): Promise<SpliceResult[]> {
  const res = await post({ action: 'search', accessToken: await accessToken(), ...opts });
  return parseSearchResults(((await res.json()) as { text: string }).text);
}

/**
 * Sounds that go with a pack's name. Splice's search answers ten sounds per question, so this asks several (the name plus
 * kick, snare, bass ...) and merges them: a good cross-section of the pack (or its label), not the complete pack.
 */
export async function searchPackNamed(name: string, opts: Omit<SearchOptions, 'query'> = {}): Promise<SpliceResult[]> {
  const token = await accessToken();
  const lists = await Promise.all(
    PACK_FACETS.map(async (facet) => parseSearchResults(((await (await post({ action: 'search', accessToken: token, query: `${name} ${facet}`, ...opts })).json()) as { text: string }).text)),
  );
  return mergeResults(lists);
}

export const spliceInLibrary = (r: SpliceResult) => getState().samples.some((s) => s.id === spliceSampleId(r.uuid));

/** The audio bytes behind a presigned link: straight from the browser if the host allows it, else through the function. */
async function fetchAudio(url: string): Promise<ArrayBuffer> {
  try {
    const direct = await fetch(url);
    if (direct.ok) return direct.arrayBuffer();
  } catch {
    // blocked by CORS: go through the server
  }
  return (await post({ action: 'fetch', url })).arrayBuffer();
}

const extFromUrl = (url: string) => (/\.(wav|mp3|aif|aiff|flac|ogg|m4a)(\?|$)/i.exec(url)?.[1] ?? 'wav').toLowerCase();

/** Downloads a sound (the first time this spends one Splice credit, so the caller asks first) and adds it to the library. */
export async function downloadFromSplice(r: SpliceResult): Promise<Sample> {
  const { url } = (await (await post({ action: 'download', accessToken: await accessToken(), assetUuid: r.uuid })).json()) as { url: string };
  const data = await fetchAudio(url);
  const sample = sampleFromSplice(r, extFromUrl(url));
  await storeSampleAudio(sample, data, extFromUrl(url));
  setSamples([...getState().samples.filter((x) => x.id !== sample.id), sample]);
  return sample;
}
