import { AudioManager, AudioRecorder } from 'react-native-audio-api';
import { encodeWav } from '../audio/wav';
import { concatChunks } from './recordingMath';
import type { Recorder, Take } from './recordingTypes';

// Native recording (react-native-audio-api's AudioRecorder, mono PCM); the web build uses recording.web.ts.

export const recordingSupported = () => true;

const SAMPLE_RATE = 44100;

export async function startRecording(): Promise<Recorder> {
  const status = await AudioManager.requestRecordingPermissions();
  if (status !== 'Granted') throw new Error('Kein Zugriff auf das Mikrofon. Erlaube ihn in den Einstellungen.');
  AudioManager.setAudioSessionOptions({ iosCategory: 'playAndRecord', iosMode: 'default', iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'] });
  await AudioManager.setAudioSessionActivity(true);

  const recorder = new AudioRecorder();
  const chunks: Float32Array[] = [];
  let rate = SAMPLE_RATE;
  let peak = 0;
  recorder.onAudioReady({ sampleRate: SAMPLE_RATE, bufferLength: 4096, channelCount: 1 }, ({ buffer }) => {
    const data = buffer.getChannelData(0).slice();
    rate = buffer.sampleRate;
    chunks.push(data);
    peak = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  });
  const started = await recorder.start();
  if (started.status === 'error') throw new Error(`Aufnahme nicht gestartet: ${started.message}`);

  // Back to the player's session (the engine plays with the 'playback' category).
  const restore = () => AudioManager.setAudioSessionOptions({ iosCategory: 'playback' });
  return {
    level: () => peak,
    async stop(): Promise<Take> {
      await recorder.stop();
      restore();
      const samples = concatChunks(chunks);
      return { data: encodeWav({ sampleRate: rate, channels: [samples] }), seconds: samples.length / rate };
    },
    cancel() {
      void recorder.stop();
      restore();
    },
  };
}
