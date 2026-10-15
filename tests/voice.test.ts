import { POST } from '../api/voice';

describe('POST /api/voice', () => {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...realEnv };
  });

  function setup() {
    process.env.ELEVENLABS_API_KEY = 'el-key';
    process.env.SUPABASE_URL = 'https://sb.example';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.ALLOWED_EMAILS = '';
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ email: 'karl@example.com' }));
      if (url.endsWith('/v1/voices/add')) return new Response(JSON.stringify({ voice_id: 'voice_new123' }));
      if (url.includes('/v1/voices/')) return new Response('{}');
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;
    return calls;
  }

  const upload = (fields: Record<string, string>, size = 10) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', new Blob([new Uint8Array(size)], { type: 'audio/wav' }), 'a.wav');
    return new Request('http://x/api/voice', { method: 'POST', headers: { Authorization: 'Bearer tok' }, body: form });
  };

  it('clones a voice from a recording', async () => {
    const calls = setup();
    const res = await POST(upload({ name: 'Meine Stimme', consent: '1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voiceId: 'voice_new123', name: 'Meine Stimme' });
    const add = calls.find((c) => c.url.endsWith('/v1/voices/add'))!;
    expect((add.init!.headers as Record<string, string>)['xi-api-key']).toBe('el-key');
    expect((add.init!.body as FormData).get('name')).toBe('Meine Stimme');
  });

  it('refuses without the consent confirmation', async () => {
    const calls = setup();
    const res = await POST(upload({ name: 'X' }));
    expect(res.status).toBe(400);
    expect(calls.some((c) => c.url.includes('voices/add'))).toBe(false);
  });

  it('refuses too large recordings and missing names', async () => {
    setup();
    expect((await POST(upload({ name: 'X', consent: '1' }, 4_500_000))).status).toBe(413);
    expect((await POST(upload({ name: ' ', consent: '1' }))).status).toBe(400);
  });

  it('deletes a voice', async () => {
    const calls = setup();
    const res = await POST(new Request('http://x/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' }, body: JSON.stringify({ action: 'delete', voiceId: 'voice_new123' }) }));
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.url.endsWith('/v1/voices/voice_new123'))!.init!.method).toBe('DELETE');
  });
});
