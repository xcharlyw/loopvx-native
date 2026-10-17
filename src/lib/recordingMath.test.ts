import { DEFAULT_REC_SETTINGS, MAX_LATENCY_MS, clampRecSettings, clock, concatChunks, takeName } from './recordingMath';

describe('concatChunks', () => {
  it('joins the blocks in order', () => {
    expect(Array.from(concatChunks([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([])]))).toEqual([1, 2, 3]);
    expect(concatChunks([])).toHaveLength(0);
  });
});

describe('takeName and clock', () => {
  it('names a take after the day and time', () => {
    expect(takeName(new Date(2026, 9, 12, 16, 4))).toBe('Aufnahme 12.10. 16:04.wav');
  });
  it('shows minutes and seconds', () => {
    expect(clock(7.9)).toBe('0:07');
    expect(clock(125)).toBe('2:05');
    expect(clock(-3)).toBe('0:00');
  });
});

describe('clampRecSettings', () => {
  it('falls back to the defaults for nothing or rubbish', () => {
    expect(clampRecSettings(undefined)).toEqual(DEFAULT_REC_SETTINGS);
    expect(clampRecSettings({ countIn: 7 as never, latencyMs: NaN })).toEqual(DEFAULT_REC_SETTINGS);
  });
  it('keeps valid count-ins, rounds the latency to 5 ms and limits it', () => {
    expect(clampRecSettings({ countIn: 0, latencyMs: 42 })).toEqual({ countIn: 0, latencyMs: 40, quantize: true });
    expect(clampRecSettings({ countIn: 2, latencyMs: -30 })).toEqual({ countIn: 2, latencyMs: 0, quantize: true });
    expect(clampRecSettings({ latencyMs: 9999 }).latencyMs).toBe(MAX_LATENCY_MS);
    expect(clampRecSettings({ quantize: false }).quantize).toBe(false);
    expect(clampRecSettings({ quantize: 'x' as never }).quantize).toBe(true);
  });
});
