import { Pressable, StyleSheet, View } from 'react-native';
import { C, RADIUS, font, mono } from '../constants/theme';
import { percentText } from '../lib/exportProgress';
import { setState, useStore } from '../lib/store';
import { Txt } from './kit';

/** The progress of a long export, like Ableton's bar: what runs now, a bar from 0 to 100 %, "Fertig" at the end (tap to close). */
export function ExportProgressCard({ bottom }: { bottom: number }) {
  const p = useStore((st) => st.exportProgress);
  if (!p) return null;
  return (
    <Pressable style={[s.card, { bottom }]} onPress={() => p.done && setState({ exportProgress: null })} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.floor(p.value * 100) }}>
      <View style={s.head}>
        <Txt style={s.title}>{p.title}</Txt>
        <Txt style={[s.percent, p.done && { color: C.accent }]}>{percentText(p.value)}</Txt>
      </View>
      <View style={s.track}>
        <View style={[s.fill, { width: `${Math.floor(p.value * 100)}%` }]} />
      </View>
      <Txt style={s.label} numberOfLines={1}>
        {p.label}
      </Txt>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { position: 'absolute', alignSelf: 'center', width: '92%', maxWidth: 440, zIndex: 45, backgroundColor: C.panel2, borderColor: C.line, borderWidth: 1, borderRadius: RADIUS, padding: 12, gap: 8 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...font(600) },
  percent: { ...mono(500), color: C.text, fontSize: 13 },
  track: { height: 8, borderRadius: 4, backgroundColor: C.line, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: C.accent },
  label: { color: C.muted, fontSize: 12 },
});
