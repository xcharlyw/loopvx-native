import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { APP_NAME } from '../config';
import { Colors, Spacing } from '../constants/theme';
import { engine } from '../audio/engine';
import { formatBarPosition, formatClock, secondsPerBar } from '../audio/timing';
import { setCursor, togglePlay } from '../lib/actions';
import { KEYS } from '../lib/project';
import { setState, toast, updateProject, useStore } from '../lib/store';
import { useEngine, usePlayhead } from './hooks';

export function TopBar() {
  const project = useStore((s) => s.project);
  const playing = useEngine(() => engine.playing);
  const pos = usePlayhead();
  const [bpmText, setBpmText] = useState<string | null>(null);
  const [keyIndex, setKeyIndexState] = useState(() => Math.max(0, KEYS.indexOf(project.key)));

  const commitBpm = () => {
    const v = Number(bpmText);
    if (bpmText !== null && v >= 60 && v <= 220) updateProject((p) => ({ ...p, bpm: Math.round(v * 10) / 10 }));
    setBpmText(null);
  };

  const cycleKey = () => {
    const next = (keyIndex + 1) % KEYS.length;
    setKeyIndexState(next);
    updateProject((p) => ({ ...p, key: KEYS[next] }), { reschedule: false });
  };

  return (
    <View style={styles.bar}>
      <Text style={styles.logo}>
        {APP_NAME.slice(0, -2)}
        <Text style={styles.logoAccent}>{APP_NAME.slice(-2)}</Text>
      </Text>

      <View style={styles.pill}>
        <Text style={styles.projectName} numberOfLines={1}>
          {project.name}
        </Text>
      </View>

      <View style={styles.spacer} />

      <View style={styles.transport}>
        <Pressable style={styles.iconBtn} onPress={() => setCursor(0)}>
          <Text style={styles.iconText}>⏮</Text>
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => void togglePlay()}>
          <Text style={styles.iconText}>{playing ? '■' : '▶'}</Text>
        </Pressable>
        <Pressable
          style={[styles.iconBtn, project.loop.enabled && styles.iconBtnOn]}
          onPress={() => updateProject((p) => ({ ...p, loop: { ...p.loop, enabled: !p.loop.enabled } }))}
        >
          <Text style={styles.iconText}>↻</Text>
        </Pressable>
      </View>

      <View style={styles.pill}>
        <Text style={styles.monoMuted}>{formatClock(pos * secondsPerBar(project.bpm))}</Text>
        <Text style={styles.mono}>{formatBarPosition(pos)}</Text>
      </View>

      <View style={styles.pill}>
        <View style={styles.bpmInputBox}>
          <TextInput
            style={styles.bpmInput}
            keyboardType="decimal-pad"
            value={bpmText ?? String(project.bpm)}
            onFocus={() => setBpmText(String(project.bpm))}
            onChangeText={setBpmText}
            onBlur={commitBpm}
            onSubmitEditing={commitBpm}
          />
        </View>
        <Text style={styles.monoMuted}>BPM</Text>
      </View>

      <Pressable style={styles.pill} onPress={cycleKey}>
        <Text style={styles.mono}>{project.key}</Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>

      <Pressable style={styles.pill} onPress={() => toast('Export kommt in einer späteren Phase.')}>
        <Text style={styles.pillText}>Export</Text>
      </Pressable>
      <Pressable style={styles.pill} onPress={() => setState({ panel: 'library' })}>
        <Text style={styles.pillText}>Library</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexWrap: 'wrap',
  },
  logo: { color: Colors.text, fontWeight: '700', fontSize: 18, letterSpacing: 0.5 },
  logoAccent: { color: Colors.accent },
  spacer: { flex: 1 },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surfaceRaised,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
  },
  projectName: { color: Colors.text, fontSize: 13, fontWeight: '600', maxWidth: 110 },
  pillText: { color: Colors.text, fontSize: 13 },
  mono: { color: Colors.text, fontSize: 13, fontFamily: 'monospace' },
  monoMuted: { color: Colors.textSecondary, fontSize: 12, fontFamily: 'monospace' },
  bpmInputBox: { width: 32, overflow: 'hidden' },
  bpmInput: { color: Colors.text, fontSize: 13, fontFamily: 'monospace', width: 32, padding: 0 },
  chevron: { color: Colors.textSecondary, fontSize: 10 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceRaised,
  },
  iconBtnOn: { backgroundColor: Colors.accent },
  iconText: { color: Colors.text, fontSize: 14 },
});
