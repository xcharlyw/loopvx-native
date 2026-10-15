/** About 80 s of mono 22 kHz 16-bit WAV is 3.5 MB; the function accepts 4.4 MB. */
export const MAX_VOICE_SECONDS = 80;
const VOICE_RATE = 22050;

/**
 * Mono, about 22 kHz, at most `maxSeconds` from the loudest part of the start: small enough for one request, plenty for cloning.
 * (Box averaging of whole frames; ElevenLabs resamples anyway.)
 */
export function voiceClip(channels: Float32Array[], sampleRate: number, maxSeconds = MAX_VOICE_SECONDS): { data: Float32Array; sampleRate: number } {
  return monoClip(channels, sampleRate, VOICE_RATE, maxSeconds);
}

/** Mono, down to about `targetRate` (whole-frame box averaging), cut at `maxSeconds`. */
export function monoClip(channels: Float32Array[], sampleRate: number, targetRate: number, maxSeconds: number): { data: Float32Array; sampleRate: number } {
  const factor = Math.max(1, Math.round(sampleRate / targetRate));
  const frames = Math.min(Math.floor(channels[0].length / factor), Math.floor(((maxSeconds * sampleRate) / factor)));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (const ch of channels) for (let k = 0; k < factor; k++) sum += ch[i * factor + k] ?? 0;
    out[i] = sum / (channels.length * factor);
  }
  return { data: out, sampleRate: sampleRate / factor };
}


interface SourceLike {
  name: string;
  folder?: string;
  addedAt: number;
}

/**
 * Samples that can be cloned from: any sample (an iPhone voice memo is not filed as a vocal, it can come in as a loop or
 * anything), newest first, optionally narrowed by a name search. The generated "AI Vocals" are left out.
 */
export function voiceSources<T extends SourceLike>(samples: T[], query: string, limit = 12): T[] {
  const q = query.trim().toLowerCase();
  return samples
    .filter((x) => x.folder !== 'AI Vocals' && (!q || x.name.toLowerCase().includes(q)))
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, limit);
}
