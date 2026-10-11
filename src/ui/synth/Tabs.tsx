import { Pressable, StyleSheet, View } from 'react-native';
import { C, font } from '../../constants/theme';
import { Txt } from '../kit';

/** Serum-style tabs: small caps, the active one underlined in the accent colour. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <View style={s.bar}>
      {tabs.map((t) => (
        <Pressable key={t.id} accessibilityRole="tab" accessibilityLabel={`Reiter ${t.label}`} accessibilityState={{ selected: value === t.id }} onPress={() => onChange(t.id)} style={[s.tab, value === t.id && s.on]}>
          <Txt style={[s.text, value === t.id && { color: C.accent }]}>{t.label}</Txt>
        </Pressable>
      ))}
    </View>
  );
}

/** A panel with a small-caps title and an optional control on the right. */
export function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Txt style={s.title}>{title}</Txt>
        {right}
      </View>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.line, marginTop: 6, marginBottom: 10 },
  tab: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  on: { borderBottomColor: C.accent },
  text: { ...font(700), fontSize: 11, letterSpacing: 1.2, color: C.muted },
  card: { backgroundColor: '#111114', borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, marginBottom: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, minHeight: 24 },
  title: { ...font(700), fontSize: 10.5, letterSpacing: 1.4, color: C.muted },
});
