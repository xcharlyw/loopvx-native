import { useEffect } from 'react';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { boot, setState, useStore } from '../lib/store';
import { Colors } from '../constants/theme';
import { ArrangeView } from './ArrangeView';
import { BottomBar } from './BottomBar';
import { LibraryPanel } from './LibraryPanel';
import { MixerPanel } from './MixerPanel';
import { SessionView } from './SessionView';
import { TopBar } from './TopBar';

export function App() {
  const view = useStore((s) => s.view);
  const panel = useStore((s) => s.panel);
  const toasts = useStore((s) => s.toasts);
  const ready = useStore((s) => s.ready);

  useEffect(() => {
    void boot();
  }, []);

  if (!ready) return <View style={styles.app} />;

  return (
    <SafeAreaView style={styles.app}>
      <TopBar />
      <View style={styles.main}>{view === 'arrange' ? <ArrangeView /> : <SessionView />}</View>
      <BottomBar />

      <Modal visible={panel !== 'none'} animationType="slide" transparent onRequestClose={() => setState({ panel: 'none' })}>
        <Pressable style={styles.backdrop} onPress={() => setState({ panel: 'none' })} />
        <View style={styles.sheet}>
          {panel === 'library' && <LibraryPanel />}
          {panel === 'mixer' && <MixerPanel />}
        </View>
      </Modal>

      <View style={styles.toasts} pointerEvents="none">
        {toasts.map((t) => (
          <View key={t.id} style={[styles.toast, t.kind === 'error' && styles.toastError]}>
            <Text style={styles.toastText}>{t.text}</Text>
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: Colors.background },
  main: { flex: 1, minHeight: 0 },
  backdrop: { flex: 1, backgroundColor: '#00000099' },
  sheet: { height: '75%', backgroundColor: Colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden' },
  toasts: { position: 'absolute', bottom: 70, left: 0, right: 0, alignItems: 'center', gap: 6 },
  toast: { backgroundColor: Colors.surfaceRaised, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  toastError: { backgroundColor: Colors.danger },
  toastText: { color: Colors.text, fontSize: 13 },
});
