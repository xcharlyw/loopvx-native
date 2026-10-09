import { Platform } from 'react-native';

let prepared = false;

/**
 * iOS Safari mutes Web Audio while the ring/silent switch is on, unless the page says it plays
 * media. Safari 17+ has `navigator.audioSession` for that; older iOS switches over once an
 * <audio> element plays, so loop a silent one. Must run inside a tap.
 */
export function preparePageAudio() {
  if (prepared || Platform.OS !== 'web' || typeof navigator === 'undefined') return;
  prepared = true;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) {
    session.type = 'playback';
    return;
  }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (!ios) return;
  const el = document.createElement('audio');
  el.src = silentWavUrl();
  el.loop = true;
  el.setAttribute('playsinline', '');
  void el.play().catch(() => {
    prepared = false;
  });
}

/** 0.1 s of 8-bit mono silence. */
function silentWavUrl(): string {
  const samples = 800;
  const bytes = new Uint8Array(44 + samples).fill(128);
  const v = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  text(36, 'data');
  v.setUint32(40, samples, true);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}
