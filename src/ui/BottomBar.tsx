import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Spacing } from '../constants/theme';
import { deleteSelectedClip, duplicateSelectedClip, scaleSelectedClip } from '../lib/actions';
import { engine } from '../audio/engine';
import { setState, useStore } from '../lib/store';

export function BottomBar() {
  const view = useStore((s) => s.view);
  const zoom = useStore((s) => s.zoom);
  const selectedClipId = useStore((s) => s.selectedClipId);

  const switchView = (v: 'arrange' | 'session') => {
    if (v === view) return;
    engine.stop();
    setState({ view: v, armedSampleId: null });
  };

  return (
    <View style={styles.bar}>
      <View style={styles.group}>
        <Pressable style={[styles.btn, view === 'arrange' && styles.btnOn]} onPress={() => switchView('arrange')}>
          <Text style={styles.btnText}>Arrange</Text>
        </Pressable>
        <Pressable style={[styles.btn, view === 'session' && styles.btnOn]} onPress={() => switchView('session')}>
          <Text style={styles.btnText}>Session</Text>
        </Pressable>
      </View>

      {view === 'arrange' && selectedClipId && (
        <View style={styles.group}>
          <Pressable style={styles.btn} onPress={() => scaleSelectedClip(0.5)}>
            <Text style={styles.btnText}>½</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => scaleSelectedClip(2)}>
            <Text style={styles.btnText}>×2</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={duplicateSelectedClip}>
            <Text style={styles.btnText}>Dup</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={deleteSelectedClip}>
            <Text style={styles.btnText}>Del</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.spacer} />

      {view === 'arrange' && (
        <View style={styles.group}>
          <Pressable style={styles.btn} onPress={() => setState({ zoom: Math.max(8, zoom / 1.4) })}>
            <Text style={styles.btnText}>−</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => setState({ zoom: Math.min(240, zoom * 1.4) })}>
            <Text style={styles.btnText}>+</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  group: { flexDirection: 'row', gap: 4 },
  spacer: { flex: 1 },
  btn: { backgroundColor: Colors.surfaceRaised, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  btnOn: { backgroundColor: Colors.accent },
  btnText: { color: Colors.text, fontSize: 12 },
});
