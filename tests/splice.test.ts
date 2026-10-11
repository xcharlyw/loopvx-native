import { POST } from '../api/splice';
import { allowedDownloadHost, callTool, discover, exchangeCode, extractDownloadUrl, parseRpc, refreshTokens, resetDiscovery, startLogin } from '../api/_lib/splice';

const AUTH = { authorization_endpoint: 'https://splice.example/oauth/authorize', token_endpoint: 'https://splice.example/oauth/token', registration_endpoint: 'https://splice.example/oauth/register' };

interface Mock {
  calls: { url: string; init?: RequestInit; body?: any }[];
  fetch: typeof fetch;
}

/** A fake Splice: OAuth metadata, registration, token endpoint and an MCP endpoint (answers as JSON or as an event stream). */
function splice(opts: { sse?: boolean; mcpStatus?: number; tools?: Record<string, string>; registration?: boolean } = {}): Mock {
  const calls: Mock['calls'] = [];
  const f = jest.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' && init.headers && /json/.test(String((init.headers as any)['Content-Type'])) ? JSON.parse(init.body) : init?.body;
    calls.push({ url, init, body });
    if (url.endsWith('/.well-known/oauth-protected-resource')) return Response.json({ authorization_servers: ['https://splice.example'] });
    if (url === 'https://splice.example/.well-known/oauth-authorization-server') {
      return Response.json(opts.registration === false ? { ...AUTH, registration_endpoint: undefined } : AUTH);
    }
    if (url === AUTH.registration_endpoint) return Response.json({ client_id: 'client-1' }, { status: 201 });
    if (url === AUTH.token_endpoint) return Response.json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 7200 });
    if (url === 'https://mcp.splice.com/mcp') {
      if (opts.mcpStatus) return new Response('nope', { status: opts.mcpStatus });
      const msg = body as { id?: number; method: string; params?: any };
      if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result =
        msg.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'splice' } }
          : { content: [{ type: 'text', text: opts.tools?.[msg.params.name] ?? 'ok' }] };
      const payload = { jsonrpc: '2.0', id: msg.id, result };
      const headers: Record<string, string> = { 'Mcp-Session-Id': 'sess-9' };
      if (opts.sse) return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, { headers: { ...headers, 'Content-Type': 'text/event-stream' } });
      return new Response(JSON.stringify(payload), { headers: { ...headers, 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });
  return { calls, fetch: f as unknown as typeof fetch };
}

beforeEach(() => resetDiscovery());

describe('OAuth against Splice', () => {
  it('finds the authorization server through the protected resource metadata', async () => {
    const m = splice();
    expect((await discover(m.fetch)).token_endpoint).toBe(AUTH.token_endpoint);
    expect(m.calls[0].url).toBe('https://mcp.splice.com/.well-known/oauth-protected-resource');
  });

  it('registers a public client and builds an authorization link with PKCE, state and the resource', async () => {
    const m = splice();
    const { authUrl, clientId } = await startLogin({ redirectUri: 'https://app.example/splice-callback', codeChallenge: 'CH', state: 'ST' }, m.fetch);
    expect(clientId).toBe('client-1');
    const reg = m.calls.find((c) => c.url === AUTH.registration_endpoint)!.body;
    expect(reg).toMatchObject({ client_name: 'LOOPVX', redirect_uris: ['https://app.example/splice-callback'], token_endpoint_auth_method: 'none' });
    const u = new URL(authUrl);
    expect(u.origin + u.pathname).toBe(AUTH.authorization_endpoint);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'https://app.example/splice-callback',
      code_challenge: 'CH',
      code_challenge_method: 'S256',
      state: 'ST',
      resource: 'https://mcp.splice.com/mcp',
    });
  });

  it('says so when Splice does not allow registering apps', async () => {
    await expect(startLogin({ redirectUri: 'https://a/b', codeChallenge: 'c', state: 's' }, splice({ registration: false }).fetch)).rejects.toThrow(/Registrierung/);
  });

  it('trades the code (with the PKCE verifier) and refreshes tokens', async () => {
    const m = splice();
    expect(await exchangeCode({ code: 'C', codeVerifier: 'V', redirectUri: 'https://a/b', clientId: 'client-1' }, m.fetch)).toEqual({ accessToken: 'at-1', refreshToken: 'rt-1', expiresIn: 7200 });
    const form = new URLSearchParams(m.calls.find((c) => c.url === AUTH.token_endpoint)!.init!.body as string);
    expect(Object.fromEntries(form)).toMatchObject({ grant_type: 'authorization_code', code: 'C', code_verifier: 'V', client_id: 'client-1', redirect_uri: 'https://a/b' });
    await refreshTokens({ refreshToken: 'rt-1', clientId: 'client-1' }, m.fetch);
    const refresh = new URLSearchParams(m.calls.filter((c) => c.url === AUTH.token_endpoint)[1].init!.body as string);
    expect(refresh.get('grant_type')).toBe('refresh_token');
  });
});

