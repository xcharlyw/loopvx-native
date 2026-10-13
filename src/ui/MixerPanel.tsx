import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { C, font } from '../constants/theme';
import { engine } from '../audio/engine';
import { mapTrack } from '../lib/project';
import { setMetronome, setState, updateProject, useStore } from '../lib/store';
import { Fader } from './Fader';
import { Metronome } from './icons';
import { Chip, Mono, MsButton, Section, Txt } from './kit';
import { Sheet } from './Sheet';

function useLevel(): number {
  const [level, setLevel] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    let raf = 0;
    const data = new Float32Array(1024);
    const loop = () => {
      const a = engine.analyser;
      if (a) {
        a.getFloatTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v));
        const next = Math.max(peak, last.current * 0.9);
        if (Math.abs(next - last.current) > 0.002) setLevel(next);
        last.current = next;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return level;
}

/** Peaks of every track, smoothed like the master meter (falls back slowly). */
function useTrackLevels(ids: string[]): Record<string, number> {
  const [levels, setLevels] = useState<Record<string, number>>({});
  const last = useRef<Record<string, number>>({});
  const key = ids.join(',');
  useEffect(() => {
    let raf = 0;
    let frame = 0;
    const loop = () => {
      // Every third frame is plenty for a meter and keeps re-renders down.
      if (++frame % 3 === 0) {
        const next: Record<string, number> = {};
        let changed = false;
        for (const id of key ? key.split(',') : []) {
          const v = Math.max(engine.trackPeak(id), (last.current[id] ?? 0) * 0.85);
          next[id] = v < 0.002 ? 0 : v;
          if (Math.abs(next[id] - (last.current[id] ?? 0)) > 0.004) changed = true;
        }
        last.current = next;
        if (changed) setLevels(next);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [key]);
  return levels;
}

/** A thin vertical meter next to a track's fader. */
function StripMeter({ level, height }: { level: number; height: number }) {
  const h = Math.min(1, level) * height;
  return (
    <View style={[s.stripMeter, { height }]}>
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: h, backgroundColor: level >= 0.99 ? C.danger : level > 0.7 ? '#ffd23d' : C.accent }} />
    </View>
  );
}

const toDb = (g: number) => (g <= 0.0001 ? '-∞' : `${(20 * Math.log10(g)).toFixed(1)} dB`);

/** `.meter`: gradient from accent through yellow to red, revealed up to the level. */
function Meter({ level }: { level: number }) {
  const [w, setW] = useState(0);
  return (
    <View style={s.meter} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <View style={{ width: `${Math.min(100, level * 100)}%`, height: '100%', overflow: 'hidden' }}>
        {w > 0 && (
          <Svg width={w} height={8}>
            <Defs>
              <LinearGradient id="m" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={C.accent} />
                <Stop offset="0.8" stopColor="#ffd23d" />
                <Stop offset="1" stopColor="#ff5a36" />
              </LinearGradient>
            </Defs>
            <Rect width={w} height={8} fill="url(#m)" />
          </Svg>
        )}
      </View>
    </View>
  );
}

export function MixerPanel() {
  const project = useStore((st) => st.project);
  const metronome = useStore((st) => st.metronome);
  const [master, setMaster] = useState(1);
  const level = useLevel();
  const trackLevels = useTrackLevels(project.tracks.map((t) => t.id));
  const masterFx = project.master?.devices?.length ?? 0;

  return (
    <Sheet title="Mixer">
      <Section title="Master">
        <Meter level={level} />
        <View style={[s.row, { marginTop: 10 }]}>
          <Fader
            value={master}
            max={1.2}
            onChange={(v) => {
              setMaster(v);
              engine.setMasterVolume(v);
            }}
          />
          <Mono style={s.db}>{toDb(master)}</Mono>
        </View>
        {level >= 0.99 && <Txt style={s.clip}>Clipping! Spuren leiser machen.</Txt>}
        <View style={[s.row, { marginTop: 10 }]}>
          <Chip variant={masterFx ? 'on' : 'ghost'} accessibilityLabel="Master-Geräte" onPress={() => setState({ devicesFor: 'master', panel: 'devices' })} textStyle={{ fontSize: 12 }}>
            {masterFx ? `Master-FX ${masterFx}` : 'Master-FX +'}
          </Chip>
          <Txt style={s.noteInline}>EQ, Kompressor oder Limiter auf der Summe aller Spuren.</Txt>
        </View>
        <View style={[s.row, { marginTop: 12 }]}>
          <Chip variant={metronome ? 'on' : 'ghost'} onPress={() => setMetronome(!metronome)}>
            <Metronome size={14} color={metronome ? C.accentInk : C.text} />
            {metronome ? 'Metronom an' : 'Metronom aus'}
          </Chip>
        </View>
      </Section>

      <ScrollView horizontal contentContainerStyle={s.mixer}>
        {project.tracks.map((t) => (
          <View key={t.id} style={s.strip}>
            <View style={[s.stripName, { borderTopColor: t.color }]}>
              <Txt numberOfLines={1} style={s.stripNameText}>
                {t.name}
              </Txt>
            </View>
            <View style={s.faderRow}>
            <Fader
              vertical
              length={160}
              thumbSize={16}
              thickness={8}
              thumbColor={C.accent}
              fillColor={C.accent}
              trackColor="#3b3b3b"
              trackBorderColor="#858585"
              value={t.volume}
              max={1.5}
              onChange={(v) => updateProject((p) => mapTrack(p, t.id, (x) => ({ ...x, volume: v })), { reschedule: false })}
            />
            <StripMeter level={trackLevels[t.id] ?? 0} height={160} />
            </View>
            <Mono style={s.stripDb}>{toDb(t.volume)}</Mono>
            <View style={s.msRow}>
              <MsButton
                label="M"
                on={t.muted}
                onPress={() => updateProject((p) => mapTrack(p, t.id, (x) => ({ ...x, muted: !x.muted })), { reschedule: false })}
              />
              <MsButton
                label="S"
                on={t.solo}
                onPress={() => updateProject((p) => mapTrack(p, t.id, (x) => ({ ...x, solo: !x.solo })), { reschedule: false })}
              />
            </View>
            <Chip variant={t.devices?.length ? 'on' : 'ghost'} onPress={() => setState({ selectedTrackId: t.id, devicesFor: 'track', panel: 'devices' })} textStyle={{ fontSize: 11 }}>
              {t.devices?.length ? `FX ${t.devices.length}` : 'FX +'}
            </Chip>
          </View>
        ))}
      </ScrollView>
      <Txt style={s.note}>Startwerte für Hard Techno: Kick + Bass 0 dB, Top Loop −6 dB, Vocals −6 dB, Synth −9 dB.</Txt>
    </Sheet>
  );
}

const s = StyleSheet.create({
  meter: { height: 8, borderRadius: 4, backgroundColor: C.line, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  db: { width: 64, textAlign: 'right', color: C.muted },
  clip: { color: C.danger, fontSize: 12, marginTop: 8 },
  mixer: { gap: 10, paddingBottom: 6 },
  strip: {
    width: 88,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 8,
  },
  stripName: { alignSelf: 'stretch', borderTopWidth: 3, paddingTop: 6 },
  stripNameText: { ...font(600), fontSize: 11, textAlign: 'center' },
  stripDb: { fontSize: 11, color: C.muted },
  msRow: { flexDirection: 'row', gap: 4 },
  note: { color: C.muted, fontSize: 12, marginTop: 12, lineHeight: 17 },
  noteInline: { color: C.muted, fontSize: 11, flex: 1 },
  faderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stripMeter: { width: 5, borderRadius: 3, backgroundColor: C.line, overflow: 'hidden' },
});
