import { POST } from '../api/drive-token';

describe('POST /api/drive-token', () => {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...realEnv };
  });

  const request = (body: unknown, token = 'tok') =>
    new Request('http://x/api/drive-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  function setup(google: { status?: number; body: unknown }, allowed = 'karl@example.com') {
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.SUPABASE_URL = 'https://sb.example';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.ALLOWED_EMAILS = allowed;
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ email: 'karl@example.com' }));
      if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify(google.body), { status: google.status ?? 200 });
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    return calls;
  }

  it('refreshes the token with the server-side client secret', async () => {
    const calls = setup({ body: { access_token: 'ya29.x', expires_in: 3599 } });
    const res = await POST(request({ refreshToken: '1//r' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accessToken: 'ya29.x', expiresIn: 3599 });
    const form = new URLSearchParams(calls.find((c) => c.url.includes('oauth2'))!.init!.body as string);
    expect(form.get('client_secret')).toBe('secret');
    expect(form.get('refresh_token')).toBe('1//r');
    expect(form.get('grant_type')).toBe('refresh_token');
  });

  it('rejects users that are not on the allow list without calling Google', async () => {
    const calls = setup({ body: {} }, 'someone@else.com');
    const res = await POST(request({ refreshToken: '1//r' }));
    expect(res.status).toBe(401);
    expect(calls.some((c) => c.url.includes('oauth2'))).toBe(false);
  });

  it('asks to sign in again when Google rejects the refresh token', async () => {
    setup({ status: 400, body: { error: 'invalid_grant' } });
    const res = await POST(request({ refreshToken: '1//old' }));
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/neu mit Google anmelden/);
  });

  it('reports a missing server configuration', async () => {
    setup({ body: {} });
    delete process.env.GOOGLE_CLIENT_SECRET;
    const res = await POST(request({ refreshToken: '1//r' }));
    expect(res.status).toBe(500);
  });
});
