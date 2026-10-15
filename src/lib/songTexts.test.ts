import { inspirationOf, removeSongText, titleFromText, upsertSongText, type SongText } from './songTexts';

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
