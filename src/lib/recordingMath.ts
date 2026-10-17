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

/** Recording options: bars of count-in (0, 1 or 2) and how many ms earlier the take is moved to make up for the device's input and output delay. */
export interface RecSettings {
  countIn: 0 | 1 | 2;
  latencyMs: number;
  /** MIDI takes: snap the played notes to sixteenths. */
  quantize: boolean;
}

export const DEFAULT_REC_SETTINGS: RecSettings = { countIn: 1, latencyMs: 0, quantize: true };

export const MAX_LATENCY_MS = 400;

/** Stored or typed settings brought into range (anything unusable falls back to the defaults). */
export function clampRecSettings(v: Partial<RecSettings> | undefined | null): RecSettings {
  const countIn = v?.countIn === 0 || v?.countIn === 1 || v?.countIn === 2 ? v.countIn : DEFAULT_REC_SETTINGS.countIn;
  const ms = typeof v?.latencyMs === 'number' && Number.isFinite(v.latencyMs) ? v.latencyMs : DEFAULT_REC_SETTINGS.latencyMs;
  return { countIn, latencyMs: Math.min(MAX_LATENCY_MS, Math.max(0, Math.round(ms / 5) * 5)), quantize: typeof v?.quantize === 'boolean' ? v.quantize : DEFAULT_REC_SETTINGS.quantize };
}
