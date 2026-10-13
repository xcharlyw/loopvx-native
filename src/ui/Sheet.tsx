import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { font } from '../constants/theme';
import { setState, useStore } from '../lib/store';
import { ChevronDown, ChevronUp, Close } from './icons';
import { IconBtn, Txt } from './kit';
import { bigger, smaller } from './sheetLayout';

/**
 * `.sheet-head` + `.sheet-body` of the original side panels. The arrows make the panel smaller (docked at the bottom, the
 * arrangement above stays visible and usable) or just a title bar, and bigger again. The body stays mounted when it is hidden,
 * so a panel keeps its state (an open Drive folder, a plan) while it is a bar.
 */
export function Sheet({ title, children }: { title: string; children: ReactNode }) {
  const size = useStore((st) => st.sheetSize);
  return (
    <>
      <View style={s.head}>
        <Pressable style={{ flex: 1 }} disabled={size !== 'bar'} onPress={() => setState({ sheetSize: 'half' })} accessibilityLabel={size === 'bar' ? `${title} aufklappen` : title}>
          <Txt style={s.title} numberOfLines={1}>
            {title}
          </Txt>
        </Pressable>
        {size !== 'bar' && (
          <IconBtn onPress={() => setState({ sheetSize: smaller(size) })} accessibilityLabel="Fenster verkleinern">
            <ChevronDown />
          </IconBtn>
        )}
        {size !== 'full' && (
          <IconBtn onPress={() => setState({ sheetSize: bigger(size) })} accessibilityLabel="Fenster vergrößern">
            <ChevronUp />
          </IconBtn>
        )}
        <IconBtn onPress={() => setState({ panel: 'none' })} accessibilityLabel="Schließen">
          <Close />
        </IconBtn>
      </View>
      <ScrollView style={[{ flex: 1 }, size === 'bar' && { display: 'none' }]} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 10 },
  title: { ...font(700), fontSize: 17 },
  body: { paddingHorizontal: 14, paddingBottom: 20 },
});
