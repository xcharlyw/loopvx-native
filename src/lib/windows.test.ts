import { closeWin, fitRect, focusWin, moveWin, openWin, refitWins, resizeWin, toggleWin, type WinRect } from './windows';

const scr = { width: 1200, height: 800, top: 30 };
const open = (...ids: ('instrument' | 'devices' | 'notefx')[]) => ids.reduce<WinRect[]>((l, id) => openWin(l, id, scr), []);

describe('plugin windows', () => {
  it('opens windows cascaded, the newest in front', () => {
    const l = open('instrument', 'devices');
    expect(l.map((w) => w.id)).toEqual(['instrument', 'devices']);
    expect(l[1].x).toBeGreaterThan(l[0].x);
    expect(l[1].y).toBeGreaterThan(l[0].y);
  });

  it('opening an open window only brings it to the front', () => {
    const l = openWin(open('instrument', 'devices'), 'instrument', scr);
    expect(l.map((w) => w.id)).toEqual(['devices', 'instrument']);
  });

  it('a window opens where it was closed', () => {
    const moved = moveWin(open('instrument'), 'instrument', 400, 200, scr)[0];
    expect(openWin([], 'instrument', scr, moved)[0]).toMatchObject({ x: 400, y: 200 });
  });

  it('focus moves a window to the end and closing removes it', () => {
    const l = open('instrument', 'devices', 'notefx');
    expect(focusWin(l, 'instrument').map((w) => w.id)).toEqual(['devices', 'notefx', 'instrument']);
    expect(focusWin(l, 'notefx')).toBe(l);
    expect(closeWin(l, 'devices').map((w) => w.id)).toEqual(['instrument', 'notefx']);
  });

  it('keeps the title bar reachable when dragged out of the screen', () => {
    const w = moveWin(open('instrument'), 'instrument', -5000, -5000, scr)[0];
    expect(w.y).toBe(scr.top);
    expect(w.x + w.w).toBeGreaterThanOrEqual(90);
    const far = moveWin(open('instrument'), 'instrument', 9000, 9000, scr)[0];
    expect(far.x).toBeLessThanOrEqual(scr.width - 90);
    expect(far.y).toBeLessThanOrEqual(scr.height - 44);
  });

  it('resizes between the minimum and the screen', () => {
    const l = open('instrument');
    expect(resizeWin(l, 'instrument', 10, 10, scr)[0]).toMatchObject({ w: 300, h: 180 });
    expect(resizeWin(l, 'instrument', 9000, 9000, scr)[0]).toMatchObject({ w: 1200, h: 770 });
  });

  it('collapses to the title bar and back', () => {
    const l = toggleWin(open('instrument'), 'instrument');
    expect(l[0].collapsed).toBe(true);
    expect(toggleWin(l, 'instrument')[0].collapsed).toBe(false);
  });

  it('pulls windows back when the screen gets smaller, and never makes one bigger than the screen', () => {
    const small = { width: 500, height: 400, top: 30 };
    for (const w of refitWins(open('instrument', 'devices'), small)) {
      expect(w.w).toBeLessThanOrEqual(500);
      expect(w.h).toBeLessThanOrEqual(370);
      expect(w.x).toBeLessThanOrEqual(500 - 90);
    }
    expect(fitRect({ id: 'devices', x: 0, y: 0, w: 5000, h: 5000 }, small)).toMatchObject({ w: 500, h: 370 });
  });
});
