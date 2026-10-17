import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, Path, RadialGradient, Stop } from 'react-native-svg';
import { C, cond, font, mono } from '../../constants/theme';
import { arcPath, dragToT, fillRange, modArc, polar, snapValue, tToDeg, tToValue, valueToT, type KnobCurve } from '../../lib/knobMath';
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
  /** 'synth' = the plugin skin: fixed 48-unit geometry, tick ring, shaded cap, white pointer, condensed label above the value. */
  skin?: 'synth';
  /** Modulation on this knob, as a signed part of the dial (-1..1): drawn as a ring from the knob's position (Serum's mod ring). */
  mod?: number;
}

/** Tick marks around a plugin knob (11, like a hardware pot). */
const TICKS = Array.from({ length: 11 }, (_, i) => tToDeg(i / 10));
const MOD_COLOR = '#f2f2f5';

/**
 * A rotary knob like the ones of a plugin synth: drag up or down to turn it (a long, calm travel for fine
 * control), double tap to reset. The arc shows the value; knobs around zero fill from 12 o'clock.
 */
export function Knob({ label, value, min, max, onChange, format, curve = 'linear', step, reset, size = 58, color = C.accent, width, skin, mod }: Props) {
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
  const k = size / 48;
  const synth = skin === 'synth';
  const r = synth ? 18 * k : c - 7;
  const fill = fillRange(t, min, max, curve);
  const tip = polar(c, c, synth ? 12.5 * k : r - 9, tToDeg(t));
  const base = polar(c, c, synth ? 6 * k : 6, tToDeg(t));
  const ring = mod ? modArc(t, mod) : null;
  const shown = format ? format(value) : String(Math.round(value * 100) / 100);
  const arcW = synth ? 3 : 4;
  return (
    <View style={[s.cell, width !== undefined && { width }]}>
      {synth && (
        <Txt numberOfLines={1} style={s.synthLabel}>
          {label}
        </Txt>
      )}
      <View {...pan} accessibilityRole="adjustable" accessibilityLabel={`${label} ${shown}`} style={[{ width: size, height: size }, web({ touchAction: 'none', cursor: 'ns-resize', userSelect: 'none' })]}>
        <Svg width={size} height={size} pointerEvents="none">
          {synth && (
            <Defs>
              <RadialGradient id="knob-cap" cx="0.4" cy="0.32" r="0.75">
                <Stop offset="0" stopColor="#3a3a43" />
                <Stop offset="0.55" stopColor="#202026" />
                <Stop offset="1" stopColor="#141418" />
              </RadialGradient>
            </Defs>
          )}
          {synth &&
            TICKS.map((deg, i) => {
              const a = polar(c, c, 21.2 * k, deg);
              const b = polar(c, c, 23 * k, deg);
              return <Line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={i === 0 || i === 10 || i === 5 ? '#5b5b66' : '#34343c'} strokeWidth={1} />;
            })}
          <Path d={arcPath(c, c, r, -135, 135)} stroke={synth ? '#24242b' : C.line} strokeWidth={arcW} strokeLinecap="round" fill="none" />
          {synth && fill.to - fill.from > 0.5 && <Path d={arcPath(c, c, r, fill.from, fill.to)} stroke={color} strokeWidth={arcW + 4} strokeLinecap="round" fill="none" opacity={active ? 0.28 : 0.16} />}
          {fill.to - fill.from > 0.5 && <Path d={arcPath(c, c, r, fill.from, fill.to)} stroke={color} strokeWidth={arcW} strokeLinecap="round" fill="none" opacity={active ? 1 : 0.9} />}
          {ring && <Path d={arcPath(c, c, 22 * k, ring.from, ring.to)} stroke={MOD_COLOR} strokeWidth={2.2 * k} strokeLinecap="round" fill="none" opacity={0.85} />}
          <Circle cx={c} cy={c} r={synth ? 14 * k : r - 5} fill={synth ? 'url(#knob-cap)' : active ? '#26262c' : C.panel2} stroke={active ? color : synth ? '#3a3a44' : '#2c2c33'} strokeWidth={synth ? 1 : 1.5} />
          {synth && <Circle cx={c} cy={c} r={10.5 * k} fill="none" stroke="#2a2a31" strokeWidth={1} />}
          <Line x1={base.x} y1={base.y} x2={tip.x} y2={tip.y} stroke={synth ? '#f4f4f7' : color} strokeWidth={synth ? 2.2 : 2.5} strokeLinecap="round" />
        </Svg>
      </View>
      <Txt numberOfLines={1} style={[s.value, active && { color }]}>
        {shown}
      </Txt>
      {!synth && (
        <Txt numberOfLines={1} style={s.label}>
          {label}
        </Txt>
      )}
    </View>
  );
}

/** Knobs in a row that wraps (four fit on a phone). */
export function KnobRow({ children }: { children: React.ReactNode }) {
  return <View style={s.row}>{children}</View>;
}

const s = StyleSheet.create({
  cell: { alignItems: 'center', width: 76, paddingVertical: 4 },
  value: { ...mono(), fontSize: 10.5, color: C.text, marginTop: 1 },
  label: { ...font(600), fontSize: 9.5, color: C.muted, letterSpacing: 0.8, marginTop: 1, textTransform: 'uppercase' },
  synthLabel: { ...cond(600), fontSize: 10.5, color: '#9a9aa4', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 0 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', marginTop: 6 },
});
