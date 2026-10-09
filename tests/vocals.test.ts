import { zipSync } from 'fflate';
import { POST, buildPrompt, lengthMs } from '../api/vocals';

describe('vocal request building', () => {
  it('puts tempo, key and lyrics into the prompt', () => {
    const p = buildPrompt({ prompt: 'dark female vocal', bpm: 155, key: 'E minor', lyrics: 'hold me tonight', vocalsOnly: true });
    expect(p).toContain('dark female vocal');
    expect(p).toContain('155 BPM');
    expect(p).toContain('E minor');
    expect(p).toContain('"hold me tonight"');
    expect(p).toContain('upfront lead vocal');
  });

  it('converts bars to milliseconds within API limits', () => {
    expect(lengthMs(8, 160)).toBe(12_000);
    expect(lengthMs(1, 160)).toBe(3_000);
    expect(lengthMs(10_000, 60)).toBe(600_000);
  });
});


describe('POST /api/vocals', () => {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...realEnv };
  });

  const request = (body: unknown, token = 'tok') =>
    new Request('http://x/api/vocals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  function setup(allowed = '') {
    process.env.ELEVENLABS_API_KEY = 'el-key';
    process.env.SUPABASE_URL = 'https://sb.example';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.ALLOWED_EMAILS = allowed;
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ email: 'karl@example.com' }));
      if (url.endsWith('/v1/music')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg', 'song-id': 's1' } });
      if (url.endsWith('/v1/music/stem-separation')) {
        const zip = zipSync({ 'instrumental.mp3': new Uint8Array([9]), 'vocals.mp3': new Uint8Array([7, 7]) });
        return new Response(zip, { headers: { 'content-type': 'application/zip' } });
      }
      return new Response('not found', { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return calls;
  }

  it('rejects users that are not on the allow list', async () => {
    setup('someone@else.com');
    const res = await POST(request({ prompt: 'x' }));
    expect(res.status).toBe(401);
  });

  it('generates a song and returns only the vocal stem', async () => {
    const calls = setup('karl@example.com');
    const res = await POST(request({ prompt: 'dark vocal', lyrics: 'hold me', bpm: 160, key: 'E minor', bars: 8, vocalsOnly: true }));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([7, 7]));
    const music = calls.find((c) => c.url.endsWith('/v1/music'))!;
    expect((music.init!.headers as Record<string, string>)['xi-api-key']).toBe('el-key');
    const body = JSON.parse(music.init!.body as string);
    expect(body.music_length_ms).toBe(12_000);
    expect(body.model_id).toBe('music_v2_5');
    expect(body.prompt).toContain('"hold me"');
  });

  it('returns the full song when vocalsOnly is off', async () => {
    const calls = setup();
    const res = await POST(request({ prompt: 'x', vocalsOnly: false }));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls.some((c) => c.url.includes('stem-separation'))).toBe(false);
  });
});
