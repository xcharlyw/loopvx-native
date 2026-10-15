/** A song text kept as lyric inspiration: transcribed from a vocal or written by hand. */
export interface SongText {
  id: string;
  title: string;
  text: string;
  language?: string;
  addedAt: number;
}

/** Saving under a title that exists replaces that text (keeps its place). */
export function upsertSongText(list: SongText[], item: SongText): SongText[] {
  const title = item.title.trim();
  const at = list.findIndex((t) => t.title.trim().toLowerCase() === title.toLowerCase());
  if (at < 0) return [...list, { ...item, title }];
  return list.map((t, i) => (i === at ? { ...item, id: t.id, title } : t));
}

export const removeSongText = (list: SongText[], id: string): SongText[] => list.filter((t) => t.id !== id);

/** The chosen texts as inspiration for the lyric AI: at most 3 texts of 1200 characters each. */
export function inspirationOf(list: SongText[], ids: string[]): string[] {
  return list
    .filter((t) => ids.includes(t.id))
    .slice(0, 3)
    .map((t) => t.text.trim().slice(0, 1200))
    .filter(Boolean);
}

/** A title from the first words of the text, for a transcript the user did not name. */
export function titleFromText(text: string): string {
  const first = text.split('\n').find((l) => l.trim()) ?? '';
  const words = first.trim().split(/\s+/).slice(0, 4).join(' ');
  return words ? words.slice(0, 40) : 'Songtext';
}

/**
 * A lyrics file (.txt, .lrc, .md …) as a song text: BOM and Windows line ends removed, LRC time stamps ("[01:23.45]") and
 * tags ("[ar:Artist]") dropped, more than one empty line in a row collapsed; the title is the file name without extension.
 */
export function lyricsFromFile(name: string, raw: string): { title: string; text: string } {
  const lines = raw
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => !/^\s*\[[a-z]+:[^\]]*\]\s*$/i.test(l))
    .map((l) => l.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '').replace(/^\s*#+\s*/, '').trimEnd());
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const title = name.replace(/\.[a-z0-9]{1,5}$/i, '').trim().slice(0, 40) || titleFromText(text);
  return { title, text };
}
