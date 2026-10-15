import { createContext, useContext, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { font } from '../constants/theme';
import { setState, useStore } from '../lib/store';
import { ChevronDown, ChevronUp, Close } from './icons';
import { IconBtn, Txt } from './kit';
import { web } from './drag';
import { stepSheet } from './sheetLayout';

/**
 * `.sheet-head` + `.sheet-body` of the original side panels. The arrows make the panel smaller (docked at the bottom, the
 * arrangement above stays visible and usable) or just a title bar, and bigger again. The body stays mounted when it is hidden,
 * so a panel keeps its state (an open Drive folder, a plan) while it is a bar.
 */
/** Where the sheet sits: a panel (resizable) or Live's browser column (fixed, its ✕ closes the column). */
export interface FloatingPlace {
  /** The window's drag handlers: the panel's title row is its title bar. */
  drag: object;
  collapsed: boolean;
  onToggle: () => void;
}
export const SheetPlace = createContext<{ column: boolean; onClose: () => void; floating?: FloatingPlace }>({ column: false, onClose: () => setState({ panel: 'none' }) });

export function Sheet({ title, children, compact }: { title: string; children: ReactNode; compact?: boolean }) {
  const place = useContext(SheetPlace);
  const stored = useStore((st) => st.sheetSize);
  const scale = useStore((st) => st.sheetScale);
  const fl = place.floating;
  const size = fl ? (fl.collapsed ? 'bar' : 'full') : place.column ? 'full' : stored;
  const step = (dir: 'smaller' | 'bigger') => {
    const next = stepSheet({ size, scale }, dir);
    setState({ sheetSize: next.size, sheetScale: next.scale });
  };
  return (
    <>
      <View style={[s.head, compact && s.headCompact, fl && s.headFloat, fl && web({ touchAction: 'none', cursor: 'grab', userSelect: 'none' })]} {...(fl?.drag ?? {})}>
        {fl ? (
          <Txt style={[s.title, { flex: 1 }]} numberOfLines={1}>
            {title}
          </Txt>
        ) : (
          <Pressable style={{ flex: 1 }} disabled={size !== 'bar'} onPress={() => setState({ sheetSize: 'half', sheetScale: 1 })} accessibilityLabel={size === 'bar' ? `${title} aufklappen` : title}>
            <Txt style={[s.title, compact && { fontSize: 13 }]} numberOfLines={1}>
              {title}
            </Txt>
          </Pressable>
        )}
        {fl && (
          <IconBtn onPress={fl.onToggle} accessibilityLabel={fl.collapsed ? 'Fenster aufklappen' : 'Fenster einklappen'}>
            {fl.collapsed ? <ChevronUp /> : <ChevronDown />}
          </IconBtn>
        )}
        {!fl && !place.column && size !== 'bar' && (
          <IconBtn onPress={() => step('smaller')} accessibilityLabel="Fenster verkleinern">
            <ChevronDown />
          </IconBtn>
        )}
        {!fl && !place.column && (size !== 'full' || scale < 1) && (
          <IconBtn onPress={() => step('bigger')} accessibilityLabel="Fenster vergrößern">
            <ChevronUp />
          </IconBtn>
        )}
        <IconBtn onPress={place.onClose} accessibilityLabel={place.column ? 'Browser schließen' : 'Schließen'}>
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
  headFloat: { paddingTop: 6, paddingBottom: 6, paddingHorizontal: 12, backgroundColor: '#16161a', borderBottomWidth: 1, borderBottomColor: '#26262b', minHeight: 44 },
  headCompact: { paddingTop: 6, paddingBottom: 4, paddingHorizontal: 12 },
  title: { ...font(700), fontSize: 15 },
  body: { paddingHorizontal: 14, paddingBottom: 20 },
});
