import { POST, SYSTEM, buildUserText, extractJson } from '../api/arrange';

describe('arrange prompt', () => {
  it('puts project, tracks, library and the request into the text', () => {
    const t = buildUserText({ prompt: 'dark, long break', bpm: 160, key: 'F minor', tracks: [{ name: 'Rumble', role: 'bass' }], library: { kick: 3 } });
    expect(t).toContain('160 BPM');
    expect(t).toContain('F minor');
    expect(t).toContain('Rumble (bass)');
    expect(t).toContain('kick: 3');
    expect(t).toContain('dark, long break');
  });

  it('shows the sample names and asks for German texts', () => {
    const t = buildUserText({ prompt: 'impact bei 65', samples: [{ name: 'Dark Impact 03' }, { name: 'Bad\nName "x"' }, {}] });
    expect(t).toContain('Dark Impact 03; Bad Name  x');
    expect(t).toContain('German');
    expect(SYSTEM).toContain('"fx"');
    expect(SYSTEM).toContain('"notes"');
    expect(SYSTEM).toContain('fx_only');
    expect(SYSTEM).toMatch(/never in English/);
  });

  it('finds the JSON in fenced or chatty answers', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here: {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
    expect(extractJson('no json')).toBeNull();
    expect(extractJson('{broken')).toBeNull();
  });
});

describe('POST /api/arrange', () => {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...realEnv };
  });
  const request = (body: unknown) =>
    new Request('http://x/api/arrange', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' }, body: JSON.stringify(body) });

  function setup(answer: string, allowed = '') {
    process.env.GEMINI_API_KEY = 'g-key';
    process.env.SUPABASE_URL = 'https://sb.example';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.ALLOWED_EMAILS = allowed;
    delete process.env.GEMINI_MODEL;
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ email: 'karl@example.com' }));
      if (url.includes(':generateContent')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }] }));
      return new Response('nf', { status: 404 });
    }) as unknown as typeof fetch;
    return calls;
  }

  it('needs the key on the server', async () => {
    setup('{}');
    delete process.env.GEMINI_API_KEY;
    expect((await POST(request({ prompt: 'x' }))).status).toBe(500);
  });

  it('rejects users that are not on the allow list', async () => {
    setup('{}', 'other@example.com');
    expect((await POST(request({ prompt: 'x' }))).status).toBe(401);
  });

  it('asks Gemini with the key in a header and returns the plan', async () => {
    const calls = setup('{"sections":[{"type":"drop","bars":32}]}');
    const res = await POST(request({ prompt: 'banger', bpm: 155 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: { sections: [{ type: 'drop', bars: 32 }] }, model: 'gemini-3.6-flash' });
    const g = calls.find((c) => c.url.includes(':generateContent'))!;
    expect(g.url).toContain('/models/gemini-3.6-flash:generateContent');
    expect(g.url).not.toContain('g-key');
    expect((g.init!.headers as Record<string, string>)['x-goog-api-key']).toBe('g-key');
    expect(JSON.parse(g.init!.body as string).contents[0].parts[0].text).toContain('banger');
  });

  it('reports an answer without JSON', async () => {
    setup('sorry');
    expect((await POST(request({ prompt: 'x' }))).status).toBe(502);
  });

  it('retries on a busy model and falls back to the lighter one', async () => {
    const calls = setup('{"sections":[{"type":"drop","bars":32}]}');
    process.env.GEMINI_RETRY_MS = '0';
    const inner = globalThis.fetch;
    let n = 0;
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.includes(':generateContent') && n++ < 1) return new Response('{"error":{"code":503}}', { status: 503 });
      return inner(url, init);
    }) as unknown as typeof fetch;
    const res = await POST(request({ prompt: 'x' }));
    expect(res.status).toBe(200);
    expect((await res.json()).model).toBe('gemini-3.5-flash-lite');
    expect(calls.length).toBeGreaterThan(0);
  });

  it('says so in German when every model is busy', async () => {
    setup('x');
    process.env.GEMINI_RETRY_MS = '0';
    const inner = globalThis.fetch;
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => (url.includes(':generateContent') ? new Response('busy', { status: 503 }) : inner(url, init))) as unknown as typeof fetch;
    const res = await POST(request({ prompt: 'x' }));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('überlastet (503)');
  });
});
