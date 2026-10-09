import './url-polyfill';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';

const isWeb = Platform.OS === 'web';

let client: SupabaseClient | null = null;

/**
 * Created on first use, not at import: Expo pre-renders the web build in Node, where the
 * client's session restore would touch `window.localStorage` and crash the export.
 */
export function supabase(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // Web returns from Google with ?code= in the URL; native hands the code back from the auth session instead.
      detectSessionInUrl: isWeb,
      flowType: 'pkce',
    },
  });
  return client;
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase().auth.getSession();
  return data.session;
}

export async function signIn(): Promise<void> {
  if (isWeb) {
    const { error } = await supabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) throw error;
    return;
  }
  const redirectTo = Linking.createURL('auth-callback');
  const { data, error } = await supabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return;
  const code = Linking.parse(result.url).queryParams?.code;
  if (typeof code !== 'string') throw new Error('Anmeldung fehlgeschlagen');
  const { error: exchangeError } = await supabase().auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
}

/** Current session, kept up to date across sign-in, sign-out and token refresh. */
export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    void getSession().then(setSession);
    const { data } = supabase().auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}
