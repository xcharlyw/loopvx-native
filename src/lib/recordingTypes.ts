/** One finished recording: a 16-bit WAV file and its length. */
export interface Take {
  data: ArrayBuffer;
  seconds: number;
  /** The same audio as mono samples, for cutting the take to the grid before it is stored. */
  pcm: { sampleRate: number; samples: Float32Array };
}

export interface Recorder {
  /** Loudness of the latest audio block, 0..1 (for a level meter). */
  level(): number;
  stop(): Promise<Take>;
  cancel(): void;
}
