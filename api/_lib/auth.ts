// Shared by the API functions (the leading underscore keeps Vercel from deploying this file as one).
// A request must carry the caller's Supabase session token; ALLOWED_EMAILS optionally limits who
// may use the functions, since they spend paid credits or use the app's Google client secret.

/** Returns an error message, or null when the caller may proceed. */
export async function authorize(req: Request): Promise<string | null> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return 'Supabase ist auf dem Server nicht konfiguriert';
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return 'Bitte zuerst anmelden';
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!res.ok) return 'Sitzung ungültig, bitte neu anmelden';
  const user = (await res.json()) as { email?: string };
  const allowed = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length && !allowed.includes((user.email ?? '').toLowerCase())) return 'Dieser Account ist nicht freigeschaltet';
  return null;
}

export function text(status: number, message: string): Response {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
