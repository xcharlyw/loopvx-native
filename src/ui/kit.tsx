import { Children, Fragment, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { C, RADIUS, font, mono } from '../constants/theme';

/** Base text: the original's body font (Inter 14px, --text). RN text doesn't inherit, so use this everywhere. */
export function Txt({ style, ...rest }: TextProps) {
  return <Text {...rest} style={[s.txt, style]} />;
}

export function Mono({ style, ...rest }: TextProps) {
  return <Text {...rest} style={[s.txt, s.mono, style]} />;
}

/** `.pill`: 36px rounded container. */
export function Pill({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  if (onPress) {
    return (
      <Pressable style={[s.pill, style]} onPress={onPress} accessibilityLabel={accessibilityLabel}>
        {children}
      </Pressable>
    );
  }
  return <View style={[s.pill, style]}>{children}</View>;
}

/** `.pill-group`: a pill holding icon buttons, separated by 1px lines. */
export function PillGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={[s.pillGroup, style]}>
      {items.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <View style={s.groupLine} />}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

/** `.icon-btn`; `on` tints the content with the accent (pass the colour to icons via `iconColor`). */
export function IconBtn({ children, style, ...rest }: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable {...rest} style={[s.iconBtn, rest.disabled && s.disabled, style]}>
      {children}
    </Pressable>
  );
}

export const iconColor = (on?: boolean) => (on ? C.accent : C.text);

type BtnKind = 'default' | 'primary' | 'danger';

/** `.btn` / `.btn.small` / `.btn.primary`. */
export function Btn({
  children,
  kind = 'default',
  small,
  style,
  textStyle,
  ...rest
}: PressableProps & { children: ReactNode; kind?: BtnKind; small?: boolean; style?: StyleProp<ViewStyle>; textStyle?: StyleProp<TextStyle> }) {
  const color = kind === 'primary' ? C.accentInk : kind === 'danger' ? C.danger : C.text;
  return (
    <Pressable {...rest} style={[s.btn, small && s.btnSmall, kind === 'primary' && s.btnPrimary, rest.disabled && s.disabled, style]}>
      {Children.map(children, (c) =>
        typeof c === 'string' || typeof c === 'number' ? (
          <Txt style={[{ color }, small && s.smallText, kind === 'primary' && font(600), textStyle]}>{c}</Txt>
        ) : (
          c
        ),
      )}
    </Pressable>
  );
}

/** `.chip` (white), `.chip.ghost`, `.chip.on`. */
export function Chip({
  children,
  variant = 'ghost',
  onPress,
  style,
  textStyle,
}: {
  children: ReactNode;
  variant?: 'solid' | 'ghost' | 'on';
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const color = variant === 'solid' ? '#111' : variant === 'on' ? C.accentInk : C.text;
  const body = Children.map(children, (c) =>
    typeof c === 'string' || typeof c === 'number' ? (
      <Txt numberOfLines={1} style={[s.chipText, { color }, variant === 'ghost' && font(500), textStyle]}>
        {c}
      </Txt>
    ) : (
      c
    ),
  );
  const st = [s.chip, variant === 'ghost' && s.chipGhost, variant === 'on' && s.chipOn, style];
  return onPress ? (
    <Pressable style={st} onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    <View style={st}>{body}</View>
  );
}

/** `.section` with its `h3`. */
export function Section({ title, children, style }: { title: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.section, style]}>
      <Txt style={s.h3}>{title}</Txt>
      {children}
    </View>
  );
}

/** `.ms.mute` / `.ms.solo`. */
export function MsButton({ label, on, onPress }: { label: 'M' | 'S'; on: boolean; onPress: () => void }) {
  const onColor = label === 'M' ? C.mute : C.accent;
  return (
    <Pressable style={[s.ms, on && { backgroundColor: onColor, borderColor: onColor }]} onPress={onPress}>
      <Txt style={[s.msText, on && { color: '#111' }]}>{label}</Txt>
    </Pressable>
  );
}

export function Spacer() {
  return <View style={{ flex: 1 }} />;
}

const s = StyleSheet.create({
  txt: { ...font(400), fontSize: 14, color: C.text },
  mono: { ...mono(), fontSize: 13, letterSpacing: 0.26 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
  },
  pillGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    borderRadius: 999,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    overflow: 'hidden',
  },
  groupLine: { width: 1, alignSelf: 'stretch', backgroundColor: C.line },
  iconBtn: { minWidth: 36, height: 34, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: C.panel2,
    borderWidth: 1,
    borderColor: C.line,
  },
  btnSmall: { height: 28, paddingHorizontal: 10 },
  btnPrimary: { backgroundColor: C.accent, borderColor: C.accent },
  smallText: { fontSize: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: C.text,
    flexShrink: 0,
  },
  chipGhost: { backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line },
  chipOn: { backgroundColor: C.accent },
  chipText: { fontSize: 13, ...font(600) },
  section: {
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: RADIUS,
    padding: 12,
    marginBottom: 12,
  },
  h3: { fontSize: 13, color: C.muted, ...font(600), marginBottom: 8 },
  ms: {
    width: 24,
    height: 22,
    borderRadius: 6,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  msText: { fontSize: 11, ...font(700), color: C.muted },
});
