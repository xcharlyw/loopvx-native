// Talks to Splice's remote MCP server (https://mcp.splice.com/mcp, Streamable HTTP, OAuth 2.1 with PKCE) on behalf
// of the signed-in LOOPVX user. The browser cannot do this itself (the endpoints do not allow its origin), so the
// Vercel function in api/splice.ts uses these helpers. Nothing here is secret: the OAuth client is a public client
// registered on the fly, and the user's Splice tokens live on their own device, never on the server.

export const SPLICE_MCP_URL = 'https://mcp.splice.com/mcp';
const PROTOCOL_VERSION = '2025-06-18';

/** Tools the app may call: nothing that creates or changes things in the user's Splice account. */
export const ALLOWED_TOOLS = ['describe_a_sound', 'download_asset'] as const;
export type SpliceTool = (typeof ALLOWED_TOOLS)[number];

export class SpliceError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

const https = (u: string) => {
  const url = new URL(u);
  if (url.protocol !== 'https:') throw new SpliceError('Unsicherer Splice-Endpunkt abgelehnt');
  return url.toString();
};

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    // 401 from the MCP endpoint or the token endpoint: the user has to connect again.
    throw new SpliceError(`Splice ${what}: ${res.status} ${body}`.trim(), res.status === 401 ? 401 : 502);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- OAuth discovery and registration

export interface OAuthServer {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
}

let discovered: { at: number; server: OAuthServer } | null = null;

/** Where to log in: the MCP server names its authorization server, which names the endpoints (RFC 9728 and RFC 8414). */
export async function discover(fetchFn: typeof fetch = fetch): Promise<OAuthServer> {
  if (discovered && Date.now() - discovered.at < 10 * 60_000) return discovered.server;
  const origin = new URL(SPLICE_MCP_URL).origin;
  let issuer = origin;
  try {
    const resource = await fetchFn(`${origin}/.well-known/oauth-protected-resource`);
    if (resource.ok) {
      const meta = (await resource.json()) as { authorization_servers?: string[] };
      if (meta.authorization_servers?.[0]) issuer = meta.authorization_servers[0].replace(/\/$/, '');
    }
  } catch {
    // fall back to the MCP host itself acting as the authorization server
  }
  for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
    const res = await fetchFn(`${issuer}${path}`).catch(() => null);
    if (res?.ok) {
      const server = (await res.json()) as OAuthServer;
      if (server.authorization_endpoint && server.token_endpoint) {
        https(server.authorization_endpoint);
        https(server.token_endpoint);
        discovered = { at: Date.now(), server };
        return server;
      }
    }
  }
  throw new SpliceError('Splice-Anmeldung nicht gefunden (OAuth-Metadaten fehlen)');
}

/** Dynamic client registration (RFC 7591): a public client for this redirect address. */
export async function registerClient(redirectUri: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const server = await discover(fetchFn);
  if (!server.registration_endpoint) throw new SpliceError('Splice erlaubt keine automatische Registrierung neuer Apps');
  const res = await fetchFn(https(server.registration_endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'LOOPVX',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const reg = await json<{ client_id?: string }>(res, 'Registrierung');
  if (!reg.client_id) throw new SpliceError('Splice hat keine Client-ID geliefert');
  return reg.client_id;
}

export interface StartInput {
  redirectUri: string;
  codeChallenge: string;
  state: string;
}

/** Registers the app and builds the address the user opens to log in to Splice and allow access. */
export async function startLogin(input: StartInput, fetchFn: typeof fetch = fetch): Promise<{ authUrl: string; clientId: string }> {
  const server = await discover(fetchFn);
  const clientId = await registerClient(input.redirectUri, fetchFn);
  const url = new URL(https(server.authorization_endpoint));
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    state: input.state,
    resource: SPLICE_MCP_URL,
  }).toString();
  return { authUrl: url.toString(), clientId };
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

async function tokenRequest(params: Record<string, string>, fetchFn: typeof fetch): Promise<Tokens> {
  const server = await discover(fetchFn);
  const res = await fetchFn(https(server.token_endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ ...params, resource: SPLICE_MCP_URL }),
  });
  const t = await json<{ access_token?: string; refresh_token?: string; expires_in?: number; error?: string }>(res, 'Token');
  if (!t.access_token) throw new SpliceError(`Splice: ${t.error ?? 'kein Token'}`, 401);
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in ?? 3600 };
}

