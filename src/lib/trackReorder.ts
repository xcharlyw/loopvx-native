/**
 * Where a track header dropped after a vertical drag ends up. `heights` is the block height of every track
 * (its row plus an open automation lane), `from` the dragged track's index, `dy` the finger's travel in px.
 * The track takes the slot whose neighbours' centres it has passed, so it swaps once its centre crosses the next header's centre.
 */
export function reorderTarget(heights: number[], from: number, dy: number): number {
  if (from < 0 || from >= heights.length) return from;
  const tops: number[] = [];
  let y = 0;
  for (const h of heights) {
    tops.push(y);
    y += h;
  }
  const centre = tops[from] + heights[from] / 2 + dy;
  // The slot is the number of other tracks whose centre lies above the dragged header's centre.
  let index = 0;
  for (let i = 0; i < heights.length; i++) if (i !== from && tops[i] + heights[i] / 2 < centre) index++;
  return index;
}

/** Index of the slot a dragged track would take, as the y of the insertion line in px from the top of the list. */
export function insertionY(heights: number[], from: number, to: number): number {
  const rest = heights.filter((_, i) => i !== from);
  let y = 0;
  for (let i = 0; i < to; i++) y += rest[i] ?? 0;
  return y;
}
