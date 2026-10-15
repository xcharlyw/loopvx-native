import { samplesInFolder, sourceFolders, voiceClip, voiceSources } from './voiceClip';

describe('voiceClip', () => {
  it('mixes to mono and goes down to about 22 kHz', () => {
    const l = new Float32Array(44100).fill(0.5);
    const r = new Float32Array(44100).fill(-0.1);
    const c = voiceClip([l, r], 44100);
    expect(c.sampleRate).toBe(22050);
    expect(c.data).toHaveLength(22050);
    expect(c.data[100]).toBeCloseTo(0.2, 5);
  });

  it('cuts at the maximum length', () => {
    const c = voiceClip([new Float32Array(48000 * 10)], 48000, 4);
    expect(c.data.length / c.sampleRate).toBeCloseTo(4, 1);
  });
});

describe('voiceSources', () => {
  const list = [
    { name: 'Neue Aufnahme 3.m4a', folder: 'Uploads', addedAt: 30 },
    { name: 'Kick 01.wav', addedAt: 10 },
    { name: 'AI Vocal – dark.mp3', folder: 'AI Vocals', addedAt: 40 },
    { name: 'Sprachmemo.m4a', addedAt: 20 },
  ];

  it('offers any sample, newest first, but not the generated vocals', () => {
    expect(voiceSources(list, '').map((x) => x.name)).toEqual(['Neue Aufnahme 3.m4a', 'Sprachmemo.m4a', 'Kick 01.wav']);
  });

  it('narrows by name and limits the list', () => {
    expect(voiceSources(list, 'memo').map((x) => x.name)).toEqual(['Sprachmemo.m4a']);
    expect(voiceSources(list, '', 1)).toHaveLength(1);
  });
});

describe('sourceFolders / samplesInFolder', () => {
  const list = [
    { name: 'a.wav', folder: 'Vocals', addedAt: 1 },
    { name: 'b.wav', folder: 'Vocals', addedAt: 3 },
    { name: 'memo.m4a', addedAt: 2 },
    { name: 'k.wav', folder: 'Aufnahmen', addedAt: 4 },
    { name: 'ai.mp3', folder: 'AI Vocals', addedAt: 5 },
  ];

  it('lists the folders with counts, no-folder last, without AI Vocals', () => {
    expect(sourceFolders(list)).toEqual([
      { path: 'Aufnahmen', count: 1 },
      { path: 'Vocals', count: 2 },
      { path: '', count: 1 },
    ]);
  });

  it('shows one folder newest first, all folders, or searches everywhere', () => {
    expect(samplesInFolder(list, 'Vocals', '').map((x) => x.name)).toEqual(['b.wav', 'a.wav']);
    expect(samplesInFolder(list, '', '').map((x) => x.name)).toEqual(['memo.m4a']);
    expect(samplesInFolder(list, null, '').map((x) => x.name)).toEqual(['k.wav', 'b.wav', 'memo.m4a', 'a.wav']);
    expect(samplesInFolder(list, 'Vocals', 'memo').map((x) => x.name)).toEqual(['memo.m4a']);
  });
});
