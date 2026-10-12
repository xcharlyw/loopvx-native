import { encodeWav } from '../audio/wav';
import type { Recorder, Take } from './recordingTypes';

// Web recording: the microphone through MediaRecorder, decoded and stored as a WAV so every browser (and the Drive
// sync to another device) can play it; the browser's own format (webm/opus or mp4/aac) is not portable.

export const recordingSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

export async function startRecording(): Promise<Recorder> {
  if (!recordingSupported()) throw new Error('Dieser Browser kann nicht aufnehmen.');
  let stream: MediaStream;
  try {
    // Raw signal: no echo cancelling or gain riding, which would ruin a sample.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch {
    throw new Error('Kein Zugriff auf das Mikrofon. Erlaube ihn in den Browser-Einstellungen.');
  }
  const media = new MediaRecorder(stream);
  const parts: Blob[] = [];
  media.ondataavailable = (e) => e.data.size && parts.push(e.data);

  // A level meter on its own context (never resumed outside this tap-started recording).
  const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
  const meterCtx = new AC();
  const analyser = meterCtx.createAnalyser();
  analyser.fftSize = 1024;
  meterCtx.createMediaStreamSource(stream).connect(analyser);
  const block = new Float32Array(analyser.fftSize);
  const release = () => {
    stream.getTracks().forEach((t) => t.stop());
    void meterCtx.close().catch(() => undefined);
  };
  media.start(250);

  return {
    level: () => {
      analyser.getFloatTimeDomainData(block);
      return block.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    },
    async stop(): Promise<Take> {
      const done = new Promise<void>((resolve) => (media.onstop = () => resolve()));
      if (media.state !== 'inactive') media.stop();
      await done;
      release();
      const blob = new Blob(parts, { type: media.mimeType });
      if (!blob.size) throw new Error('Die Aufnahme ist leer.');
      const ctx = new AC();
      try {
        const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
        const channels = [audio.getChannelData(0).slice()];
        return { data: encodeWav({ sampleRate: audio.sampleRate, channels }), seconds: audio.duration };
      } finally {
        void ctx.close().catch(() => undefined);
      }
    },
    cancel() {
      media.ondataavailable = null;
      if (media.state !== 'inactive') media.stop();
      release();
    },
  };
}
