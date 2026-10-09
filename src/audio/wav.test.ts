import { encodeWav } from './wav';

describe('encodeWav', () => {
  it('writes a valid 16-bit stereo header and clamps samples', () => {
    const left = new Float32Array([0, 1, -1, 2]);
    const right = new Float32Array([0.5, -0.5, 0, -2]);
    const buf = encodeWav({ sampleRate: 44100, channels: [left, right] });
    const v = new DataView(buf);
    const text = (o: number) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(buf.byteLength).toBe(44 + 16);
    // frame 1 left = 1.0 -> 32767, frame 3 left = 2 (clamped) -> 32767, frame 3 right = -2 -> -32768
    expect(v.getInt16(44 + 4, true)).toBe(32767);
    expect(v.getInt16(44 + 12, true)).toBe(32767);
    expect(v.getInt16(44 + 14, true)).toBe(-32768);
  });
});
