import { POST, parseTranscript } from '../api/transcribe';

describe('parseTranscript', () => {
  it('keeps clean text lines', () => {
    expect(parseTranscript({ language: 'de', lines: [' Kein  Entkommen ', '', 'keine Wahl', 5] })).toEqual({ language: 'de', lines: ['Kein Entkommen', 'keine Wahl'] });
  });
  it('rejects answers without lines', () => {
    expect(parseTranscript(null)).toBeNull();
    expect(parseTranscript({ lines: 'x' })).toBeNull();
  });
});

describe('POST /api/transcribe', () => {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...realEnv };
  });

  function setup(answer: string) {
    process.env.GEMINI_API_KEY = 'g';
    process.env.SUPABASE_URL = 'https://sb.example';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.ALLOWED_EMAILS = '';
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ email: 'k@x.com' }));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }] }));
    }) as unknown as typeof fetch;
    return calls;
  }
  const upload = (size = 100) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(size)], { type: 'audio/wav' }), 'a.wav');
    return new Request('http://x/api/transcribe', { method: 'POST', headers: { Authorization: 'Bearer tok' }, body: form });
  };

  it('sends the audio to Gemini and returns the lines', async () => {
    const calls = setup(JSON.stringify({ language: 'en', lines: ['one', 'two'] }));
    const res = await POST(upload());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ language: 'en', lines: ['one', 'two'] });
    const body = JSON.parse(calls.find((c) => c.url.includes('generateContent'))!.init!.body as string);
    expect(body.contents[0].parts[0].inlineData.mimeType).toBe('audio/wav');
    expect(typeof body.contents[0].parts[0].inlineData.data).toBe('string');
  });

  it('says so when no voice was found, and refuses huge or empty uploads', async () => {
    setup(JSON.stringify({ language: 'other', lines: [] }));
    expect((await POST(upload())).status).toBe(422);
    expect((await POST(upload(4_500_000))).status).toBe(413);
  });
});
