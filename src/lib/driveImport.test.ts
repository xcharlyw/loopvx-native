import { COMPUTERS_ID, SHARED_ID, VIRTUAL_ROOTS, computerFolders, isVirtualId, browserEntries, collectAudio, driveSampleId, isAudio, notYetImported, sampleFromDriveFile, sizeText, type DriveEntry } from './driveImport';

const folder = (id: string, name: string): DriveEntry => ({ id, name, mimeType: 'application/vnd.google-apps.folder' });
const file = (id: string, name: string, mimeType = 'audio/wav', size?: string): DriveEntry => ({ id, name, mimeType, size });

describe('what counts as audio', () => {
  it('takes audio mime types and audio extensions, not folders or Google documents', () => {
    expect(isAudio(file('1', 'a.wav'))).toBe(true);
    expect(isAudio(file('2', 'loop', 'audio/mpeg'))).toBe(true);
    expect(isAudio(file('3', 'kick.WAV', 'application/octet-stream'))).toBe(true);
    expect(isAudio(file('4', 'notes.txt', 'text/plain'))).toBe(false);
    expect(isAudio(file('5', 'song.wav', 'application/vnd.google-apps.document'))).toBe(false);
    expect(isAudio(folder('6', 'Kicks.wav'))).toBe(false);
  });
});

describe('browserEntries', () => {
  it('lists folders first and audio after, sorted naturally, hiding everything else', () => {
    const { folders, audio } = browserEntries([file('a', 'Kick 10.wav'), file('b', 'Kick 2.wav'), folder('c', 'Zebra'), folder('d', 'alpha'), file('e', 'readme.txt', 'text/plain')]);
    expect(folders.map((f) => f.name)).toEqual(['alpha', 'Zebra']);
    expect(audio.map((f) => f.name)).toEqual(['Kick 2.wav', 'Kick 10.wav']);
  });
});

describe('sampleFromDriveFile', () => {
  it('reads tempo and key from the name and the category from the folder', () => {
    const s = sampleFromDriveFile(file('abc', 'Rumble_155bpm_Fm.wav', 'audio/wav', '2500000'), 'Loops/Kicks', 1000);
    expect(s).toMatchObject({ id: 'drive:abc', name: 'Rumble_155bpm_Fm.wav', driveId: 'abc', folder: 'Kicks', size: 2500000, addedAt: 1000, bpm: 155, category: 'kick' });
    expect(s.key).toBeTruthy();
  });
  it('keeps only the last sub-folder as the library folder, but still reads the category from the whole path', () => {
    const s = sampleFromDriveFile(file('d', 'Loop 07.wav'), 'Computer/My Mac/Sounds/Kicks');
    expect(s.folder).toBe('Kicks');
    expect(s.category).toBe('kick');
    expect(sampleFromDriveFile(file('e', 'x.wav'), 'Single').folder).toBe('Single');
  });

  it('leaves tempo empty for one-shots and the folder empty at the top', () => {
    const s = sampleFromDriveFile(file('x', 'Snare.wav'), '', 5);
    expect(s.bpm).toBeUndefined();
    expect(s.folder).toBeUndefined();
    expect(driveSampleId('x')).toBe('drive:x');
  });
});

describe('notYetImported', () => {
  it('skips files that are already in the library by Drive id', () => {
    const items = [{ file: file('a', 'a.wav'), folder: '' }, { file: file('b', 'b.wav'), folder: '' }];
    expect(notYetImported(items, [{ driveId: 'a' }, {}]).map((i) => i.file.id)).toEqual(['b']);
    expect(notYetImported(items, [])).toHaveLength(2);
  });
});

describe('collectAudio', () => {
  const tree: Record<string, DriveEntry[]> = {
    root: [file('1', 'a.wav'), folder('f1', 'Kicks'), folder('f2', 'Tops'), file('x', 'readme.txt', 'text/plain')],
    f1: [file('2', 'k1.wav'), folder('f3', 'Rumble')],
    f2: [file('3', 't1.wav')],
    f3: [file('4', 'r1.wav')],
  };
  const list = async (id: string) => tree[id] ?? [];

  it('walks sub-folders and records the relative path', async () => {
    const { items, truncated } = await collectAudio(list, 'root', 'Loops');
    expect(truncated).toBe(false);
    expect(items.map((i) => `${i.folder}|${i.file.name}`)).toEqual(['Loops|a.wav', 'Loops/Kicks|k1.wav', 'Loops/Kicks/Rumble|r1.wav', 'Loops/Tops|t1.wav']);
  });

  it('stops at the file limit and says so', async () => {
    const { items, truncated } = await collectAudio(list, 'root', 'Loops', { maxDepth: 6, maxFiles: 2 });
    expect(items).toHaveLength(2);
    expect(truncated).toBe(true);
  });

  it('stops at the depth limit and says so', async () => {
    const { items, truncated } = await collectAudio(list, 'root', 'Loops', { maxDepth: 1, maxFiles: 50 });
    expect(items.map((i) => i.file.name)).toEqual(['a.wav', 'k1.wav', 't1.wav']);
    expect(truncated).toBe(true);
  });
});

describe('sizeText', () => {
  it('shows megabytes and kilobytes, nothing for unknown sizes', () => {
    expect(sizeText('12345678')).toBe('12,3 MB');
    expect(sizeText('52000')).toBe('52 KB');
    expect(sizeText(undefined)).toBe('');
  });
});

describe('places outside My Drive', () => {
  it('lists Computer and Shared with me as virtual folders', () => {
    expect(VIRTUAL_ROOTS.map((f) => f.name)).toEqual(['Computer', 'Mit mir geteilt']);
    expect(isVirtualId(COMPUTERS_ID)).toBe(true);
    expect(isVirtualId(SHARED_ID)).toBe(true);
    expect(isVirtualId('root')).toBe(false);
  });

  it('finds backed-up computers as owned folders without a parent', () => {
    const folders: DriveEntry[] = [
      { ...folder('m', 'My Mac'), parents: [] },
      { ...folder('w', 'Windows PC') },
      { ...folder('loops', 'Loops'), parents: ['root-id'] },
      { ...file('a', 'x.wav'), parents: [] },
    ];
    expect(computerFolders(folders).map((f) => f.name)).toEqual(['My Mac', 'Windows PC']);
  });
});
