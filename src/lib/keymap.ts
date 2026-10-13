// Keyboard shortcuts, the pure part: does a key event match a shortcut, and how is a shortcut written (Mac: ⌥⇧⌘B,
// Windows: Strg+Alt+Shift+B). Letters match the typed character, so Cmd+Z is the key labelled Z on a German keyboard too,
// and fall back to the physical key when Alt is held (on a Mac ⌥B types "∫").

export interface KeySpec {
  /** A letter or digit, matched on the typed character (case ignored). */
  letter?: string;
  /** Exact `KeyboardEvent.key` values (Space = ' ', 'Delete', '+', 'ArrowUp' ...); Shift is checked only when `shift` is set. */
  keys?: string[];
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeyEventLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function matchesKey(e: KeyEventLike, k: KeySpec): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (!!k.mod !== mod || !!k.alt !== e.altKey) return false;
  if (k.keys) return k.keys.includes(e.key) && (k.shift === undefined || k.shift === e.shiftKey);
  if (!k.letter || !!k.shift !== e.shiftKey) return false;
  const letter = k.letter.toLowerCase();
  if (e.key.toLowerCase() === letter) return true;
  const code = /^[a-z]$/.test(letter) ? `Key${letter.toUpperCase()}` : /^[0-9]$/.test(letter) ? `Digit${letter}` : '';
  return e.altKey && e.code === code;
}

const NAMES: Record<string, [mac: string, win: string]> = {
  ' ': ['Leertaste', 'Leertaste'],
  Delete: ['⌫', 'Entf'],
  Backspace: ['⌫', 'Rücktaste'],
  Escape: ['Esc', 'Esc'],
  Tab: ['⇥', 'Tab'],
  ArrowUp: ['↑', '↑'],
  ArrowDown: ['↓', '↓'],
  ArrowLeft: ['←', '←'],
  ArrowRight: ['→', '→'],
};

/** How a shortcut is written in menus: `⌥⌘B` on a Mac, `Strg+Alt+B` elsewhere. */
export function shortcutText(k: KeySpec, mac: boolean): string {
  const main = k.letter ? k.letter.toUpperCase() : (k.keys?.[0] ?? '');
  const name = NAMES[main]?.[mac ? 0 : 1] ?? main;
  if (mac) return `${k.alt ? '⌥' : ''}${k.shift ? '⇧' : ''}${k.mod ? '⌘' : ''}${name}`;
  return [k.mod && 'Strg', k.alt && 'Alt', k.shift && 'Shift', name].filter(Boolean).join('+');
}
