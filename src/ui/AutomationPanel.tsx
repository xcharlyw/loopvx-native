import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { projectEndBars } from '../audio/timing';
import { C, font, mono } from '../constants/theme';
import { AUTO_GRID, AUTO_ORDER, AUTO_PARAMS, copyAutomation, copyRange, deviceAutoParams, laneOf, paramDef, ramp, setLane, throwAt, withPoint, withoutPoint } from '../lib/automation';
import { formatBarPosition } from '../audio/timing';
import { mapTrack } from '../lib/project';
import { setState, toast, updateProject, useStore } from '../lib/store';
import type { AutoParam, AutoPoint } from '../types';
import { AutomationCurve } from './AutomationCurve';
import { Btn, Chip, Section, Txt } from './kit';
import { Sheet } from './Sheet';

const SPANS = [16, 32, 64, 128];
const HEIGHT = 160;

/**
 * The automation of one track: pick a parameter, then draw its curve over the arrangement. A tap on an empty spot adds
 * a point, a touch near a point grabs it (drag to move, a tap selects it for the buttons below). The view shows a window
 * of bars; the buttons move and widen it, so the graph itself never has to scroll.
 */
export function AutomationPanel() {
  const track = useStore((st) => st.project.tracks.find((t) => t.id === st.selectedTrackId));
  const end = useStore((st) => projectEndBars(st.project));
  const drawMode = useStore((st) => st.drawMode);
  const allTracks = useStore((st) => st.project.tracks);
  const [param, setParam] = useState<AutoParam>('filter');
  const [span, setSpan] = useState(32);
  const [start, setStart] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [width, setWidth] = useState(320);
  if (!track) {
    return (
      <Sheet title="Automation">
        <Txt style={s.note}>Wähle im Arrangement eine Spur aus.</Txt>
      </Sheet>
    );
  }
  const trackId = track.id;
  const def = paramDef(track, param);
  const points = laneOf(track, param);
  const write = (next: AutoPoint[], opts: { reschedule?: boolean; record?: boolean } = {}) => updateProject((p) => mapTrack(p, trackId, (t) => setLane(t, param, next)), opts);
  const others = allTracks.filter((t) => t.id !== trackId);
  const repeatWindow = () => {
    const next = copyRange(points, start, start + span, start + span);
    if (next === points) return;
    write(next);
    toast(`Takt ${start + 1}–${start + span} nach Takt ${start + span + 1}–${start + 2 * span} kopiert.`);
    setStart(start + span);
  };
  const copyTo = (toId: string, name: string) => {
    const target = allTracks.find((t) => t.id === toId);
    if (!target) return;
    const r = copyAutomation(track, target);
    if (!r.copied) {
      toast(track.automation?.length ? `Keine Kurve passte auf „${name}“ (ihr fehlen die Geräte).` : 'Diese Spur hat noch keine Automation.');
      return;
    }
    updateProject((p) => mapTrack(p, toId, () => r.track), { reschedule: false });
    toast(`${r.copied} Kurve${r.copied === 1 ? '' : 'n'} auf „${name}“ kopiert${r.skipped ? `, ${r.skipped} ohne passendes Gerät übersprungen` : ''}.`);
  };
  const indexOfBar = (list: AutoPoint[], bar: number) => list.findIndex((p) => Math.abs(p.bar - bar) < AUTO_GRID / 2);

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
      {deviceAutoParams(track).length > 0 && (
        <>
          <Txt style={s.note}>Regler der Geräte dieser Spur:</Txt>
          <View style={s.chips}>
            {deviceAutoParams(track).map((d) => (
              <Chip
                key={d.param}
                variant={param === d.param ? 'on' : 'ghost'}
                accessibilityLabel={`Parameter ${d.label}`}
                textStyle={{ fontSize: 12 }}
                onPress={() => {
                  setParam(d.param);
                  setSel(null);
                }}
              >
                {`${d.label}${laneOf(track, d.param).length ? ' •' : ''}`}
              </Chip>
            ))}
          </View>
        </>
      )}

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
        <Chip variant={drawMode ? 'on' : 'ghost'} accessibilityLabel="Zeichenmodus" textStyle={{ fontSize: 12 }} onPress={() => setState({ drawMode: !drawMode })}>
          ✎ Zeichnen
        </Chip>
      </View>

      <View onLayout={(e) => setWidth(Math.max(120, e.nativeEvent.layout.width))} style={s.graph}>
        <AutomationCurve track={track} param={param} start={start} span={span} width={width} height={HEIGHT} selected={sel} onSelect={setSel} grid={span <= 16 ? 1 : span <= 32 ? 2 : span <= 64 ? 4 : 8} />
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
          <Txt style={s.note}>{drawMode ? 'Zeichenmodus: ziehe im Graph, um die Linie frei zu zeichnen (B schaltet um).' : 'Tippe einen Punkt an, um ihn zu verschieben, Doppeltipp löscht ihn. Mit ✎ Zeichnen (B) malst du die Linie frei.'}</Txt>
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

      <Section title="Kopieren" style={{ marginTop: 12 }}>
        <View style={s.chips}>
          <Btn small accessibilityLabel="Ausschnitt danach wiederholen" disabled={!points.length} onPress={repeatWindow}>
            {`Ausschnitt Takt ${start + 1}–${start + span} danach wiederholen`}
          </Btn>
        </View>
        {others.length > 0 && (
          <>
            <Txt style={s.note}>Alle Kurven dieser Spur auf eine andere Spur kopieren (Geräte-Kurven gehen an das gleiche Gerät der Zielspur):</Txt>
            <View style={s.chips}>
              {others.map((t) => (
                <Chip key={t.id} onPress={() => copyTo(t.id, t.name)} textStyle={{ fontSize: 12 }} accessibilityLabel={`Kurven auf ${t.name} kopieren`}>
                  {t.name}
                </Chip>
              ))}
            </View>
          </>
        )}
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
