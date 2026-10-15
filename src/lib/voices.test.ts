import { voiceClip, voiceSources } from './voiceClip';

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
