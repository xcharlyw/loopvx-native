import { clock, concatChunks, takeName } from './recordingMath';

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
