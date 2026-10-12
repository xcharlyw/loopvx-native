/** One finished recording: a 16-bit WAV file and its length. */
export interface Take {
  data: ArrayBuffer;
  seconds: number;
}

export interface Recorder {
  /** Loudness of the latest audio block, 0..1 (for a level meter). */
  level(): number;
  stop(): Promise<Take>;
  cancel(): void;
}
