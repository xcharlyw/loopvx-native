import { voiceClip } from './voiceClip';

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
