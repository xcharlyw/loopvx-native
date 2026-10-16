import { songFileName, songTextFiles } from './songFiles';

describe('song text files', () => {
  it('makes a safe .txt name', () => {
    expect(songFileName('DARK / DESIRE: "Hook"')).toBe('DARK DESIRE Hook.txt');
    expect(songFileName('  ')).toBe('Songtext.txt');
    expect(songFileName('x'.repeat(100))).toBe(`${'x'.repeat(60)}.txt`);
  });
  it('keeps only text files, newest first', () => {
    const f = (id: string, name: string, modifiedTime: string, mimeType?: string) => ({ id, name, modifiedTime, mimeType });
    const out = songTextFiles([f('1', 'a.txt', '2026-01-01'), f('2', 'b.wav', '2026-03-01'), f('3', 'c.lrc', '2026-02-01'), f('4', 'note', '2026-04-01', 'text/plain')]);
    expect(out.map((x) => x.id)).toEqual(['4', '3', '1']);
  });
});
