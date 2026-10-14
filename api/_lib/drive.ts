// Shared by the API functions: Google Drive with the caller's own short-lived access token (drive.file scope:
// only files the app created). Uploads are resumable, so files above Drive's 5 MB multipart limit work too.

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export async function driveDownload(token: string, fileId: string): Promise<{ data: Uint8Array; type: string }> {
  const res = await fetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google Drive ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { data: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') ?? 'application/octet-stream' };
}

export async function driveUpload(token: string, meta: { name: string; parents: string[]; appProperties?: Record<string, string> }, data: Uint8Array, mimeType: string): Promise<{ id: string; name: string }> {
  const start = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=id,name`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(data.length) },
    body: JSON.stringify(meta),
  });
  const session = start.headers.get('location');
  if (!start.ok || !session) throw new Error(`Google Drive ${start.status}: ${(await start.text()).slice(0, 200)}`);
  const put = await fetch(session, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: data as BodyInit });
  if (!put.ok) throw new Error(`Google Drive ${put.status}: ${(await put.text()).slice(0, 200)}`);
  return (await put.json()) as { id: string; name: string };
}