describe('MCP calls', () => {
  it('runs initialize, initialized and tools/call with the bearer token and the session id', async () => {
    const m = splice({ tools: { describe_a_sound: '## Search results' } });
    expect(await callTool('tok', 'describe_a_sound', { query: 'rumble' }, m.fetch)).toBe('## Search results');
    const mcp = m.calls.filter((c) => c.url === 'https://mcp.splice.com/mcp');
    expect(mcp.map((c) => c.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
    expect(mcp.every((c) => (c.init!.headers as any).Authorization === 'Bearer tok')).toBe(true);
    expect((mcp[2].init!.headers as any)['Mcp-Session-Id']).toBe('sess-9');
    expect(mcp[2].body.params).toEqual({ name: 'describe_a_sound', arguments: { query: 'rumble' } });
  });

  it('reads event-stream answers too', async () => {
    const m = splice({ sse: true, tools: { download_asset: 'link' } });
    expect(await callTool('tok', 'download_asset', { asset_uuid: 'x' }, m.fetch)).toBe('link');
  });

  it('asks to connect again when Splice answers 401', async () => {
    await expect(callTool('old', 'describe_a_sound', { query: 'x' }, splice({ mcpStatus: 401 }).fetch)).rejects.toMatchObject({ status: 401 });
  });

  it('only calls the read/download tools', async () => {
    // @ts-expect-error not an allowed tool
    await expect(callTool('tok', 'create_stack', {}, splice().fetch)).rejects.toMatchObject({ status: 400 });
  });

  it('parses a stream with comments and several messages', () => {
    const body = ': ping\n\nevent: message\ndata: {"jsonrpc":"2.0","method":"notifications/message"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":1}}\n\n';
    expect(parseRpc('text/event-stream', body, 2).result).toEqual({ ok: 1 });
  });
});

describe('download links', () => {
  it('prefers the presigned file link over the catalog page', () => {
    const text = 'Download ready: kick.wav\nPage: https://splice.com/sounds/sample/abc/kick-wav\nURL: https://spliceproduction.s3.amazonaws.com/audio/kick.wav?X-Amz-Signature=abc&X-Amz-Expires=300';
    expect(extractDownloadUrl(text)).toContain('X-Amz-Signature=abc');
  });
  it('ignores links to other hosts', () => {
    expect(extractDownloadUrl('see https://evil.example/x.wav?Signature=1')).toBeNull();
  });
  it('only allows https links on Splice and its storage', () => {
    expect(allowedDownloadHost('https://cdn.splice.com/a.wav')).toBe(true);
    expect(allowedDownloadHost('https://bucket.s3.amazonaws.com/a.wav?x=1')).toBe(true);
    expect(allowedDownloadHost('http://splice.com/a.wav')).toBe(false);
    expect(allowedDownloadHost('https://splice.com.evil.example/a.wav')).toBe(false);
    expect(allowedDownloadHost('https://169.254.169.254/latest')).toBe(false);
    expect(allowedDownloadHost('nonsense')).toBe(false);
  });
});

describe('POST /api/splice', () => {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };
  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...realEnv };
  });
  const request = (body: unknown) => new Request('http://x/api/splice', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' }, body: JSON.stringify(body) });

  /** Splice mock plus a Supabase that knows the caller. */
  function setup(allowed = 'karl@example.com', tools: Record<string, string> = {}) {
    process.env.SUPABASE_URL = 'https://sb.example';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.ALLOWED_EMAILS = allowed;
    const m = splice({ tools });
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://sb.example/auth/v1/user') return new Response(JSON.stringify({ email: 'karl@example.com' }));
      if (url.startsWith('https://files.splice.com/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/wav' } });
      return m.fetch(url, init);
    }) as unknown as typeof fetch;
    return m;
  }

  it('rejects callers that are not on the allow list without talking to Splice', async () => {
    const m = setup('someone@else.com');
    const res = await POST(request({ action: 'search', accessToken: 't', query: 'x' }));
    expect(res.status).toBe(401);
    expect(m.calls).toHaveLength(0);
  });

  it('searches with the filters', async () => {
    const m = setup('karl@example.com', { describe_a_sound: 'results' });
    const res = await POST(request({ action: 'search', accessToken: 't', query: ' rumble ', type: 'loop', bpmMin: 150, bpmMax: 160 }));
    expect(await res.json()).toEqual({ text: 'results' });
    const call = m.calls.find((c) => c.body?.method === 'tools/call')!;
    expect(call.body.params.arguments).toEqual({ query: 'rumble', type: 'loop', bpm_min: 150, bpm_max: 160 });
  });

  it('returns the presigned link for a download', async () => {
    setup('karl@example.com', { download_asset: 'File: a.wav\nhttps://files.splice.com/a.wav?X-Amz-Signature=1' });
    const res = await POST(request({ action: 'download', accessToken: 't', assetUuid: '09d1a590-fdc9-4d0e-9dc6-64bc8d7c3177' }));
    expect((await res.json()).url).toBe('https://files.splice.com/a.wav?X-Amz-Signature=1');
  });

  it('rejects a malformed asset id and unknown actions', async () => {
    setup();
    expect((await POST(request({ action: 'download', accessToken: 't', assetUuid: '../etc' }))).status).toBe(400);
    expect((await POST(request({ action: 'delete_everything' }))).status).toBe(400);
  });

  it('fetches files only from allowed hosts', async () => {
    setup();
    const ok = await POST(request({ action: 'fetch', url: 'https://files.splice.com/a.wav?s=1' }));
    expect([...new Uint8Array(await ok.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await POST(request({ action: 'fetch', url: 'https://evil.example/a.wav' }))).status).toBe(400);
  });

  it('passes on a 401 so the app can ask to connect again', async () => {
    process.env.SUPABASE_URL = 'https://sb.example';
    process.env.SUPABASE_ANON_KEY = 'anon';
    const m = splice({ mcpStatus: 401 });
    globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => (url === 'https://sb.example/auth/v1/user' ? new Response(JSON.stringify({ email: 'karl@example.com' })) : m.fetch(url, init))) as unknown as typeof fetch;
    expect((await POST(request({ action: 'search', accessToken: 'old', query: 'x' }))).status).toBe(401);
  });
});
