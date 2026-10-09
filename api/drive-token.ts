// Vercel Function: trades the user's Google refresh token for a short-lived Drive access token.
// Refreshing needs the OAuth client secret, which must never reach the app, so it lives here
// (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET: the same Google client the Supabase login uses).
import { authorize, text } from './_lib/auth';

export async function POST(req: Request): Promise<Response> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return text(500, 'Google Drive ist auf dem Server nicht eingerichtet (GOOGLE_CLIENT_ID/SECRET fehlen)');
  const denied = await authorize(req);
  if (denied) return text(401, denied);

  let refreshToken: string | undefined;
  try {
    refreshToken = ((await req.json()) as { refreshToken?: string }).refreshToken;
  } catch {
    return text(400, 'Ungültige Anfrage');
  }
  if (!refreshToken) return text(400, 'Google Drive ist nicht verbunden');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  // invalid_grant: revoked, expired (7 days while the consent screen is in "Testing"), or a different client.
  if (json.error === 'invalid_grant') return text(401, 'Google-Drive-Zugriff abgelaufen, bitte neu mit Google anmelden');
  if (!res.ok || !json.access_token) return text(502, `Google: ${json.error ?? res.status}`);
  return Response.json({ accessToken: json.access_token, expiresIn: json.expires_in ?? 3600 }, { headers: { 'Cache-Control': 'no-store' } });
}
