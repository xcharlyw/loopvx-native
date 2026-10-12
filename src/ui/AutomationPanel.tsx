import { useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { projectEndBars } from '../audio/timing';
import { C, font, mono } from '../constants/theme';
import { AUTO_GRID, AUTO_ORDER, AUTO_PARAMS, laneOf, ramp, setLane, throwAt, withPoint, withoutPoint } from '../lib/automation';
import { formatBarPosition } from '../audio/timing';
import { mapTrack } from '../lib/project';
import { discardLastHistory, recordHistory, updateProject, useStore } from '../lib/store';
import type { AutoParam, AutoPoint } from '../types';
import { web } from './drag';
import { Btn, Chip, Section, Txt } from './kit';
import { Sheet } from './Sheet';

const SPANS = [16, 32, 64, 128];
const HEIGHT = 160;
const PAD = 10;
const HIT = 18; // px: a touch this close to a point grabs it

/**
 * The automation of one track: pick a parameter, then draw its curve over the arrangement. A tap on an empty spot adds
 * a point, a touch near a point grabs it (drag to move, a tap selects it for the buttons below). The view shows a window
 * of bars; the buttons move and widen it, so the graph itself never has to scroll.
 */
export function AutomationPanel() {
  const track = useStore((st) => st.project.tracks.find((t) => t.id === st.selectedTrackId));
  const end = useStore((st) => projectEndBars(st.project));
  const [param, setParam] = useState<AutoParam>('filter');
  const [span, setSpan] = useState(32);
  const [start, setStart] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [width, setWidth] = useState(320);
  const drag = useRef<{ index: number; moved: boolean } | null>(null);

  if (!track) {
    return (
      <Sheet title="Automation">
        <Txt style={s.note}>Wähle im Arrangement eine Spur aus.</Txt>
      </Sheet>
    );
  }
  const trackId = track.id;
  const def = AUTO_PARAMS[param];
  const points = laneOf(track, param);
  const barAt = (x: number) => start + (Math.max(0, Math.min(width, x)) / width) * span;
  const xOf = (bar: number) => ((bar - start) / span) * width;
  const yOf = (v: number) => PAD + (1 - (v - def.min) / (def.max - def.min)) * (HEIGHT - 2 * PAD);
  const valueAt = (y: number) => def.min + (1 - (Math.max(PAD, Math.min(HEIGHT - PAD, y)) - PAD) / (HEIGHT - 2 * PAD)) * (def.max - def.min);
  const snapBar = (bar: number) => Math.max(0, Math.round(bar * 4) / 4);

  const write = (next: AutoPoint[], opts: { reschedule?: boolean; record?: boolean } = {}) => updateProject((p) => mapTrack(p, trackId, (t) => setLane(t, param, next)), opts);

  const nearest = (x: number, y: number): number => {
    let best = -1;
    let dist = HIT;
    points.forEach((p, i) => {
      const d = Math.hypot(xOf(p.bar) - x, yOf(p.value) - y);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return best;
  };
  const indexOfBar = (list: AutoPoint[], bar: number) => list.findIndex((p) => Math.abs(p.bar - bar) < AUTO_GRID / 2);

  const grant = (e: GestureResponderEvent) => {
    const { locationX: x, locationY: y } = e.nativeEvent;
    const hit = nearest(x, y);
    if (hit >= 0) {
      recordHistory();
      drag.current = { index: hit, moved: false };
      setSel(hit);
      return;
    }
    // An empty spot: a new point, which is also the one dragged until the finger lifts.
    recordHistory();
    const bar = snapBar(barAt(x));
    const next = withPoint(param, points, bar, valueAt(y));
    drag.current = { index: indexOfBar(next, bar), moved: true };
    setSel(drag.current.index);
    write(next, { reschedule: false, record: false });
  };
  const move = (e: GestureResponderEvent) => {
    const d = drag.current;
    if (!d) return;
    const { locationX: x, locationY: y } = e.nativeEvent;
    const bar = snapBar(barAt(x));
    // The point keeps its place in the order: it cannot be dragged past its neighbours.
    const lo = d.index > 0 ? points[d.index - 1].bar + AUTO_GRID : 0;
    const hi = d.index < points.length - 1 ? points[d.index + 1].bar - AUTO_GRID : Infinity;
    const at = Math.max(lo, Math.min(hi, bar));
    const rest = withoutPoint(points, d.index);
    const next = withPoint(param, rest, at, valueAt(y));
    d.moved = true;
    write(next, { reschedule: false, record: false });
    setSel(indexOfBar(next, at));
  };
  const release = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) discardLastHistory(); // a plain tap on a point: selected, nothing changed
    updateProject((p) => p, { record: false }); // hear it: reschedule the playing audio once
  };

  const nudge = (patch: { bar?: number; value?: number }) => {
    if (sel === null || !points[sel]) return;
    const p = points[sel];
    const lo = sel > 0 ? points[sel - 1].bar + AUTO_GRID : 0;
    const hi = sel < points.length - 1 ? points[sel + 1].bar - AUTO_GRID : Infinity;
    const bar = Math.max(lo, Math.min(hi, p.bar + (patch.bar ?? 0)));
    const next = withPoint(param, withoutPoint(points, sel), bar, p.value + (patch.value ?? 0));
    write(next);
    setSel(indexOfBar(next, bar));
  };
  const remove = () => {
    if (sel === null) return;
    write(withoutPoint(points, sel));
    setSel(null);
  };

  const to = start + span;
  const shape = (kind: 'up' | 'down' | 'throw' | 'clear') => {
    setSel(null);
    if (kind === 'clear') return write([]);
    const a = Math.floor(start);
    const b = Math.ceil(to);
    const keep = points.filter((p) => p.bar < a || p.bar > b);
    const made = kind === 'up' ? ramp(param, a, b, def.min, def.max) : kind === 'down' ? ramp(param, a, b, def.max, def.min) : throwAt(param, b, Math.min(8, b - a), def.max, def.rest);
    write([...keep, ...made].sort((p, q) => p.bar - q.bar));
  };

  const path = points
    .map((p, i) => `${i ? 'L' : 'M'} ${xOf(p.bar)} ${yOf(p.value)}`)
    .join(' ');
  // The curve is held before the first and after the last point.
  const heldFrom = points.length ? `M 0 ${yOf(points[0].value)} L ${xOf(points[0].bar)} ${yOf(points[0].value)}` : '';
  const last = points[points.length - 1];
  const heldTo = last ? `M ${xOf(last.bar)} ${yOf(last.value)} L ${width} ${yOf(last.value)}` : '';
  const gridStep = span <= 16 ? 1 : span <= 32 ? 2 : span <= 64 ? 4 : 8;
  const sp = sel !== null ? points[sel] : undefined;

  return (
    <Sheet title="Automation">
      <Txt style={s.note}>{`Spur „${track.name}“: Parameter wählen und die Kurve zeichnen.`}</Txt>
      <View style={s.chips}>
        {AUTO_ORDER.map((k) => (
          <Chip
            key={k}
            variant={param === k ? 'on' : 'ghost'}
            accessibilityLabel={`Parameter ${AUTO_PARAMS[k].label}`}
            onPress={() => {
              setParam(k);
              setSel(null);
            }}
          >
            {`${AUTO_PARAMS[k].label}${laneOf(track, k).length ? ' •' : ''}`}
          </Chip>
        ))}
      </View>

      <View style={s.viewBar}>
        <Btn small accessibilityLabel="Ausschnitt zurück" onPress={() => setStart((v) => Math.max(0, v - span / 2))}>
          ◀
        </Btn>
        {SPANS.map((n) => (
          <Chip key={n} variant={span === n ? 'on' : 'ghost'} textStyle={{ fontSize: 12 }} onPress={() => setSpan(n)}>
            {`${n}`}
          </Chip>
        ))}
        <Btn small accessibilityLabel="Ausschnitt vor" onPress={() => setStart((v) => (v + span / 2 < Math.max(end, span) ? v + span / 2 : v))}>
          ▶
        </Btn>
        <Txt style={s.range}>{`Takt ${Math.floor(start) + 1}–${Math.ceil(to)}`}</Txt>
      </View>

      <View
        accessibilityLabel="Automation-Kurve"
        onLayout={(e) => setWidth(Math.max(120, e.nativeEvent.layout.width))}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={grant}
        onResponderMove={move}
        onResponderRelease={release}
        onResponderTerminate={release}
        style={[s.graph, web({ userSelect: 'none', touchAction: 'none' })]}
      >
        <Svg width={width} height={HEIGHT} pointerEvents="none">
          <Rect x={0} y={0} width={width} height={HEIGHT} fill="#111114" />
          {Array.from({ length: Math.floor(span / gridStep) + 1 }, (_, i) => {
            const bar = Math.ceil(start / gridStep) * gridStep + i * gridStep;
            return xOf(bar) >= 0 && xOf(bar) <= width ? (
              <Line key={bar} x1={xOf(bar)} y1={0} x2={xOf(bar)} y2={HEIGHT} stroke="#1f1f24" strokeWidth={1} />
            ) : null;
          })}
          {Array.from({ length: Math.floor(span / gridStep) + 1 }, (_, i) => {
            const bar = Math.ceil(start / gridStep) * gridStep + i * gridStep;
            return xOf(bar) >= 0 && xOf(bar) < width - 14 ? (
              <SvgText key={`t${bar}`} x={xOf(bar) + 3} y={HEIGHT - 4} fill={C.dim} fontSize={8} fontFamily={mono().fontFamily}>
                {bar + 1}
              </SvgText>
            ) : null;
          })}
          <Line x1={0} y1={yOf(def.rest)} x2={width} y2={yOf(def.rest)} stroke="#2c2c33" strokeDasharray="4 4" strokeWidth={1} />
          {!points.length && (
            <SvgText x={width / 2} y={HEIGHT / 2} fill={C.dim} fontSize={11} textAnchor="middle">
              Tippe hier, um den ersten Punkt zu setzen
            </SvgText>
          )}
          {heldFrom !== '' && <Path d={heldFrom} stroke={C.accent} strokeOpacity={0.45} strokeWidth={2} strokeDasharray="3 3" fill="none" />}
          {heldTo !== '' && <Path d={heldTo} stroke={C.accent} strokeOpacity={0.45} strokeWidth={2} strokeDasharray="3 3" fill="none" />}
          {path !== '' && <Path d={path} stroke={C.accent} strokeWidth={2.2} fill="none" strokeLinejoin="round" />}
          {points.map((p, i) =>
            xOf(p.bar) >= -6 && xOf(p.bar) <= width + 6 ? <Circle key={i} cx={xOf(p.bar)} cy={yOf(p.value)} r={sel === i ? 7 : 5} fill={sel === i ? C.accent : C.bg} stroke={C.accent} strokeWidth={2} /> : null,
          )}
        </Svg>
      </View>
      <Txt style={s.legend}>{`${def.format(def.max)} oben · ${def.format(def.min)} unten · gestrichelt: ohne Automation${param === 'volume' ? ' · relativ zum Fader der Spur' : ''}`}</Txt>

      <Section title="Punkt" style={{ marginTop: 12 }}>
        {sp ? (
          <>
            <Txt style={s.note}>{`${formatBarPosition(sp.bar)} · ${def.format(sp.value)}`}</Txt>
            <View style={s.chips}>
              <Btn small accessibilityLabel="Punkt früher" onPress={() => nudge({ bar: -0.25 })}>
                ◀ ¼ Takt
              </Btn>
              <Btn small accessibilityLabel="Punkt später" onPress={() => nudge({ bar: 0.25 })}>
                ¼ Takt ▶
              </Btn>
              <Btn small accessibilityLabel="Wert höher" onPress={() => nudge({ value: (def.max - def.min) * 0.05 })}>
                ▲
              </Btn>
              <Btn small accessibilityLabel="Wert tiefer" onPress={() => nudge({ value: -(def.max - def.min) * 0.05 })}>
                ▼
              </Btn>
              <Btn small kind="danger" accessibilityLabel="Punkt löschen" onPress={remove}>
                Löschen
              </Btn>
            </View>
          </>
        ) : (
          <Txt style={s.note}>Tippe einen Punkt an, um ihn zu verschieben oder zu löschen. Ziehen geht direkt im Graph.</Txt>
        )}
      </Section>

      <Section title="Formen für den sichtbaren Ausschnitt" style={{ marginTop: 12 }}>
        <View style={s.chips}>
          <Btn small accessibilityLabel="Rampe auf" onPress={() => shape('up')}>
            Rampe ↗
          </Btn>
          <Btn small accessibilityLabel="Rampe ab" onPress={() => shape('down')}>
            Rampe ↘
          </Btn>
          <Btn small accessibilityLabel="Wurf" onPress={() => shape('throw')}>
            Anstieg, dann Reset
          </Btn>
          <Btn small kind="danger" accessibilityLabel="Kurve leeren" disabled={!points.length} onPress={() => shape('clear')}>
            Kurve löschen
          </Btn>
        </View>
        <Txt style={s.note}>Beispiele: Filter ↗ öffnet den Tiefpass bis zum Drop, Hall „Anstieg, dann Reset“ gibt den Hall-Wurf vor dem Drop, Lautstärke ↘ blendet aus.</Txt>
      </Section>
    </Sheet>
  );
}

const s = StyleSheet.create({
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  viewBar: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  range: { ...mono(), fontSize: 11, color: C.muted },
  graph: { height: HEIGHT, borderRadius: 10, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  legend: { ...font(400), fontSize: 10.5, color: C.dim, marginTop: 6 },
});
