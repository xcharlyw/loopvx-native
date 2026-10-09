import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { C, font } from '../constants/theme';
import { engine } from '../audio/engine';
import { mapTrack } from '../lib/project';
import { updateProject, useStore } from '../lib/store';
import { Fader } from './Fader';
import { Mono, MsButton, Section, Txt } from './kit';
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
  const [master, setMaster] = useState(1);
  const level = useLevel();

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
      </Section>

      <ScrollView horizontal contentContainerStyle={s.mixer}>
        {project.tracks.map((t) => (
          <View key={t.id} style={s.strip}>
            <View style={[s.stripName, { borderTopColor: t.color }]}>
              <Txt numberOfLines={1} style={s.stripNameText}>
                {t.name}
              </Txt>
            </View>
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
});
