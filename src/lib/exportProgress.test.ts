import { percentText, progressValue } from './exportProgress';

describe('export progress', () => {
  it('is the done share of the work, between 0 and 1', () => {
    expect(progressValue(0, 10)).toBe(0);
    expect(progressValue(5, 10)).toBe(0.5);
    expect(progressValue(12, 10)).toBe(1);
    expect(progressValue(-1, 10)).toBe(0);
    expect(progressValue(3, 0)).toBe(0);
  });
  it('shows whole percent, never rounding up to 100 early', () => {
    expect(percentText(0)).toBe('0 %');
    expect(percentText(0.376)).toBe('37 %');
    expect(percentText(0.999)).toBe('99 %');
    expect(percentText(1)).toBe('100 %');
  });
});
