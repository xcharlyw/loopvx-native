import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { C } from '../constants/theme';
import { placeSample } from '../lib/actions';
import { uid } from '../lib/project';
import { recordingSupported, startRecording } from '../lib/recording';
import { clock, takeName } from '../lib/recordingMath';
import type { Recorder } from '../lib/recordingTypes';
import { storeSampleAudio } from '../lib/samples';
import { errorText, getState, setSamples, setState, toast } from '../lib/store';
import type { Sample } from '../types';
import { Btn, Txt } from './kit';

/** Records from the microphone into the library (folder "Aufnahmen"); the last take can go straight onto a track. */
export function RecordButton() {
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'saving'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [last, setLast] = useState<Sample | null>(null);
  const recorder = useRef<Recorder | null>(null);

  useEffect(() => {
    if (phase !== 'recording') return;
    const started = Date.now();
    const timer = setInterval(() => {
      setSeconds((Date.now() - started) / 1000);
      setLevel(recorder.current?.level() ?? 0);
    }, 100);
    return () => clearInterval(timer);
  }, [phase]);
  // Leaving the panel mid-recording throws the take away and releases the microphone.
  useEffect(() => () => recorder.current?.cancel(), []);

  if (!recordingSupported()) return null;

  const start = async () => {
    setPhase('starting');
    try {
      recorder.current = await startRecording();
      setSeconds(0);
      setLast(null);
      setPhase('recording');
    } catch (e) {
      toast(errorText(e), 'error');
      setPhase('idle');
    }
  };

  const stop = async () => {
    const rec = recorder.current;
    if (!rec) return;
    recorder.current = null;
    setPhase('saving');
    try {
      const take = await rec.stop();
      const sample: Sample = { id: `rec:${uid()}`, name: takeName(), category: 'other', folder: 'Aufnahmen', duration: take.seconds, size: take.data.byteLength, addedAt: Date.now() };
      const stored = await storeSampleAudio(sample, take.data, 'wav');
      setSamples([...getState().samples.filter((x) => x.id !== stored.id), stored]);
      setLast(stored);
      toast(`${clock(take.seconds)} aufgenommen, zu finden im Ordner „Aufnahmen“`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setPhase('idle');
    }
  };

  const place = () => {
    if (!last) return;
    void placeSample(last);
    setState({ panel: 'none' });
  };

  return (
    <View style={s.wrap}>
      {phase === 'recording' ? (
        <Btn small kind="primary" accessibilityLabel="Aufnahme beenden" onPress={() => void stop()}>
          {`■ Stopp  ${clock(seconds)}`}
        </Btn>
      ) : (
        <Btn small disabled={phase !== 'idle'} accessibilityLabel="Aufnahme starten" onPress={() => void start()}>
          <Txt style={{ color: C.danger }}>●</Txt> Aufnehmen
        </Btn>
      )}
      {phase === 'recording' && (
        <View accessibilityLabel="Pegel" style={s.meter}>
          <View style={[s.meterFill, { width: `${Math.min(100, Math.round(level * 140))}%` }]} />
        </View>
      )}
      {last && phase === 'idle' && (
        <Btn small accessibilityLabel="Aufnahme auf Spur legen" onPress={place}>
          Auf Spur legen
        </Btn>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  meter: { width: 70, height: 6, borderRadius: 3, backgroundColor: C.panel, overflow: 'hidden' },
  meterFill: { height: 6, backgroundColor: C.accent },
});
