import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { C, font, mono } from '../../constants/theme';
import { sampleDragJustEnded, useSampleDragSource, type DragPayload } from '../dnd';
import { web } from '../drag';
import { Plus } from '../icons';
import { Txt } from '../kit';
import { rowDomId } from './keys';

// One line of the browser, like a row of Live's content pane: a colour tag, the name, small columns on the right and a "+"
// that loads the item in one tap. A tap selects (and auditions, if the preview is on), a double tap loads, a drag carries it.

export const ROW_H = 34;
const DOUBLE_MS = 320;
let lastTap = { id: '', at: 0 };

export interface RowProps {
  id: string;
  title: string;
  /** Second line (folder, hint) under the name. */
  sub?: string;
  /** The colour tag at the left. */
  color?: string;
  /** A glyph instead of the colour tag (folders, devices). */
  glyph?: string;
  /** Mono columns on the right (tempo, key). */
  cols?: { text: string; width: number }[];
  selected: boolean;
  indent?: number;
  onSelect: () => void;
  /** Double tap, Enter and the "+": load the item. Without it the row has no "+". */
  onActivate?: () => void;
  addLabel?: string;
  /** What a drag of this row carries. */
  drag?: DragPayload | null;
  /** Extra buttons, shown on the selected row only. */
  actions?: ReactNode;
  dim?: boolean;
}

export function BrowserRow({ id, title, sub, color, glyph, cols, selected, indent = 0, onSelect, onActivate, addLabel, drag, actions, dim }: RowProps) {
  const ref = useSampleDragSource(drag ?? null);
  const press = () => {
    if (sampleDragJustEnded()) return;
    const now = Date.now();
    const double = lastTap.id === id && now - lastTap.at < DOUBLE_MS;
    lastTap = { id, at: double ? 0 : now };
    onSelect();
    if (double) onActivate?.();
  };
  return (
    <View ref={ref} nativeID={rowDomId(id)} style={[s.row, selected && s.rowOn, dim && { opacity: 0.5 }, web({ userSelect: 'none', WebkitTouchCallout: 'none', cursor: drag ? 'grab' : 'default' })]}>
      {selected && <View style={s.bar} />}
      {/* Out of the tab order: the browser's own keys (arrows, Enter) move the selection, the highlight shows it (no focus ring). */}
      <Pressable focusable={false} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ selected }} onPress={press} style={[s.main, { paddingLeft: 8 + indent * 14 }, web({ outlineStyle: 'none' })]}>
        {glyph ? <Txt style={[s.glyph, color ? { color } : null]}>{glyph}</Txt> : <View style={[s.tag, { backgroundColor: color ?? C.dim }]} />}
        <View style={s.names}>
          <Txt numberOfLines={1} style={[s.title, selected && { color: C.accent }]}>
            {title}
          </Txt>
          {!!sub && (
            <Txt numberOfLines={1} style={s.sub}>
              {sub}
            </Txt>
          )}
        </View>
        {cols?.map((c, i) => (
          <Txt key={i} numberOfLines={1} style={[s.col, { width: c.width }]}>
            {c.text}
          </Txt>
        ))}
      </Pressable>
      {selected && actions}
      {onActivate && (
        <Pressable accessibilityLabel={addLabel ?? `${title} laden`} onPress={onActivate} hitSlop={4} style={[s.add, selected && s.addOn]}>
          <Plus size={12} color={selected ? C.accentInk : C.muted} />
        </Pressable>
      )}
    </View>
  );
}

/** A caption between groups of rows (KICKS, DYNAMIK …). */
export function GroupTitle({ children }: { children: string }) {
  return <Txt style={s.group}>{children.toUpperCase()}</Txt>;
}

/** A small text button on a selected row. */
export function RowAction({ label, onPress, accessibilityLabel, danger }: { label: string; onPress: () => void; accessibilityLabel?: string; danger?: boolean }) {
  return (
    <Pressable accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} hitSlop={4} style={s.action}>
      <Txt style={[s.actionText, danger && { color: C.danger }]}>{label}</Txt>
    </Pressable>
  );
}

export const browserStyles = StyleSheet.create({
  empty: { ...font(400), fontSize: 12, color: C.muted, paddingHorizontal: 10, paddingVertical: 14, lineHeight: 17 },
});

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: ROW_H, borderBottomWidth: 1, borderBottomColor: C.lineSoft, paddingRight: 6, gap: 4 },
  rowOn: { backgroundColor: 'rgba(198,255,61,0.08)' },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, backgroundColor: C.accent },
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: ROW_H, paddingVertical: 3 },
  tag: { width: 4, height: 16, borderRadius: 1 },
  glyph: { width: 14, textAlign: 'center', fontSize: 12, color: C.muted },
  names: { flex: 1, minWidth: 0 },
  title: { ...font(500), fontSize: 12.5 },
  sub: { ...font(400), fontSize: 10.5, color: C.muted, marginTop: 1 },
  col: { ...mono(), fontSize: 10.5, color: C.muted, textAlign: 'right' },
  add: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  addOn: { backgroundColor: C.accent, borderColor: C.accent },
  group: { ...font(700), fontSize: 9.5, letterSpacing: 1.4, color: C.dim, paddingHorizontal: 10, paddingTop: 12, paddingBottom: 4 },
  action: { height: 24, paddingHorizontal: 7, borderRadius: 5, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  actionText: { ...font(600), fontSize: 10.5, color: C.text },
});
