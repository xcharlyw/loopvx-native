/**
 * Undo/redo stacks of immutable snapshots. `record(before)` is called with the state before a change.
 * Quick successive "continuous" changes (dragging a fader, typing a name) merge into one step.
 */
export class History<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];
  private lastContinuousAt = 0;

  constructor(
    private readonly limit = 100,
    private readonly mergeMs = 700,
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  record(before: T, opts: { continuous?: boolean; now?: number } = {}) {
    const now = opts.now ?? Date.now();
    const merge = !!opts.continuous && this.undoStack.length > 0 && now - this.lastContinuousAt < this.mergeMs;
    this.lastContinuousAt = opts.continuous ? now : 0;
    this.redoStack = [];
    if (merge) return;
    this.undoStack.push(before);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
  }

  /** The state to go back to, given the current one (which becomes redo-able). */
  undo(current: T): T | undefined {
    const previous = this.undoStack.pop();
    if (previous === undefined) return undefined;
    this.redoStack.push(current);
    this.lastContinuousAt = 0;
    return previous;
  }

  redo(current: T): T | undefined {
    const next = this.redoStack.pop();
    if (next === undefined) return undefined;
    this.undoStack.push(current);
    this.lastContinuousAt = 0;
    return next;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.lastContinuousAt = 0;
  }
}
