import { inspirationOf, lyricsFromFile, removeSongText, titleFromText, upsertSongText, type SongText } from './songTexts';

const t = (id: string, title: string, text = 'x'): SongText => ({ id, title, text, addedAt: 1 });

describe('song texts', () => {
  it('adds and replaces by title', () => {
    const list = upsertSongText([t('1', 'A')], t('2', 'B'));
    expect(list.map((x) => x.id)).toEqual(['1', '2']);
    const again = upsertSongText(list, t('9', ' a ', 'new'));
    expect(again).toHaveLength(2);
    expect(again[0]).toMatchObject({ id: '1', title: 'a', text: 'new' });
  });

  it('removes by id', () => {
    expect(removeSongText([t('1', 'A'), t('2', 'B')], '1').map((x) => x.id)).toEqual(['2']);
  });

  it('picks the chosen texts as inspiration, at most 3 and trimmed in length', () => {
    const list = [t('1', 'A', 'one'), t('2', 'B', 'x'.repeat(2000)), t('3', 'C', 'three'), t('4', 'D', 'four'), t('5', 'E', '   ')];
    expect(inspirationOf(list, ['1', '2', '3', '4'])).toHaveLength(3);
    expect(inspirationOf(list, ['2'])[0]).toHaveLength(1200);
    expect(inspirationOf(list, ['5'])).toEqual([]);
    expect(inspirationOf(list, [])).toEqual([]);
  });

  it('makes a title from the first words', () => {
    expect(titleFromText('\nKein Entkommen, keine Wahl\nzweite')).toBe('Kein Entkommen, keine Wahl');
    expect(titleFromText('')).toBe('Songtext');
  });
});

describe('lyricsFromFile', () => {
  it('reads a plain text file', () => {
    expect(lyricsFromFile('Dark Desire.txt', '﻿Dark desire\r\nIn the night\r\n\r\n\r\n\r\nHook')).toEqual({ title: 'Dark Desire', text: 'Dark desire\nIn the night\n\nHook' });
  });

  it('drops LRC time stamps and tags', () => {
    expect(lyricsFromFile('song.lrc', '[ar:Carl Haze]\n[ti:Rave]\n[00:12.30]Feel the bass\n[00:15.00][00:45.00]Move')).toEqual({ title: 'song', text: 'Feel the bass\nMove' });
  });

  it('falls back to the first words for a nameless file', () => {
    expect(lyricsFromFile('.txt', 'Neon lights burning bright').title).toBe('Neon lights burning bright');
  });
});
