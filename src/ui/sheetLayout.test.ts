import { BAR_HEIGHT, bigger, sheetLayout, smaller } from './sheetLayout';

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
