import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import type { AudioBuffer } from 'react-native-audio-api';
import { engine } from '../audio/engine';
import { detectOnsets, gridOnsets, MAX_SLICES, toSlices } from '../audio/slicing';
import { SLICE_ROOT } from '../audio/synth';
import { C, font, mono } from '../constants/theme';
import { sliceSampleToTrack } from '../lib/actions';
import { sliceBars } from '../audio/slicing';
import { slicerTrack } from '../lib/sliceTrack';
import { errorText, toast, useStore } from '../lib/store';
import { Btn, Chip, Section, Txt } from './kit';
import { Param } from './Param';
import { Sheet } from './Sheet';
import { getPeaks } from './Waveform';

type Mode = 'transient' | 4 | 8 | 16;
const MODES: { id: Mode; label: string }[] = [
  { id: 'transient', label: 'Transienten' },
  { id: 4, label: 'Raster 1/4' },
  { id: 8, label: 'Raster 1/8' },
  { id: 16, label: 'Raster 1/16' },
];
const WAVE_H = 96;

/** Cut a loop into slices (by transients or a beat grid), listen to each, and put them on pads or turn the loop into MIDI. */
export function SlicePanel() {
  const sampleId = useStore((st) => st.sliceSampleId);
  const sample = useStore((st) => st.samples.find((x) => x.id === st.sliceSampleId));
  const project = useStore((st) => st.project);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(() => (sampleId ? (engine.getBuffer(sampleId) ?? null) : null));
  const [mode, setMode] = useState<Mode>('transient');
  const [sensitivity, setSensitivity] = useState(0.5);
  const [width, setWidth] = useState(300);

  useEffect(() => {
    if (!sampleId) return;
    let alive = true;
    setBuffer(engine.getBuffer(sampleId) ?? null);
    engine
      .loadBuffer(sampleId)
      .then((b) => alive && setBuffer(b))
      .catch((e) => toast(errorText(e), 'error'));
    return () => {
      alive = false;
    };
  }, [sampleId]);

  const slices = useMemo(() => {
    if (!buffer) return [];
    const starts = mode === 'transient' ? detectOnsets(buffer.getChannelData(0), buffer.sampleRate, { sensitivity }) : sample?.bpm ? gridOnsets(buffer.duration, sample.bpm, mode) : [0];
    return toSlices(starts, buffer.duration);
  }, [buffer, mode, sensitivity, sample?.bpm]);

  if (!sample) {
    return (
      <Sheet title="Slicen">
        <Txt style={s.note}>Wähle im Arrangement einen Audio-Clip und tippe im Clip-Fenster auf „Slicen“.</Txt>
      </Sheet>
    );
  }
  const duration = buffer?.duration ?? sample.duration ?? 0;
  const peaks = buffer ? getPeaks(sample.id, buffer, 256) : null;
  const wavePath = peaks
    ? peaks.reduce((d, v, i) => `${d}${i ? 'L' : 'M'}${((i / (peaks.length - 1)) * width).toFixed(1)} ${(WAVE_H / 2 - v * (WAVE_H / 2 - 4)).toFixed(1)} `, '') +
      [...peaks].reverse().reduce((d, v, i) => `${d}L${(((peaks.length - 1 - i) / (peaks.length - 1)) * width).toFixed(1)} ${(WAVE_H / 2 + v * (WAVE_H / 2 - 4)).toFixed(1)} `, '') +
      'Z'
    : '';
  const needsTempo = mode !== 'transient' && !sample.bpm;
  const audition = (i: number) => {
    const synth = slicerTrack(sample, slices, { mode: 'pads', projectBpm: project.bpm, sceneCount: project.sceneCount }).synth!;
    void engine.previewNote(synth, SLICE_ROOT + i);
  };
  const capped = slices.length >= MAX_SLICES;

  return (
    <Sheet title="Slicen">
      <Txt style={s.name} numberOfLines={1}>{sample.name}</Txt>
      <Txt style={s.note}>{`${duration.toFixed(2)} s${sample.bpm ? `, ${Math.round(sample.bpm * 10) / 10} BPM` : ', Tempo unbekannt'}`}</Txt>

      <View style={s.wave} onLayout={(e) => setWidth(Math.max(120, e.nativeEvent.layout.width))}>
        <Svg width={width} height={WAVE_H}>
          {!!wavePath && <Path d={wavePath} fill={C.accent} opacity={0.55} />}
          {duration > 0 &&
            slices.map((sl, i) => <Line key={i} x1={(sl.start / duration) * width} x2={(sl.start / duration) * width} y1={0} y2={WAVE_H} stroke={C.text} strokeWidth={1} opacity={0.85} />)}
        </Svg>
      </View>

      <Section title="Schneiden nach">
        <View style={s.chips}>
          {MODES.map((m) => (
            <Chip key={String(m.id)} variant={mode === m.id ? 'on' : 'ghost'} accessibilityLabel={m.label} onPress={() => setMode(m.id)}>
              {m.label}
            </Chip>
          ))}
        </View>
        {mode === 'transient' && <Param label="Empfindlich" value={sensitivity} min={0} max={1} text={`${Math.round(sensitivity * 100)} %`} onChange={(v) => setSensitivity(Math.round(v * 20) / 20)} />}
        {needsTempo && <Txt style={s.warn}>Für das Raster braucht das Sample ein Tempo: im Clip-Fenster „Tempo erkennen“ oder eintragen.</Txt>}
        <Txt style={s.note}>{`${slices.length} Slice${slices.length === 1 ? '' : 's'}${capped ? ` (mehr als ${MAX_SLICES} passen nicht auf die Pads)` : ''}`}</Txt>
      </Section>

      <Section title="Pads (antippen zum Anhören)">
        <View style={s.pads}>
          {slices.map((sl, i) => {
            const bars = sliceBars(sl, sample.bpm, project.bpm);
            return (
              <Pressable key={i} accessibilityLabel={`Slice ${i + 1} anhören`} onPress={() => audition(i)} style={s.pad}>
                <Txt style={s.padNum}>{i + 1}</Txt>
                <Txt style={s.padSub}>{`${Math.round(bars.start * 100) / 100}`}</Txt>
              </Pressable>
            );
          })}
        </View>
        <Txt style={s.note}>Die kleine Zahl ist die Stelle im Loop in Takten.</Txt>
      </Section>

      <View style={s.buttons}>
        <Btn disabled={!slices.length || needsTempo} accessibilityLabel="Slices auf Pads legen" onPress={() => sliceSampleToTrack(sample, slices, 'pads')}>
          Auf Pads legen
        </Btn>
        <Btn kind="primary" disabled={!slices.length || needsTempo} accessibilityLabel="Loop in MIDI umwandeln" onPress={() => sliceSampleToTrack(sample, slices, 'midi')}>
          In MIDI umwandeln
        </Btn>
      </View>
      <Txt style={s.note}>Auf Pads: neue MIDI-Spur, C1 spielt Slice 1, die Tasten darüber die nächsten. In MIDI: dazu Noten, die den Loop in der Originalreihenfolge ab der Abspiellinie spielen. Dort stellst du die Slices um.</Txt>
    </Sheet>
  );
}

const s = StyleSheet.create({
  name: { fontSize: 14, ...font(600), marginBottom: 2 },
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  warn: { color: C.danger, fontSize: 12, lineHeight: 17, marginTop: 8 },
  wave: { height: WAVE_H, borderRadius: 8, backgroundColor: C.panel, overflow: 'hidden', marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pads: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pad: { width: 52, height: 48, borderRadius: 8, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  padNum: { fontSize: 15, ...font(700) },
  padSub: { fontSize: 9, color: C.dim, ...mono() },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
});
