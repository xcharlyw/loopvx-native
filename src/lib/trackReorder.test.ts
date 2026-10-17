import { insertionY, reorderTarget } from './trackReorder';

const H = [64, 64, 64, 64];

describe('reorderTarget', () => {
  it('stays put for a small drag', () => {
    expect(reorderTarget(H, 1, 10)).toBe(1);
    expect(reorderTarget(H, 1, -10)).toBe(1);
  });
  it('moves one slot once the centre passes the neighbour\'s centre', () => {
    expect(reorderTarget(H, 1, 70)).toBe(2);
    expect(reorderTarget(H, 1, -70)).toBe(0);
  });
  it('clamps at both ends', () => {
    expect(reorderTarget(H, 0, -500)).toBe(0);
    expect(reorderTarget(H, 0, 5000)).toBe(3);
    expect(reorderTarget(H, 3, -5000)).toBe(0);
  });
  it('counts open automation lanes in the heights', () => {
    const tall = [64, 140, 64];
    // the tall block's centre is at 64 + 70 = 134; the dragged header's centre starts at 32
    expect(reorderTarget(tall, 0, 90)).toBe(0);
    expect(reorderTarget(tall, 0, 110)).toBe(1);
    expect(reorderTarget(tall, 2, -110)).toBe(1);
  });
  it('ignores an unknown index', () => {
    expect(reorderTarget(H, -1, 50)).toBe(-1);
  });
});

describe('insertionY', () => {
  it('is the top of the slot the track would take', () => {
    expect(insertionY(H, 0, 0)).toBe(0);
    expect(insertionY(H, 0, 2)).toBe(128);
    expect(insertionY([64, 140, 64], 2, 2)).toBe(204);
  });
});
