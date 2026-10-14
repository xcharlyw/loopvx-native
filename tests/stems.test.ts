import { zipSync } from 'fflate';
import { POST, stemLabel } from '../api/stems';

describe('stem labels', () => {
  it('names the six ElevenLabs stems in German', () => {
    expect(['vocals.mp3', 'drums.mp3', 'bass.mp3', 'piano.mp3', 'guitar.mp3', 'other.mp3'].map(stemLabel)).toEqual(['Vocal', 'Drums', 'Bass', 'Keys', 'Gitarre', 'Synth + FX']);
    expect(stemLabel('stems/song_Vocals.wav')).toBe('Vocal');
  });
});

describe('POST /api/stems', () => {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...realEnv };
  });
  const request = (body: unknown) => new Request('http://x/api/stems', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' }, body: JSON.stringify(body) });
  const ok = { fileId: 'tuneFileId123', folderId: 'folderId12345', name: 'My Tune 155 BPM', accessToken: 'drive-tok' };

  function setup() {
    process.env.ELEVENLABS_API_KEY = 'el-key';
    process.env.SUPABASE_URL = 'https://sb.example';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.ALLOWED_EMAILS = '';
    const calls: { url: string; init?: RequestInit }[] = [];
    let n = 0;
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ email: 'karl@example.com' }));
      if (url.includes('/drive/v3/files/tuneFileId123?alt=media')) return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'audio/wav' } });
      if (url.endsWith('/v1/music/stem-separation')) return new Response(zipSync({ 'drums.mp3': new Uint8Array([1]), 'vocals.mp3': new Uint8Array([2, 2]), 'other.mp3': new Uint8Array([3]) }));
      if (url.includes('uploadType=resumable')) return new Response('', { headers: { location: `https://upload.example/session/${++n}` } });
      if (url.startsWith('https://upload.example/session/')) return new Response(JSON.stringify({ id: `stem${url.split('/').pop()}`, name: JSON.parse(String(calls.filter((c) => c.url.includes('uploadType=resumable'))[Number(url.split('/').pop()) - 1].init!.body)).name }));
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    return calls;
  }

  it('reads the tune from Drive, separates it and writes each stem into the tune folder', async () => {
    const calls = setup();
    const res = await POST(request(ok));
    expect(res.status).toBe(200);
    const { stems } = (await res.json()) as { stems: { name: string; stem: string; id: string }[] };
    expect(stems.map((x) => x.stem).sort()).toEqual(['Drums', 'Synth + FX', 'Vocal']);
    expect(stems.find((x) => x.stem === 'Drums')!.name).toBe('My Tune 155 BPM - Drums.mp3');
    const dl = calls.find((c) => c.url.includes('alt=media'))!;
    expect((dl.init!.headers as Record<string, string>).Authorization).toBe('Bearer drive-tok');
    const sep = calls.find((c) => c.url.endsWith('/stem-separation'))!;
    expect((sep.init!.body as FormData).get('stem_variation_id')).toBe('six_stems_v1');
    const meta = JSON.parse(String(calls.find((c) => c.url.includes('uploadType=resumable'))!.init!.body));
    expect(meta.parents).toEqual(['folderId12345']);
  });

  it('refuses bad ids and missing tokens', async () => {
    setup();
    expect((await POST(request({ ...ok, fileId: '../x' }))).status).toBe(400);
    expect((await POST(request({ ...ok, accessToken: '' }))).status).toBe(400);
  });

  it('passes an ElevenLabs error on', async () => {
    setup();
    const base = globalThis.fetch;
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => (url.endsWith('/stem-separation') ? new Response('quota exceeded', { status: 402 }) : base(url, init))) as unknown as typeof fetch;
    const res = await POST(request(ok));
    expect(res.status).toBe(402);
    expect(await res.text()).toContain('quota exceeded');
  });
});
