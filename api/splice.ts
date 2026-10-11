// Vercel Function: LOOPVX's connection to Splice (search the catalog, download sounds into the library).
// One POST endpoint with an `action`; see api/_lib/splice.ts for what happens behind each one. The caller must be
// signed in to LOOPVX (and on ALLOWED_EMAILS); the user's Splice tokens come with each request from their device.
import { authorize, text } from './_lib/auth';
import { SpliceError, allowedDownloadHost, callTool, exchangeCode, extractDownloadUrl, refreshTokens, startLogin } from './_lib/splice';

const str = (v: unknown, max = 2000) => (typeof v === 'string' && v.length <= max ? v : undefined);
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);

export async function POST(req: Request): Promise<Response> {
  const denied = await authorize(req);
  if (denied) return text(401, denied);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return text(400, 'Ungültige Anfrage');
  }

  try {
    switch (body.action) {
      case 'start': {
        const redirectUri = str(body.redirectUri);
        const codeChallenge = str(body.codeChallenge);
        const state = str(body.state);
        if (!redirectUri || !codeChallenge || !state) return text(400, 'Ungültige Anfrage');
        return Response.json(await startLogin({ redirectUri, codeChallenge, state }), { headers: { 'Cache-Control': 'no-store' } });
      }
      case 'token': {
        const code = str(body.code);
        const codeVerifier = str(body.codeVerifier);
        const redirectUri = str(body.redirectUri);
        const clientId = str(body.clientId);
        if (!code || !codeVerifier || !redirectUri || !clientId) return text(400, 'Ungültige Anfrage');
        return Response.json(await exchangeCode({ code, codeVerifier, redirectUri, clientId }), { headers: { 'Cache-Control': 'no-store' } });
      }
      case 'refresh': {
        const refreshToken = str(body.refreshToken);
        const clientId = str(body.clientId);
        if (!refreshToken || !clientId) return text(400, 'Ungültige Anfrage');
        return Response.json(await refreshTokens({ refreshToken, clientId }), { headers: { 'Cache-Control': 'no-store' } });
      }
      case 'search': {
        const accessToken = str(body.accessToken, 4000);
        const query = str(body.query, 300)?.trim();
        if (!accessToken || !query) return text(400, 'Ungültige Anfrage');
        const args: Record<string, unknown> = { query };
        if (body.type === 'loop' || body.type === 'oneshot') args.type = body.type;
        const min = int(body.bpmMin);
        const max = int(body.bpmMax);
        if (min !== undefined) args.bpm_min = min;
        if (max !== undefined) args.bpm_max = max;
        return Response.json({ text: await callTool(accessToken, 'describe_a_sound', args) });
      }
      case 'download': {
        // The first download of a sound costs the user one Splice credit: the app asks before it gets here.
        const accessToken = str(body.accessToken, 4000);
        const assetUuid = str(body.assetUuid, 64);
        if (!accessToken || !assetUuid || !/^[0-9a-f-]{36}$/i.test(assetUuid)) return text(400, 'Ungültige Anfrage');
        const answer = await callTool(accessToken, 'download_asset', { asset_uuid: assetUuid });
        const url = extractDownloadUrl(answer);
        if (!url) return text(502, `Splice hat keinen Download-Link geliefert: ${answer.slice(0, 200)}`);
        return Response.json({ url });
      }
      case 'fetch': {
        // The browser usually cannot read the storage host directly (no CORS): fetch the file here and pass it on.
        const url = str(body.url, 4000);
        if (!url || !allowedDownloadHost(url)) return text(400, 'Download-Adresse nicht erlaubt');
        const file = await fetch(url);
        if (!file.ok) return text(502, `Download fehlgeschlagen (${file.status})`);
        return new Response(file.body, { headers: { 'Content-Type': file.headers.get('content-type') ?? 'application/octet-stream', 'Cache-Control': 'no-store' } });
      }
      default:
        return text(400, 'Unbekannte Aktion');
    }
  } catch (e) {
    if (e instanceof SpliceError) return text(e.status, e.message);
    return text(502, e instanceof Error ? e.message : 'Splice-Fehler');
  }
}
