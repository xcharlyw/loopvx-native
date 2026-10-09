import { DRIVE_TOKEN_ENDPOINT } from '../config';
import { getGoogleRefreshToken, getSession } from './supabase';

// Google Drive REST v3, limited to files this app created (drive.file scope).

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveFile {
  id: string;
  name: string;
  appProperties?: Record<string, string>;
}

export interface DriveMeta {
  name?: string;
  mimeType?: string;
  parents?: string[];
  /** Private key/value pairs only this app sees; each key + value must stay under 124 bytes. */
  appProperties?: Record<string, string>;
  trashed?: boolean;
}

/** Drive access is missing or was revoked: the fix is signing in with Google again. */
export class DriveAuthError extends Error {}

let cached: { token: string; expires: number } | null = null;

export async function driveLinked(): Promise<boolean> {
  return Boolean((await getGoogleRefreshToken()) && (await getSession()));
}

export function forgetDriveToken() {
  cached = null;
}

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const [refreshToken, session] = await Promise.all([getGoogleRefreshToken(), getSession()]);
  if (!refreshToken || !session) throw new DriveAuthError('Google Drive ist nicht verbunden');
  const res = await fetch(DRIVE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ refreshToken }),
  });
  if (res.status === 401) throw new DriveAuthError((await res.text()) || 'Bitte neu mit Google anmelden');
  if (!res.ok) throw new Error((await res.text()) || `Drive-Anmeldung fehlgeschlagen (${res.status})`);
  const json = (await res.json()) as { accessToken: string; expiresIn: number };
  cached = { token: json.accessToken, expires: Date.now() + json.expiresIn * 1000 };
  return cached.token;
}

async function call(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = await accessToken();
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
  if (res.status === 401 && !retried) {
    cached = null;
    return call(url, init, true);
  }
  if (res.ok) return res;
  const body = await res.text().catch(() => '');
  if (res.status === 401) throw new DriveAuthError('Google-Drive-Zugriff abgelaufen, bitte neu mit Google anmelden');
  if (/accessNotConfigured|has not been used|is disabled/i.test(body)) {
    throw new Error('Die Google-Drive-API ist im Google-Cloud-Projekt noch nicht aktiviert.');
  }
  throw new Error(`Google Drive ${res.status}: ${body.slice(0, 200)}`);
}

const escapeQ = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Files matching a Drive query (all pages), with their app properties. */
export async function listFiles(q: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ q: `${q} and trashed = false`, fields: 'nextPageToken, files(id, name, appProperties)', pageSize: '1000', spaces: 'drive' });
    if (pageToken) params.set('pageToken', pageToken);
    const json = (await (await call(`${API}/files?${params}`)).json()) as { files: DriveFile[]; nextPageToken?: string };
    out.push(...json.files);
    pageToken = json.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

export function childrenOf(folderId: string): Promise<DriveFile[]> {
  return listFiles(`'${escapeQ(folderId)}' in parents`);
}

/** The app's folder for `role`, created on first use. Found by app property, so renaming it in Drive is fine. */
export async function folder(role: string, name: string, parent?: string): Promise<string> {
  const found = await listFiles(`mimeType = '${FOLDER_MIME}' and appProperties has { key='loopvx' and value='${escapeQ(role)}' }`);
  if (found[0]) return found[0].id;
  const created = await createFile({ name, mimeType: FOLDER_MIME, parents: parent ? [parent] : undefined, appProperties: { loopvx: role } });
  return created.id;
}

/** One request with metadata and content, so Drive never holds a file without its data. */
export function multipartBody(meta: DriveMeta, data: Uint8Array, mimeType: string, boundary = `loopvx${Math.random().toString(36).slice(2)}`) {
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + data.length + tail.length);
  body.set(head, 0);
  body.set(data, head.length);
  body.set(tail, head.length + data.length);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

export async function createFile(meta: DriveMeta, data?: Uint8Array, mimeType = 'application/octet-stream'): Promise<DriveFile> {
  if (!data) {
    const res = await call(`${API}/files?fields=id,name,appProperties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    });
    return (await res.json()) as DriveFile;
  }
  const { body, contentType } = multipartBody(meta, data, mimeType);
  const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id,name,appProperties`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: body as unknown as BodyInit,
  });
  return (await res.json()) as DriveFile;
}

/** Change metadata, and the content too when `data` is given. */
export async function updateFile(fileId: string, meta: DriveMeta, data?: Uint8Array, mimeType = 'application/octet-stream'): Promise<void> {
  const id = encodeURIComponent(fileId);
  if (!data) {
    await call(`${API}/files/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) });
    return;
  }
  const { body, contentType } = multipartBody(meta, data, mimeType);
  await call(`${UPLOAD}/files/${id}?uploadType=multipart`, { method: 'PATCH', headers: { 'Content-Type': contentType }, body: body as unknown as BodyInit });
}

export async function download(fileId: string): Promise<ArrayBuffer> {
  return (await call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)).arrayBuffer();
}

/** Move to the Drive trash (recoverable for 30 days), never a hard delete. */
export async function trash(fileId: string): Promise<void> {
  await updateFile(fileId, { trashed: true });
}
