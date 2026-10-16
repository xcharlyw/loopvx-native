import { createFile, download, driveLinked, folder, listFiles, updateFile, type DriveFile } from './drive';

// Song texts as plain .txt files in Google Drive (LOOPVX/Songtexte): "Text aus Vocals" saves its text there and
// "Lyrics laden" lists the same folder, so a transcript can be picked again on any device.

export const SONGTEXT_ROLE = 'songtexts';
export const SONGTEXT_FOLDER = 'Songtexte';

/** A safe Drive file name for a title: forbidden characters out, always ends in ".txt". */
export function songFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${base || 'Songtext'}.txt`;
}

/** Text files first-name sorted, newest first; only plain text counts. */
export function songTextFiles(files: DriveFile[]): DriveFile[] {
  return files
    .filter((f) => /\.(txt|lrc|md)$/i.test(f.name) || f.mimeType === 'text/plain')
    .sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? '') || a.name.localeCompare(b.name, 'de'));
}

async function songFolder(): Promise<string> {
  const root = await folder('root', 'LOOPVX');
  return folder(SONGTEXT_ROLE, SONGTEXT_FOLDER, root);
}

/** Writes `text` as "<title>.txt" into LOOPVX/Songtexte (a file of the same name is overwritten). Returns the file name. */
export async function saveSongTextToDrive(title: string, text: string): Promise<string> {
  if (!(await driveLinked())) throw new Error('Google Drive ist nicht verbunden: melde dich mit Google an.');
  const dir = await songFolder();
  const name = songFileName(title);
  const data = new TextEncoder().encode(text.trim() + '\n');
  const existing = (await listFiles(`'${dir}' in parents`)).find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (existing) await updateFile(existing.id, { name }, data, 'text/plain');
  else await createFile({ name, parents: [dir] }, data, 'text/plain');
  return name;
}

/** The text files in LOOPVX/Songtexte. */
export async function listSongTextFiles(): Promise<DriveFile[]> {
  if (!(await driveLinked())) return [];
  return songTextFiles(await listFiles(`'${await songFolder()}' in parents`));
}

export async function readSongTextFile(id: string): Promise<string> {
  return new TextDecoder().decode(await download(id));
}
