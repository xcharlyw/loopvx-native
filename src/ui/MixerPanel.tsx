import Slider from '@react-native-community/slider';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors, Spacing } from '../constants/theme';
import { engine } from '../audio/engine';
import { mapTrack } from '../lib/project';
import { setState, updateProject, useStore } from '../lib/store';

function useLevel(): number {
  const [level, setLevel] = useState(0);
  const levelRef = useRef(0);
  useEffect(() => {
    let raf = 0;
    const data = new Float32Array(1024);
    const loop = () => {
      const a = engine.analyser;
      if (a) {
        a.getFloatTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v));
        levelRef.current = Math.max(peak, levelRef.current * 0.9);
        setLevel(levelRef.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return level;
}

const toDb = (g: number) => (g <= 0.0001 ? '-∞' : `${(20 * Math.log10(g)).toFixed(1)} dB`);

export function MixerPanel() {
  const project = useStore((s) => s.project);
  const [master, setMaster] = useState(1);
  const level = useLevel();

  return (
    <View style={styles.sheet}>
      <View style={styles.head}>
        <Text style={styles.title}>Mixer</Text>
        <Pressable onPress={() => setState({ panel: 'none' })}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.sectionTitle}>Master</Text>
        <View style={styles.meter}>
          <View style={[styles.meterFill, { width: `${Math.min(100, level * 100)}%` }]} />
        </View>
        <View style={styles.row}>
          <Slider
            style={styles.masterFader}
            minimumValue={0}
            maximumValue={1.2}
            value={master}
            onValueChange={(v) => {
              setMaster(v);
              engine.setMasterVolume(v);
            }}
            minimumTrackTintColor={Colors.accent}
            maximumTrackTintColor={Colors.border}
          />
          <Text style={styles.db}>{toDb(master)}</Text>
        </View>
        {level >= 0.99 && <Text style={styles.danger}>Clipping! Spuren leiser machen.</Text>}

        <View style={styles.strips}>
          {project.tracks.map((t) => (
            <View key={t.id} style={styles.strip}>
              <View style={[styles.stripName, { borderTopColor: t.color }]}>
                <Text style={styles.stripNameText} numberOfLines={1}>
                  {t.name}
                </Text>
              </View>
              <Slider
                style={styles.fader}
                minimumValue={0}
                maximumValue={1.5}
                value={t.volume}
                onValueChange={(v) => updateProject((p) => mapTrack(p, t.id, (x) => ({ ...x, volume: v })), { reschedule: false })}
                minimumTrackTintColor={t.color}
                maximumTrackTintColor={Colors.border}
              />
              <Text style={styles.stripDb}>{toDb(t.volume)}</Text>
              <View style={styles.msRow}>
                <Pressable
                  style={[styles.ms, t.muted && styles.msOn]}
                  onPress={() => updateProject((p) => mapTrack(p, t.id, (x) => ({ ...x, muted: !x.muted })), { reschedule: false })}
                >
                  <Text style={styles.msText}>M</Text>
                </Pressable>
                <Pressable
                  style={[styles.ms, t.solo && styles.msOn]}
                  onPress={() => updateProject((p) => mapTrack(p, t.id, (x) => ({ ...x, solo: !x.solo })), { reschedule: false })}
                >
                  <Text style={styles.msText}>S</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.footnote}>
          Startwerte für Hard Techno: Kick + Bass 0 dB, Top Loop −6 dB, Vocals −6 dB, Synth −9 dB.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.surface },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.three, borderBottomWidth: 1, borderBottomColor: Colors.border },
  title: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  close: { color: Colors.textSecondary, fontSize: 18 },
  body: { padding: Spacing.three, gap: Spacing.two },
  sectionTitle: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  meter: { height: 6, borderRadius: 3, backgroundColor: Colors.surfaceRaised, overflow: 'hidden' },
  meterFill: { height: '100%', backgroundColor: Colors.accent },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  masterFader: { flex: 1, height: 36 },
  db: { color: Colors.textSecondary, fontSize: 12, fontFamily: 'monospace', width: 64, textAlign: 'right' },
  danger: { color: Colors.danger, fontSize: 12 },
  strips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  strip: { width: 110, gap: 4, padding: Spacing.one, backgroundColor: Colors.surfaceRaised, borderRadius: 8 },
  stripName: { borderTopWidth: 2, paddingBottom: 4 },
  stripNameText: { color: Colors.text, fontSize: 11 },
  fader: { height: 32 },
  stripDb: { color: Colors.textSecondary, fontSize: 10, fontFamily: 'monospace' },
  msRow: { flexDirection: 'row', gap: 4 },
  ms: { width: 24, height: 20, borderRadius: 4, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  msOn: { backgroundColor: Colors.accent },
  msText: { fontSize: 10, color: Colors.text, fontWeight: '700' },
  footnote: { color: Colors.textSecondary, fontSize: 11, marginTop: Spacing.two },
});
