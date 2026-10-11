import { clampPitch, clampScroll, EDGE_MAX_SPEED, EDGE_ZONE, edgeScrollSpeed, GRIP_W, movedNote, noteHitAreas, resizedNote } from './noteDrag';

const note = { pitch: 48, start: 0.25, length: 0.125, velocity: 0.8 };
const W = 24;
const H = 22;

describe('movedNote', () => {
  it('snaps to whole 16th steps and semitones', () => {
    expect(movedNote(note, 0, 0, W, H)).toEqual({ start: 0.25, pitch: 48 });
    expect(movedNote(note, 24, 0, W, H)).toEqual({ start: 0.3125, pitch: 48 });
    expect(movedNote(note, 11, 0, W, H).start).toBe(0.25); // not yet half a step
    expect(movedNote(note, 13, 0, W, H).start).toBeCloseTo(0.3125);
    expect(movedNote(note, -48, 0, W, H).start).toBeCloseTo(0.125);
  });
  it('moves up when the finger goes up (screen y shrinks)', () => {
    expect(movedNote(note, 0, -22, W, H).pitch).toBe(49);
    expect(movedNote(note, 0, 44, W, H).pitch).toBe(46);
    expect(movedNote(note, 0, 10, W, H).pitch).toBe(48);
    expect(movedNote(note, 0, 12, W, H).pitch).toBe(47);
  });
  it('is computed from the start, so going out and back returns to the start exactly', () => {
    const there = movedNote(note, 120, -66, W, H);
    const back = movedNote(note, 0, 0, W, H);
    expect(there).not.toEqual(back);
    expect(back).toEqual({ start: note.start, pitch: note.pitch });
  });
});

describe('resizedNote', () => {
  it('moves the end on the 16th grid', () => {
    expect(resizedNote(note, 0, W).length).toBeCloseTo(0.125);
    expect(resizedNote(note, 24, W).length).toBeCloseTo(0.1875);
    expect(resizedNote(note, 48, W).length).toBeCloseTo(0.25);
    expect(resizedNote(note, -24, W).length).toBeCloseTo(0.0625);
  });
  it('keeps at least one step, however far it is dragged back', () => {
    expect(resizedNote(note, -500, W).length).toBeCloseTo(1 / 16);
  });
  it('snaps an off-grid end to the grid', () => {
    const loose = { pitch: 40, start: 0.03, length: 0.2, velocity: 1 }; // ends at 0.23 = 3.68 steps
    const end = loose.start + (resizedNote(loose, 0, W).length ?? 0);
    expect(end * 16).toBeCloseTo(4);
  });
});

it('clamps a pitch to the visible rows', () => {
  expect(clampPitch(70, 36, 60)).toBe(60);
  expect(clampPitch(10, 36, 60)).toBe(36);
  expect(clampPitch(50, 36, 60)).toBe(50);
});

describe('noteHitAreas', () => {
  it('a short note: the whole note moves, the grip sits behind its end and does not overlap it', () => {
    const a = noteHitAreas(100, 24, 1000);
    expect(a.gripInside).toBe(false);
    expect(a.move).toEqual({ left: 100, width: 24 });
    expect(a.grip.left).toBeGreaterThanOrEqual(100 + 24 - 2);
    // the centre of the note is on the move area, not on the grip
    expect(100 + 12).toBeLessThan(a.grip.left);
  });
  it('a long note carries the grip inside its last stretch and the move area stops before it', () => {
    const a = noteHitAreas(100, 200, 1000);
    expect(a.gripInside).toBe(true);
    expect(a.move.left + a.move.width).toBeLessThanOrEqual(a.grip.left);
    expect(a.grip.left + a.grip.width).toBeCloseTo(300);
    expect(a.grip.width).toBe(GRIP_W);
  });
  it('a note at the clip end keeps the grip inside, since nothing lies behind it', () => {
    const a = noteHitAreas(960, 24, 984);
    expect(a.gripInside).toBe(true);
    expect(a.grip.left + a.grip.width).toBeLessThanOrEqual(984 + 1e-9); // fully inside the grid
    expect(a.move.left + a.move.width).toBeLessThanOrEqual(a.grip.left + 1e-9); // and no overlap with the move area
    expect(a.move.width).toBeGreaterThanOrEqual(8);
  });
});

describe('edgeScrollSpeed', () => {
  const L = 100;
  const R = 400;
  it('is still in the middle of the view', () => {
    expect(edgeScrollSpeed(250, L, R)).toBe(0);
    expect(edgeScrollSpeed(L + EDGE_ZONE + 1, L, R)).toBe(0);
    expect(edgeScrollSpeed(R - EDGE_ZONE - 1, L, R)).toBe(0);
  });
  it('scrolls left near the left edge and right near the right edge, faster the nearer', () => {
    expect(edgeScrollSpeed(L + EDGE_ZONE / 2, L, R)).toBeCloseTo(-EDGE_MAX_SPEED / 2);
    expect(edgeScrollSpeed(R - EDGE_ZONE / 2, L, R)).toBeCloseTo(EDGE_MAX_SPEED / 2);
    expect(Math.abs(edgeScrollSpeed(L + 5, L, R))).toBeGreaterThan(Math.abs(edgeScrollSpeed(L + 30, L, R)));
  });
  it('stays at full speed beyond the edge, whichever side', () => {
    expect(edgeScrollSpeed(L - 200, L, R)).toBe(-EDGE_MAX_SPEED);
    expect(edgeScrollSpeed(R + 500, L, R)).toBe(EDGE_MAX_SPEED);
  });
  it('is safe with a missing or tiny view', () => {
    expect(edgeScrollSpeed(10, 0, 0)).toBe(0);
    expect(edgeScrollSpeed(NaN, L, R)).toBe(0);
    expect(edgeScrollSpeed(30, 0, 60)).toBe(0); // the middle third of a tiny view is calm
    expect(edgeScrollSpeed(50, 0, 60)).toBeGreaterThan(0);
    expect(edgeScrollSpeed(1, 0, 60)).toBeLessThan(0);
  });
});

it('clampScroll keeps the offset inside the content', () => {
  expect(clampScroll(-30, 1536, 300)).toBe(0);
  expect(clampScroll(400, 1536, 300)).toBe(400);
  expect(clampScroll(9999, 1536, 300)).toBe(1236);
  expect(clampScroll(50, 200, 300)).toBe(0); // content narrower than the view
});
