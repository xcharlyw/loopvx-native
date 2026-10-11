import { StyleSheet, View } from 'react-native';
import { C, mono } from '../constants/theme';
import { Fader } from './Fader';
import { Txt } from './kit';

export const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')} kHz` : `${Math.round(v)} Hz`);
export const sec = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2).replace('.', ',')} s`);
export const pct = (v: number) => (v ? `${Math.round(v * 100)} %` : 'Aus');

/** A labelled fader row with its value on the right (synth and effect knobs). */
export function Param({ label, value, min, max, text, onChange }: { label: string; value: number; min: number; max: number; text: string; onChange: (v: number) => void }) {
  return (
    <View style={s.param}>
      <Txt style={s.label}>{label}</Txt>
      <Fader value={value} min={min} max={max} onChange={onChange} />
      <Txt style={s.value}>{text}</Txt>
    </View>
  );
}

const s = StyleSheet.create({
  param: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  label: { width: 74, fontSize: 13 },
  value: { ...mono(), width: 62, fontSize: 12, color: C.muted, textAlign: 'right' },
});
