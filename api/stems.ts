// Vercel Function: splits a whole tune into stems with ElevenLabs (POST /v1/music/stem-separation, six stems).
// A tune is far bigger than a function request or answer may be (4.5 MB), so the bytes travel through the caller's Google
// Drive: the app uploads the tune into LOOPVX/Stems Export/<tune>, this function reads it there with the caller's own Drive
// token, separates it and writes the stems next to it; the app then downloads them into the library.
import { unzipSync } from 'fflate';
import { authorize, text } from './_lib/auth';
import { driveDownload, driveUpload } from './_lib/drive';

const ELEVEN = 'https://api.elevenlabs.io/v1';

/** The German label of a stem file from ElevenLabs ("vocals.mp3" -> "Vocal"); the six-stem model has no separate FX stem. */
export function stemLabel(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName;
  if (/vocal|voice|vox/i.test(base)) return 'Vocal';
  if (/drum/i.test(base)) return 'Drums';
  if (/bass/i.test(base)) return 'Bass';
  if (/piano|key/i.test(base)) return 'Keys';
  if (/guitar/i.test(base)) return 'Gitarre';
  return 'Synth + FX';
}

const ID = /^[\w-]{10,200}$/;
const mimeOf = (name: string) => (/\.wav$/i.test(name) ? 'audio/wav' : /\.flac$/i.test(name) ? 'audio/flac' : 'audio/mpeg');

interface Body {
  fileId?: string;
  folderId?: string;
  name?: string;
  accessToken?: string;
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return text(500, 'ELEVENLABS_API_KEY fehlt auf dem Server');
  const denied = await authorize(req);
  if (denied) return text(401, denied);
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return text(400, 'Ungültige Anfrage');
  }
  const { fileId, folderId, accessToken } = body;
  if (!fileId || !folderId || !ID.test(fileId) || !ID.test(folderId) || !accessToken) return text(400, 'Ungültige Anfrage');
  const name = (body.name ?? 'Tune').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Tune';

  let tune: { data: Uint8Array; type: string };
  try {
    tune = await driveDownload(accessToken, fileId);
  } catch (e) {
    return text(502, `Tune nicht aus Google Drive lesbar: ${(e as Error).message}`);
  }

  const form = new FormData();
  form.append('file', new Blob([tune.data as BlobPart], { type: tune.type }), 'tune');
  form.append('stem_variation_id', process.env.ELEVENLABS_STEM_VARIATION || 'six_stems_v1');
  const res = await fetch(`${ELEVEN}/music/stem-separation`, { method: 'POST', headers: { 'xi-api-key': apiKey }, body: form });
  if (!res.ok) return text(res.status, `ElevenLabs Stem-Trennung: ${(await res.text()).slice(0, 300)}`);

  let files: [string, Uint8Array][];
  try {
    files = Object.entries(unzipSync(new Uint8Array(await res.arrayBuffer()))).filter(([n, d]) => d.length > 0 && !n.endsWith('/') && !/__MACOSX|\.DS_Store/.test(n));
  } catch {
    return text(502, 'ElevenLabs lieferte kein lesbares ZIP');
  }
  if (!files.length) return text(502, 'Stem-Trennung lieferte keine Dateien');

  try {
    const stems = await Promise.all(
      files.map(async ([file, data]) => {
        const label = stemLabel(file);
        const ext = (/\.([a-z0-9]{2,4})$/i.exec(file)?.[1] ?? 'mp3').toLowerCase();
        const up = await driveUpload(accessToken, { name: `${name} - ${label}.${ext}`, parents: [folderId], appProperties: { loopvx: 'stem' } }, data, mimeOf(file));
        return { id: up.id, name: up.name, stem: label, size: data.length };
      }),
    );
    return Response.json({ stems }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return text(502, `Stems konnten nicht in Google Drive gespeichert werden: ${(e as Error).message}`);
  }
}
