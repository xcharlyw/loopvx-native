/** Joins the audio blocks of a recording into one array. */
export function concatChunks(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** "Aufnahme 12.10. 16:24.wav" */
export function takeName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Aufnahme ${p(now.getDate())}.${p(now.getMonth() + 1)}. ${p(now.getHours())}:${p(now.getMinutes())}.wav`;
}

/** "0:07" for a length in seconds. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
