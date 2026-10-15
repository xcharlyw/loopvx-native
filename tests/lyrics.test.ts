import { POST, SYSTEM, buildUserText, parseIdeas, systemFor } from '../api/lyrics';

describe('lyrics prompt', () => {
  it('asks for the language, the theme, the count and what to avoid', () => {
    const t = buildUserText({ theme: 'Hitze, Nacht', language: 'de', count: 3, lines: 4, gender: 'female', style: 'rap', genre: 'hard-techno', avoid: ['DARK DESIRE', 'NO SLEEP'] });
    expect(t).toContain('3 new hook ideas');
    expect(t).toContain('exactly 4 lines');
    expect(t).toContain('in German');
    expect(t).toContain('Hitze, Nacht');
    expect(t).toContain('rhythmic rap');
    expect(t).toContain('Genre: hard techno');
    expect(t).not.toMatch(/BPM/);
    expect(t).toContain('DARK DESIRE, NO SLEEP');
    expect(SYSTEM).toContain('stylePrompt');
    expect(SYSTEM).toContain('DARK DESIRE');
  });

  it('allows 8 and 16 lines, not more', () => {
    expect(buildUserText({ lines: 16 })).toContain('exactly 16 lines');
    expect(buildUserText({ lines: 99 })).toContain('exactly 16 lines');
    expect(buildUserText({ lines: 8 })).toContain('exactly 8 lines');
  });

  it('adds song texts as style inspiration but forbids copying them', () => {
    const t = buildUserText({ inspiration: ['Kein Entkommen, keine Wahl', '  ', 'zwei'] });
    expect(t).toContain('STYLE INSPIRATION');
    expect(t).toContain('Kein Entkommen, keine Wahl');
    expect(t).toContain('Never copy lines');
    expect(t).toContain('inspiration 2');
    expect(buildUserText({})).not.toContain('INSPIRATION');
  });

  it('works without any input', () => {
    expect(buildUserText({})).toContain('surprise');
    expect(buildUserText({ count: 99 })).toContain('8 new hook ideas');
  });
});

describe('style prompt scope', () => {
  it('describes the whole track normally and only the voice when only the vocal is generated', () => {
    expect(systemFor(false)).toContain('bass and kick');
    expect(systemFor(true)).toContain('ONLY the voice');
    expect(systemFor(true)).not.toContain('bass and kick');
    expect(systemFor(true)).not.toContain('@@');
    expect(systemFor(false)).toContain('Never put a BPM');
    expect(SYSTEM).toBe(systemFor(false));
  });
});

describe('parseIdeas', () => {
  const good = { title: ' NO SLEEP ', genre: 'Peak-Time', lines: ['a', ' b ', '', 'c', 'd', 'e'], stylePrompt: '138 BPM, techno' };

  it('keeps well-formed ideas and trims them to the line count', () => {
    const out = parseIdeas({ ideas: [good, { title: 'x' }, { ...good, lines: ['only one'] }, { ...good, stylePrompt: '' }] }, 4);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'NO SLEEP', lines: ['a', 'b', 'c', 'd'] });
  });

  it('keeps up to 16 lines when asked for them', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    expect(parseIdeas({ ideas: [{ ...good, lines }] }, 16)[0].lines).toHaveLength(16);
    expect(parseIdeas({ ideas: [{ ...good, lines }] }, 8)[0].lines).toHaveLength(8);
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
