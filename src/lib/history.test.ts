import { History } from './history';

describe('History', () => {
  it('undoes and redoes in order', () => {
    const h = new History<string>();
    h.record('a');
    h.record('b');
    expect(h.canUndo).toBe(true);
    expect(h.undo('c')).toBe('b');
    expect(h.undo('b')).toBe('a');
    expect(h.undo('a')).toBeUndefined();
    expect(h.canRedo).toBe(true);
    expect(h.redo('a')).toBe('b');
    expect(h.redo('b')).toBe('c');
    expect(h.redo('c')).toBeUndefined();
  });

  it('drops redo steps after a new change', () => {
    const h = new History<number>();
    h.record(1);
    h.undo(2);
    expect(h.canRedo).toBe(true);
    h.record(1);
    expect(h.canRedo).toBe(false);
  });

  it('merges quick continuous changes into one step', () => {
    const h = new History<number>(100, 700);
    h.record(0, { continuous: true, now: 1000 });
    h.record(1, { continuous: true, now: 1100 });
    h.record(2, { continuous: true, now: 1700 });
    expect(h.undo(3)).toBe(0);
    expect(h.canUndo).toBe(false);
    // A pause longer than the window starts a new step.
    h.record(3, { continuous: true, now: 5000 });
    h.record(4, { continuous: true, now: 6000 });
    expect(h.undo(5)).toBe(4);
    expect(h.undo(4)).toBe(3);
  });

  it('does not merge a continuous change into a discrete one', () => {
    const h = new History<number>();
    h.record(0, { now: 1000 });
    h.record(1, { continuous: true, now: 1100 });
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBe(0);
  });

  it('keeps at most `limit` steps', () => {
    const h = new History<number>(3);
    for (let i = 0; i < 10; i++) h.record(i);
    const seen: number[] = [];
    for (let v = h.undo(99); v !== undefined; v = h.undo(v)) seen.push(v);
    expect(seen).toEqual([9, 8, 7]);
  });
});
