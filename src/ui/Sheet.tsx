import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { font } from '../constants/theme';
import { setState } from '../lib/store';
import { Close } from './icons';
import { IconBtn, Txt } from './kit';

/** `.sheet-head` + `.sheet-body` of the original side panels. */
export function Sheet({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <View style={s.head}>
        <Txt style={s.title}>{title}</Txt>
        <IconBtn onPress={() => setState({ panel: 'none' })} accessibilityLabel="Schließen">
          <Close />
        </IconBtn>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 10 },
  title: { ...font(700), fontSize: 17, flex: 1 },
  body: { paddingHorizontal: 14, paddingBottom: 20 },
});
