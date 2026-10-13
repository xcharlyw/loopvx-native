import { useRef } from 'react';
import { View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { C, mono } from '../constants/theme';
import { AUTO_GRID, drawStep, drawStroke, laneOf, paramDef, setLane, withPoint, withoutPoint } from '../lib/automation';
import { mapTrack } from '../lib/project';
import { discardLastHistory, recordHistory, updateProject, useStore } from '../lib/store';
import type { AutoParam, AutoPoint, Track } from '../types';
import { web } from './drag';

const PAD = 10;
const HIT = 18; // px: a touch this close to a point grabs it

/**
 * The curve of one parameter of one track, drawn and edited in place: used in the automation sheet (a window of bars) and
 * under the track in the arrangement (all bars, at the arrangement's zoom, like Ableton's automation lane). A tap on an
 * empty spot adds a point, a touch near a point grabs it (drag to move, a plain tap selects it, a double tap deletes it).
 * In draw mode (`drawMode`, B) a drag draws the line freehand over the bars it crosses (`drawStroke`).
 * `overlay`: drawn over a track's clips (automation mode), so the background stays see-through.
 */
export function AutomationCurve({ track, param, start, span, width, height, selected, onSelect, grid = 2, labels = true, overlay = false }: { track: Track; param: AutoParam; start: number; span: number; width: number; height: number; selected: number | null; onSelect: (i: number | null) => void; grid?: number; labels?: boolean; overlay?: boolean }) {
  const drawMode = useStore((st) => st.drawMode);
  const drag = useRef<{ index: number; moved: boolean } | null>(null);
  const stroke = useRef<{ base: AutoPoint[]; path: AutoPoint[] } | null>(null);
  const lastTap = useRef<{ index: number; at: number }>({ index: -1, at: 0 });
  const trackId = track.id;
  const def = paramDef(track, param);
  const points = laneOf(track, param);
  const barAt = (x: number) => start + (Math.max(0, Math.min(width, x)) / width) * span;
  const xOf = (bar: number) => ((bar - start) / span) * width;
  const yOf = (v: number) => PAD + (1 - (v - def.min) / (def.max - def.min)) * (height - 2 * PAD);
  const valueAt = (y: number) => def.min + (1 - (Math.max(PAD, Math.min(height - PAD, y)) - PAD) / (height - 2 * PAD)) * (def.max - def.min);
  const snapBar = (bar: number) => Math.max(0, Math.round(bar * 4) / 4);
  const write = (next: AutoPoint[], opts: { reschedule?: boolean; record?: boolean } = {}) => updateProject((p) => mapTrack(p, trackId, (t) => setLane(t, param, next)), opts);
  const indexOfBar = (list: AutoPoint[], bar: number) => list.findIndex((p) => Math.abs(p.bar - bar) < AUTO_GRID / 2);

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

  const step = drawStep(width / span);
  const grant = (e: GestureResponderEvent) => {
    const { locationX: x, locationY: y } = e.nativeEvent;
    recordHistory();
    if (drawMode) {
      stroke.current = { base: points, path: [{ bar: barAt(x), value: valueAt(y) }] };
      onSelect(null);
      write(drawStroke(param, points, stroke.current.path, step), { reschedule: false, record: false });
      return;
    }
    const hit = nearest(x, y);
    if (hit >= 0) {
      // A double tap on a point deletes it.
      const last = lastTap.current;
      lastTap.current = { index: hit, at: Date.now() };
      if (last.index === hit && Date.now() - last.at < 350) {
        lastTap.current = { index: -1, at: 0 };
        onSelect(null);
        write(withoutPoint(points, hit), { reschedule: false, record: false });
        drag.current = { index: -1, moved: true };
        return;
      }
      drag.current = { index: hit, moved: false };
      onSelect(hit);
      return;
    }
    // An empty spot: a new point, which is also the one dragged until the finger lifts.
    const bar = snapBar(barAt(x));
    const next = withPoint(param, points, bar, valueAt(y));
    drag.current = { index: indexOfBar(next, bar), moved: true };
    onSelect(drag.current.index);
    write(next, { reschedule: false, record: false });
  };
  const move = (e: GestureResponderEvent) => {
    const { locationX: x, locationY: y } = e.nativeEvent;
    const st = stroke.current;
    if (st) {
      st.path.push({ bar: barAt(x), value: valueAt(y) });
      write(drawStroke(param, st.base, st.path, step), { reschedule: false, record: false });
      return;
    }
    const d = drag.current;
    if (!d || d.index < 0) return;
    // The point keeps its place in the order: it cannot be dragged past its neighbours.
    const lo = d.index > 0 ? points[d.index - 1].bar + AUTO_GRID : 0;
    const hi = d.index < points.length - 1 ? points[d.index + 1].bar - AUTO_GRID : Infinity;
    const at = Math.max(lo, Math.min(hi, snapBar(barAt(x))));
    const next = withPoint(param, withoutPoint(points, d.index), at, valueAt(y));
    d.moved = true;
    write(next, { reschedule: false, record: false });
    onSelect(indexOfBar(next, at));
  };
  const release = () => {
    if (stroke.current) {
      stroke.current = null;
      updateProject((p) => p, { record: false });
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) discardLastHistory(); // a plain tap on a point: selected, nothing changed
    updateProject((p) => p, { record: false }); // hear it: reschedule the playing audio once
  };

  const path = points.map((p, i) => `${i ? 'L' : 'M'} ${xOf(p.bar)} ${yOf(p.value)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const heldFrom = first ? `M 0 ${yOf(first.value)} L ${xOf(first.bar)} ${yOf(first.value)}` : '';
  const heldTo = last ? `M ${xOf(last.bar)} ${yOf(last.value)} L ${width} ${yOf(last.value)}` : '';
  const gridStep = grid;
  const lines = Array.from({ length: Math.floor(span / gridStep) + 2 }, (_, i) => Math.ceil(start / gridStep) * gridStep + i * gridStep).filter((bar) => xOf(bar) >= 0 && xOf(bar) <= width);

  return (
    <View
      accessibilityLabel="Automation-Kurve"
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={grant}
      onResponderMove={move}
      onResponderRelease={release}
      onResponderTerminate={release}
      style={[{ width, height }, web({ userSelect: 'none', touchAction: 'none', cursor: drawMode ? 'crosshair' : 'default' })]}
    >
      <Svg width={width} height={height} pointerEvents="none">
        <Rect x={0} y={0} width={width} height={height} fill="#111114" fillOpacity={overlay ? 0.35 : labels ? 1 : 0.55} />
        {!overlay && lines.map((bar) => (
          <Line key={bar} x1={xOf(bar)} y1={0} x2={xOf(bar)} y2={height} stroke="#1f1f24" strokeWidth={1} />
        ))}
        {labels &&
          lines
            .filter((bar) => xOf(bar) < width - 14)
            .map((bar) => (
              <SvgText key={`t${bar}`} x={xOf(bar) + 3} y={height - 4} fill={C.dim} fontSize={8} fontFamily={mono().fontFamily}>
                {bar + 1}
              </SvgText>
            ))}
        <Line x1={0} y1={yOf(def.rest)} x2={width} y2={yOf(def.rest)} stroke="#2c2c33" strokeDasharray="4 4" strokeWidth={1} />
        {!points.length && !overlay && (
          <SvgText x={Math.min(width / 2, 170)} y={height / 2 + 4} fill={C.dim} fontSize={11} fontFamily={mono().fontFamily} textAnchor="middle">
            {drawMode ? 'Ziehe hier, um die Linie zu zeichnen' : 'Tippe hier, um den ersten Punkt zu setzen'}
          </SvgText>
        )}
        {heldFrom !== '' && <Path d={heldFrom} stroke={C.accent} strokeOpacity={0.45} strokeWidth={2} strokeDasharray="3 3" fill="none" />}
        {heldTo !== '' && <Path d={heldTo} stroke={C.accent} strokeOpacity={0.45} strokeWidth={2} strokeDasharray="3 3" fill="none" />}
        {path !== '' && <Path d={path} stroke={C.accent} strokeWidth={2.2} fill="none" strokeLinejoin="round" />}
        {points.map((p, i) => {
          const x = xOf(p.bar);
          if (x < -6 || x > width + 6) return null;
          // Drawn lines have many points: small dots there, like Ableton's breakpoints.
          const dense = (i > 0 && x - xOf(points[i - 1].bar) < 14) || (i < points.length - 1 && xOf(points[i + 1].bar) - x < 14);
          return <Circle key={i} cx={x} cy={yOf(p.value)} r={selected === i ? 7 : dense ? 2.5 : 5} fill={selected === i || dense ? C.accent : C.bg} stroke={C.accent} strokeWidth={dense && selected !== i ? 0 : 2} />;
        })}
        {overlay && (
          <SvgText x={6} y={11} fill={C.accent} fillOpacity={0.8} fontSize={9} fontFamily={mono().fontFamily}>
            {def.label}
          </SvgText>
        )}
      </Svg>
    </View>
  );
}
