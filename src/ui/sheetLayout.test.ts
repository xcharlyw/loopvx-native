import { BAR_HEIGHT, bigger, clampScale, fullHeight, stepSheet, browserWidth, placementFor, sheetLayout, smaller } from './sheetLayout';

describe('sheet layout', () => {
  it('is a side panel in full size and docked below', () => {
    expect(sheetLayout('full', { width: 390, height: 800 })).toEqual({ docked: false, width: 390 });
    expect(sheetLayout('full', { width: 1280, height: 800 }).width).toBe(420);
    expect(sheetLayout('half', { width: 390, height: 800 })).toEqual({ docked: true, width: 390, height: 336 });
    expect(sheetLayout('bar', { width: 390, height: 800 })).toEqual({ docked: true, width: 390, height: BAR_HEIGHT });
  });
  it('keeps the half size usable on tiny and huge screens', () => {
    expect(sheetLayout('half', { width: 320, height: 400 }).height).toBe(240);
    expect(sheetLayout('half', { width: 1600, height: 1400 })).toEqual({ docked: true, width: 560, height: 440 });
  });
  it('steps between the sizes', () => {
    expect(smaller('full')).toBe('half');
    expect(smaller('half')).toBe('bar');
    expect(smaller('bar')).toBe('bar');
    expect(bigger('bar')).toBe('half');
    expect(bigger('half')).toBe('full');
    expect(bigger('full')).toBe('full');
  });
});

describe('placement on a wide screen (Live layout)', () => {
  const win = { width: 1400, height: 900 };
  it('docks detail panels at the bottom across the width', () => {
    expect(placementFor('piano', 'full', win, true)).toEqual({ docked: true, width: 1400, height: 414, detail: true });
    expect(placementFor('devices', 'half', win, true)).toEqual({ docked: true, width: 1400, height: 288, detail: true });
    expect(placementFor('clip', 'bar', win, true).height).toBe(BAR_HEIGHT);
    expect(placementFor('mixer', 'full', win, true).height).toBe(558);
  });
  it('keeps the other panels and every panel on a phone as they were', () => {
    expect(placementFor('export', 'full', win, true)).toEqual({ docked: false, width: 420, detail: false });
    expect(placementFor('piano', 'full', { width: 390, height: 800 }, false)).toEqual({ docked: false, width: 390, detail: false });
  });
  it('sizes the browser column', () => {
    expect(browserWidth(1400)).toBe(406);
    expect(browserWidth(800)).toBe(280);
    expect(browserWidth(3000)).toBe(440);
  });
  it('keeps a dragged browser width within its limits', () => {
    expect(browserWidth(1400, 500)).toBe(500);
    expect(browserWidth(1400, 100)).toBe(260);
    expect(browserWidth(1400, 900)).toBe(600);
    expect(browserWidth(900, 520)).toBe(450);
  });
});

describe('scaled full size', () => {
  it('docks a scaled full panel at that fraction of the window', () => {
    expect(sheetLayout('full', { width: 390, height: 800 }, 0.67)).toEqual({ docked: true, width: 390, height: 536 });
    expect(sheetLayout('full', { width: 390, height: 800 }, 1)).toEqual({ docked: false, width: 390 });
    expect(sheetLayout('full', { width: 390, height: 300 }, 0.25).height).toBe(160);
  });
  it('scales a detail view on a wide screen from its own full height', () => {
    const win = { width: 1400, height: 900 };
    expect(placementFor('piano', 'full', win, true, 0.67).height).toBe(Math.round(900 * 0.46 * 0.67));
    expect(fullHeight('piano', win, true)).toBe(414);
    expect(fullHeight('track', win, true)).toBe(900);
  });
  it('steps full → 67 % → half → bar and back; the handle snaps to full', () => {
    let c = { size: 'full' as const, scale: 1 } as { size: 'full' | 'half' | 'bar'; scale: number };
    c = stepSheet(c, 'smaller');
    expect(c).toEqual({ size: 'full', scale: 0.67 });
    c = stepSheet(c, 'smaller');
    expect(c).toEqual({ size: 'half', scale: 1 });
    c = stepSheet(c, 'smaller');
    expect(c.size).toBe('bar');
    expect(stepSheet(stepSheet({ size: 'bar', scale: 1 }, 'bigger'), 'bigger')).toEqual({ size: 'full', scale: 0.67 });
    expect(stepSheet({ size: 'full', scale: 0.67 }, 'bigger')).toEqual({ size: 'full', scale: 1 });
    expect(clampScale(0.98)).toBe(1);
    expect(clampScale(0.1)).toBe(0.25);
    expect(clampScale(0.5)).toBe(0.5);
  });
});
