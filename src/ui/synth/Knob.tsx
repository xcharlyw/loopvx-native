import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { C, font, mono } from '../../constants/theme';
import { arcPath, dragToT, fillRange, polar, snapValue, tToDeg, tToValue, valueToT, type KnobCurve } from '../../lib/knobMath';
import { useDrag, web } from '../drag';
import { Txt } from '../kit';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  /** The text under the knob. */
  format?: (v: number) => string;
  curve?: KnobCurve;
  step?: number;
  /** Double tap resets to this. */
  reset?: number;
  size?: number;
  color?: string;
  /** Width of the cell (default 76); small knobs side by side in a mixer strip need less. */
  width?: number;
}

/**
 * A rotary knob like the ones of a plugin synth: drag up or down to turn it (a long, calm travel for fine
 * control), double tap to reset. The arc shows the value; knobs around zero fill from 12 o'clock.
 */
export function Knob({ label, value, min, max, onChange, format, curve = 'linear', step, reset, size = 58, color = C.accent, width }: Props) {
  const [active, setActive] = useState(false);
  const gesture = useRef<{ t0: number; moved: boolean } | null>(null);
  const lastEmit = useRef<number | null>(null);
  const lastTap = useRef(0);
  const latest = useRef({ value, min, max, curve, step, reset, onChange });
  latest.current = { value, min, max, curve, step, reset, onChange };

  const pan = useDrag('start', true, (_dx, dy, phase) => {
    const l = latest.current;
    if (phase === 'move') {
      gesture.current ??= { t0: valueToT(l.value, l.min, l.max, l.curve), moved: false };
      if (Math.abs(dy) > 3) gesture.current.moved = true;
      if (!gesture.current.moved) return;
      setActive(true);
      const next = snapValue(tToValue(dragToT(gesture.current.t0, dy), l.min, l.max, l.curve), l.min, l.max, l.step);
      if (next !== lastEmit.current) {
        lastEmit.current = next;
        l.onChange(next);
      }
      return;
    }
    const g = gesture.current;
    gesture.current = null;
    lastEmit.current = null;
    setActive(false);
    if (phase === 'end' && (!g || !g.moved)) {
      const now = Date.now();
      if (l.reset !== undefined && now - lastTap.current < 350) l.onChange(l.reset);
      lastTap.current = now;
    }
  });

  const t = valueToT(value, min, max, curve);
  const c = size / 2;
  const r = c - 7;
  const fill = fillRange(t, min, max, curve);
  const tip = polar(c, c, r - 9, tToDeg(t));
  const base = polar(c, c, 6, tToDeg(t));
  return (
    <View style={[s.cell, width !== undefined && { width }]}>
      <View {...pan} accessibilityRole="adjustable" accessibilityLabel={`${label} ${format ? format(value) : value}`} style={[{ width: size, height: size }, web({ touchAction: 'none', cursor: 'ns-resize', userSelect: 'none' })]}>
        <Svg width={size} height={size} pointerEvents="none">
          <Path d={arcPath(c, c, r, -135, 135)} stroke={C.line} strokeWidth={4} strokeLinecap="round" fill="none" />
          {fill.to - fill.from > 0.5 && <Path d={arcPath(c, c, r, fill.from, fill.to)} stroke={color} strokeWidth={4} strokeLinecap="round" fill="none" opacity={active ? 1 : 0.9} />}
          <Circle cx={c} cy={c} r={r - 5} fill={active ? '#26262c' : C.panel2} stroke={active ? color : '#2c2c33'} strokeWidth={1.5} />
          <Line x1={base.x} y1={base.y} x2={tip.x} y2={tip.y} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
        </Svg>
      </View>
      <Txt numberOfLines={1} style={[s.value, active && { color }]}>
        {format ? format(value) : String(Math.round(value * 100) / 100)}
      </Txt>
      <Txt numberOfLines={1} style={s.label}>
        {label}
      </Txt>
    </View>
  );
}

/** Knobs in a row that wraps (four fit on a phone). */
export function KnobRow({ children }: { children: React.ReactNode }) {
  return <View style={s.row}>{children}</View>;
}

const s = StyleSheet.create({
  cell: { alignItems: 'center', width: 76, paddingVertical: 4 },
  value: { ...mono(), fontSize: 11, color: C.text, marginTop: 2 },
  label: { ...font(600), fontSize: 9.5, color: C.muted, letterSpacing: 0.8, marginTop: 1, textTransform: 'uppercase' },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', marginTop: 6 },
});
