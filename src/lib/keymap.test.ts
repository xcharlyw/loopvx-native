import { matchesKey, shortcutText, type KeyEventLike } from './keymap';

const ev = (key: string, code: string, m: Partial<KeyEventLike> = {}): KeyEventLike => ({ key, code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...m });

describe('matchesKey', () => {
  it('matches letters on the typed character with Cmd or Ctrl', () => {
    expect(matchesKey(ev('e', 'KeyE', { metaKey: true }), { letter: 'e', mod: true })).toBe(true);
    expect(matchesKey(ev('e', 'KeyE', { ctrlKey: true }), { letter: 'e', mod: true })).toBe(true);
    expect(matchesKey(ev('e', 'KeyE'), { letter: 'e', mod: true })).toBe(false);
    // German keyboard: the Z key sits where US has Y, its code is KeyY but it types z
    expect(matchesKey(ev('z', 'KeyY', { ctrlKey: true }), { letter: 'z', mod: true })).toBe(true);
  });
  it('checks Shift and Alt exactly', () => {
    expect(matchesKey(ev('Z', 'KeyZ', { metaKey: true, shiftKey: true }), { letter: 'z', mod: true })).toBe(false);
    expect(matchesKey(ev('Z', 'KeyZ', { metaKey: true, shiftKey: true }), { letter: 'z', mod: true, shift: true })).toBe(true);
    // Mac: ⌥⌘B types "∫", the physical key still counts
    expect(matchesKey(ev('∫', 'KeyB', { metaKey: true, altKey: true }), { letter: 'b', mod: true, alt: true })).toBe(true);
    expect(matchesKey(ev('b', 'KeyB', { metaKey: true }), { letter: 'b', mod: true, alt: true })).toBe(false);
  });
  it('matches named keys whatever the Shift state', () => {
    expect(matchesKey(ev('+', 'BracketRight', { shiftKey: false }), { keys: ['+', '='] })).toBe(true);
    expect(matchesKey(ev('?', 'Minus', { shiftKey: true }), { keys: ['?'] })).toBe(true);
    expect(matchesKey(ev(' ', 'Space'), { keys: [' '] })).toBe(true);
    expect(matchesKey(ev(' ', 'Space', { metaKey: true }), { keys: [' '] })).toBe(false);
    expect(matchesKey(ev('Tab', 'Tab', { shiftKey: true }), { keys: ['Tab'], shift: false })).toBe(false);
    expect(matchesKey(ev('Tab', 'Tab', { shiftKey: true }), { keys: ['Tab'], shift: true })).toBe(true);
  });
});

describe('shortcutText', () => {
  it('writes Mac and Windows style', () => {
    expect(shortcutText({ letter: 'b', mod: true, alt: true }, true)).toBe('⌥⌘B');
    expect(shortcutText({ letter: 'b', mod: true, alt: true }, false)).toBe('Strg+Alt+B');
    expect(shortcutText({ letter: 'z', mod: true, shift: true }, true)).toBe('⇧⌘Z');
    expect(shortcutText({ keys: [' '] }, false)).toBe('Leertaste');
    expect(shortcutText({ keys: ['Delete', 'Backspace'] }, false)).toBe('Entf');
    expect(shortcutText({ keys: ['Tab'] }, true)).toBe('⇥');
  });
});
