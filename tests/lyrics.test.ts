import { POST, SYSTEM, buildUserText, parseIdeas } from '../api/lyrics';

describe('lyrics prompt', () => {
  it('asks for the language, the theme, the count and what to avoid', () => {
    const t = buildUserText({ theme: 'Hitze, Nacht', language: 'de', count: 3, lines: 4, gender: 'female', style: 'rap', bpm: 140.4, avoid: ['DARK DESIRE', 'NO SLEEP'] });
    expect(t).toContain('3 new hook ideas');
    expect(t).toContain('exactly 4 lines');
    expect(t).toContain('in German');
    expect(t).toContain('Hitze, Nacht');
    expect(t).toContain('rhythmic rap');
    expect(t).toContain('140 BPM');
    expect(t).toContain('DARK DESIRE, NO SLEEP');
    expect(SYSTEM).toContain('stylePrompt');
    expect(SYSTEM).toContain('DARK DESIRE');
  });

  it('works without any input', () => {
    expect(buildUserText({})).toContain('surprise');
    expect(buildUserText({ count: 99 })).toContain('8 new hook ideas');
  });
});

describe('parseIdeas', () => {
  const good = { title: ' NO SLEEP ', genre: 'Peak-Time', lines: ['a', ' b ', '', 'c', 'd', 'e'], stylePrompt: '138 BPM, techno' };

  it('keeps well-formed ideas and trims them to the line count', () => {
    const out = parseIdeas({ ideas: [good, { title: 'x' }, { ...good, lines: ['only one'] }, { ...good, stylePrompt: '' }] }, 4);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'NO SLEEP', lines: ['a', 'b', 'c', 'd'] });
  });

  it('returns nothing for garbage', () => {
    expect(parseIdeas(null)).toEqual([]);
    expect(parseIdeas({ ideas: 'x' })).toEqual([]);
  });
});

describe('POST /api/lyrics', () => {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...realEnv };
  });
  const request = (body: unknown) => new Request('http://x/api/lyrics', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' }, body: JSON.stringify(body) });

  function setup(answer: string) {
    process.env.GEMINI_API_KEY = 'g-key';
    process.env.SUPABASE_URL = 'https://sb.example';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.ALLOWED_EMAILS = '';
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ email: 'karl@example.com' }));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }] }));
    }) as unknown as typeof fetch;
    return calls;
  }

  it('returns checked ideas', async () => {
    const calls = setup(JSON.stringify({ ideas: [{ title: 'ZARA', genre: 'Rave', lines: ['one', 'two', 'three', 'four'], stylePrompt: '140 BPM' }] }));
    const res = await POST(request({ theme: 'x', language: 'en' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ideas: unknown[] };
    expect(body.ideas).toHaveLength(1);
    const gemini = calls.find((c) => c.url.includes('generateContent'))!;
    expect((gemini.init!.headers as Record<string, string>)['x-goog-api-key']).toBe('g-key');
  });

  it('reports a useless answer', async () => {
    setup('not json');
    expect((await POST(request({}))).status).toBe(502);
  });

  it('needs the Gemini key', async () => {
    setup('{}');
    delete process.env.GEMINI_API_KEY;
    expect((await POST(request({}))).status).toBe(500);
  });
});
