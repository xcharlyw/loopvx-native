import { useRef, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { C, font, mono } from '../constants/theme';
import { Txt } from './kit';

// The plugin look shared by the mixer and the device cards: brushed dark panels with a lit top edge, recessed LCD read-outs
// and segmented LED meters, like a hardware console or a good VST.

export const SKIN = {
  panelTop: '#222226',
  panelBottom: '#17171a',
  edge: '#303036',
  highlight: 'rgba(255,255,255,0.07)',
  lcd: '#0a0f05',
  lcdEdge: '#1d2612',
  lcdText: '#c6ff3d',
  slot: '#050507',
  yellow: '#ffd23d',
  red: '#ff4d3d',
  solo: '#3dc8ff',
} as const;

/** A panel with a vertical gradient and a 1 px highlight on its top edge. */
export function PluginFrame({ children, style, radius = 4 }: { children: ReactNode; style?: StyleProp<ViewStyle>; radius?: number }) {
  return (
    <View style={[{ borderRadius: radius, borderWidth: 1, borderColor: SKIN.edge, overflow: 'hidden' }, style]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
        <Defs>
          <LinearGradient id="plugin-frame" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={SKIN.panelTop} />
            <Stop offset="1" stopColor={SKIN.panelBottom} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#plugin-frame)" />
      </Svg>
      <View pointerEvents="none" style={[s.highlight, { borderTopLeftRadius: radius, borderTopRightRadius: radius }]} />
      {children}
    </View>
  );
}

/** A recessed green-on-black read-out. */
export function Lcd({ children, style, textStyle }: { children: ReactNode; style?: StyleProp<ViewStyle>; textStyle?: StyleProp<TextStyle> }) {
  return (
    <View style={[s.lcd, style]}>
      <Txt numberOfLines={1} style={[s.lcdText, textStyle]}>
        {children}
      </Txt>
    </View>
  );
}

export const gainToDb = (g: number) => (g <= 0.00001 ? -Infinity : 20 * Math.log10(g));

/** dB range of the LED ladder, bottom to top. */
const LED_MIN = -48;
const LED_MAX = 3;

/** Which LED segments are lit for a peak level (linear), and the colour of each: green, yellow from -6 dB, red above 0 dB. */
export function ledSegments(level: number, count: number): { on: boolean; color: string }[] {
  const db = gainToDb(level);
  return Array.from({ length: count }, (_, i) => {
    const at = LED_MIN + ((i + 1) / count) * (LED_MAX - LED_MIN);
    return { on: db >= at - (LED_MAX - LED_MIN) / count / 2, color: at > 0 ? SKIN.red : at > -6 ? SKIN.yellow : C.accent };
  });
}

/** A vertical LED ladder with a peak hold that falls after a second. */
export function LedMeter({ level, height, width = 7, count = 22 }: { level: number; height: number; width?: number; count?: number }) {
  const hold = useRef({ peak: 0, at: 0 });
  const now = Date.now();
  if (level >= hold.current.peak || now - hold.current.at > 1200) hold.current = { peak: level, at: now };
  const segs = ledSegments(level, count);
  const peakIndex = ledSegments(hold.current.peak, count).reduce((last, sg, i) => (sg.on ? i : last), -1);
  const gap = 1.5;
  const segH = (height - gap * (count - 1)) / count;
  return (
    <View style={{ width, height, flexDirection: 'column-reverse', gap }}>
      {segs.map((sg, i) => (
        <View key={i} style={{ height: segH, borderRadius: 1, backgroundColor: sg.color, opacity: sg.on || i === peakIndex ? 1 : 0.13 }} />
      ))}
    </View>
  );
}

/** dB marks next to a fader whose value is linear gain 0..max (Live's mixer scale). */
export function FaderScale({ max, height, marks = [6, 0, -6, -12, -24] }: { max: number; height: number; marks?: number[] }) {
  return (
    <View style={{ width: 18, height }}>
      {marks
        .map((db) => ({ db, g: Math.pow(10, db / 20) }))
        .filter((m) => m.g <= max)
        .map((m) => (
          <Txt key={m.db} style={[s.mark, { top: (1 - m.g / max) * (height - 16) + 8 - 6 }]}>
            {m.db > 0 ? `+${m.db}` : String(m.db)}
          </Txt>
        ))}
    </View>
  );
}

const s = StyleSheet.create({
  highlight: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: SKIN.highlight },
  lcd: { backgroundColor: SKIN.lcd, borderWidth: 1, borderColor: SKIN.lcdEdge, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3, alignSelf: 'stretch' },
  lcdText: { ...mono(500), fontSize: 11, color: SKIN.lcdText, textAlign: 'center', textShadowColor: 'rgba(198,255,61,0.55)', textShadowRadius: 6 },
  mark: { position: 'absolute', right: 0, ...font(500), fontSize: 8, color: C.dim },
});
