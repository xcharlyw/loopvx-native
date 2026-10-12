import { COMPUTERS_ID, summarizeImport, isStructureFolder, libraryFolderOf, packFolderFrom, SHARED_ID, VIRTUAL_ROOTS, computerFolders, isVirtualId, browserEntries, collectAudio, driveSampleId, isAudio, notYetImported, sampleFromDriveFile, sizeText, type DriveEntry } from './driveImport';

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

describe('pack folders', () => {
  it('skips folders that only describe the inside of a pack', () => {
    expect(['loops', 'drum_loops', 'Drum_Loops', 'music loops', 'One-Shots', 'drum_grooves'].every(isStructureFolder)).toBe(true);
    expect(['Kicks', 'Bonus Kicks', 'ff_tt_130_kit_loop_full_crave_Gmin'].some(isStructureFolder)).toBe(false);
  });
  it('names the library folder after the pack, not the inner folder', () => {
    expect(libraryFolderOf('Zenhiser Pummel - Hard Techno/loops/drum_loops')).toBe('Zenhiser Pummel - Hard Techno');
    expect(libraryFolderOf('Four4 - 90s Techno & Trance/loops/music_loops/ff_tt_130_kit')).toBe('ff_tt_130_kit');
    expect(libraryFolderOf('Pack/loops')).toBe('Pack');
    expect(libraryFolderOf('loops')).toBe('loops');
    expect(libraryFolderOf('')).toBeUndefined();
    expect(sampleFromDriveFile(file('z', 'a.wav'), 'Pack/loops/drum_loops').folder).toBe('Pack');
  });
  it('finds the pack from a Drive folder id by walking up', async () => {
    const tree: Record<string, { name: string; parent?: string }> = {
      a: { name: 'drum_loops', parent: 'b' },
      b: { name: 'loops', parent: 'c' },
      c: { name: 'Zenhiser Pummel', parent: 'd' },
      d: { name: 'Packs' },
      x: { name: 'drum_loops' },
    };
    const get = async (id: string) => tree[id] ?? null;
    expect(await packFolderFrom(get, 'a')).toBe('Zenhiser Pummel');
    expect(await packFolderFrom(get, 'c')).toBe('Zenhiser Pummel');
    expect(await packFolderFrom(get, 'x')).toBe('drum_loops');
    expect(await packFolderFrom(get, 'missing')).toBeUndefined();
    expect(await packFolderFrom(get, undefined)).toBeUndefined();
  });
});

describe('summarizeImport', () => {
  const items = [
    { file: file('1', 'a.wav', 'audio/wav', '1000'), folder: 'Pack A/loops/drum_loops' },
    { file: file('2', 'b.wav', 'audio/wav', '3000'), folder: 'Pack A/loops/drum_loops' },
    { file: file('3', 'c.wav', 'audio/wav', '500'), folder: 'Pack B/loops' },
    { file: file('4', 'd.wav'), folder: '' },
  ];
  it('counts new files, size and library folders, biggest first', () => {
    const s = summarizeImport(items, [{ driveId: '4' }]);
    expect(s).toMatchObject({ total: 4, fresh: 3, existing: 1, bytes: 4500 });
    expect(s.packs).toEqual([{ name: 'Pack A', count: 2 }, { name: 'Pack B', count: 1 }]);
  });
  it('puts files from the top level on the Hauptebene', () => {
    expect(summarizeImport([items[3]], []).packs).toEqual([{ name: 'Hauptebene', count: 1 }]);
  });
});

describe('collectAudio hooks', () => {
  it('reports the running count and ends early when cancelled', async () => {
    const tree: Record<string, DriveEntry[]> = { root: [file('1', 'a.wav'), folder('f', 'Sub')], f: [file('2', 'b.wav')] };
    const list = async (id: string) => tree[id] ?? [];
    const seen: number[] = [];
    const full = await collectAudio(list, 'root', 'P', undefined, { onFile: (n) => seen.push(n) });
    expect(full.items).toHaveLength(2);
    expect(seen).toEqual([1, 2]);
    let stop = false;
    const cut = await collectAudio(list, 'root', 'P', undefined, { onFile: () => (stop = true), cancelled: () => stop });
    expect(cut.items).toHaveLength(1);
    expect(cut.truncated).toBe(true);
  });
});