export const exchangeCode = (p: { code: string; codeVerifier: string; redirectUri: string; clientId: string }, fetchFn: typeof fetch = fetch) =>
  tokenRequest({ grant_type: 'authorization_code', code: p.code, code_verifier: p.codeVerifier, redirect_uri: p.redirectUri, client_id: p.clientId }, fetchFn);

export const refreshTokens = (p: { refreshToken: string; clientId: string }, fetchFn: typeof fetch = fetch) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: p.refreshToken, client_id: p.clientId }, fetchFn);

// ---------------------------------------------------------------- MCP over Streamable HTTP

/** The JSON-RPC message in a response that is either plain JSON or a server-sent-events stream. */
export function parseRpc(contentType: string, body: string, id: number): { result?: any; error?: { message?: string } } {
  if (contentType.includes('text/event-stream')) {
    for (const block of body.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        const msg = JSON.parse(data);
        if (msg.id === id) return msg;
      } catch {
        // not a JSON message (a ping, a comment)
      }
    }
    throw new SpliceError('Splice hat nicht geantwortet');
  }
  return JSON.parse(body);
}

/** Calls one tool and returns the text it answered with (initialize, notify, call: a short session per request). */
export async function callTool(accessToken: string, tool: SpliceTool, args: Record<string, unknown>, fetchFn: typeof fetch = fetch): Promise<string> {
  if (!ALLOWED_TOOLS.includes(tool)) throw new SpliceError('Dieses Splice-Werkzeug ist nicht freigegeben', 400);
  let sessionId: string | null = null;
  const post = async (payload: object) => {
    const res = await fetchFn(SPLICE_MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${accessToken}`,
        'MCP-Protocol-Version': PROTOCOL_VERSION,
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      },
      body: JSON.stringify(payload),
    });
    sessionId = res.headers.get('mcp-session-id') ?? sessionId;
    return res;
  };
  const rpc = async (id: number, method: string, params: object) => {
    const res = await post({ jsonrpc: '2.0', id, method, params });
    if (res.status === 401) throw new SpliceError('Splice-Zugriff abgelaufen, bitte neu verbinden', 401);
    if (!res.ok) throw new SpliceError(`Splice ${method}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`.trim());
    const msg = parseRpc(res.headers.get('content-type') ?? '', await res.text(), id);
    if (msg.error) throw new SpliceError(msg.error.message ?? 'Splice-Fehler');
    return msg.result;
  };

  await rpc(1, 'initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'loopvx', version: '1' } });
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).then((r) => r.text().catch(() => ''));
  const result = await rpc(2, 'tools/call', { name: tool, arguments: args });
  const text = ((result?.content ?? []) as { type: string; text?: string }[])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
  if (result?.isError) throw new SpliceError(text || 'Splice meldet einen Fehler');
  return text;
}

// ---------------------------------------------------------------- downloads

/** Hosts a presigned download link may point to: Splice and its storage/CDN. */
export function allowedDownloadHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)(splice\.com|amazonaws\.com|cloudfront\.net)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** The download link in the text `download_asset` answers with: a presigned file URL, not a page of splice.com. */
export function extractDownloadUrl(text: string): string | null {
  const urls = (text.match(/https:\/\/[^\s)"'<>\]]+/g) ?? []).filter(allowedDownloadHost);
  return urls.find((u) => /X-Amz-|Signature=|Expires=/i.test(u)) ?? urls.find((u) => !/splice\.com\/sounds\//i.test(u)) ?? null;
}

/** For tests: forget the cached OAuth metadata. */
export const resetDiscovery = () => {
  discovered = null;
};
