import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../constants/theme';
import { boot, setState, useStore } from '../lib/store';
import { getSession } from '../lib/supabase';
import { ArrangeView } from './ArrangeView';
import { BottomBar } from './BottomBar';
import { Txt } from './kit';
import { LibraryPanel } from './LibraryPanel';
import { MixerPanel } from './MixerPanel';
import { ProjectsPanel } from './ProjectsPanel';
import { PromptBar } from './PromptBar';
import { SessionView } from './SessionView';
import { TopBar } from './TopBar';

function Shell() {
  const view = useStore((st) => st.view);
  const panel = useStore((st) => st.panel);
  const toasts = useStore((st) => st.toasts);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const close = () => setState({ panel: 'none' });

  return (
    <View style={[s.app, { paddingTop: insets.top }]}>
      <TopBar />
      <View style={s.main}>
        {view === 'arrange' ? <ArrangeView /> : <SessionView />}
        <PromptBar />
      </View>
      <BottomBar />

      <Modal visible={panel !== 'none'} transparent animationType="fade" onRequestClose={close}>
        <View style={s.modalRow}>
          <Pressable style={s.backdrop} onPress={close} />
          <View style={[s.sheet, { width: Math.min(420, width), paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            {panel === 'library' && <LibraryPanel />}
            {panel === 'mixer' && <MixerPanel />}
            {panel === 'projects' && <ProjectsPanel />}
          </View>
        </View>
      </Modal>

      <View pointerEvents="none" style={[s.toasts, { top: 12 + insets.top, width: Math.min(440, width - 24), left: (width - Math.min(440, width - 24)) / 2 }]}>
        {toasts.map((t) => (
          <View key={t.id} style={[s.toast, t.kind === 'error' && { borderColor: C.danger }]}>
            <Txt>{t.text}</Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

export function App() {
  const ready = useStore((st) => st.ready);
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  useEffect(() => {
    void boot();
    // Restores the login, and on web finishes a Google sign-in that just redirected back with ?code=.
    void getSession();
  }, []);

  return (
    <SafeAreaProvider style={{ backgroundColor: C.bg }}>
      {ready && fontsLoaded ? <Shell /> : <View style={s.app} />}
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.bg, overflow: 'hidden' },
  main: { flex: 1, minHeight: 0 },
  modalRow: { flex: 1, flexDirection: 'row' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: C.bg2, borderLeftWidth: 1, borderLeftColor: C.line },
  toasts: { position: 'absolute', gap: 6, zIndex: 40 },
  toast: {
    backgroundColor: C.panel2,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
});
