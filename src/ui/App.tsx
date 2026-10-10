import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { engine } from '../audio/engine';
import { preparePageAudio } from '../audio/pageAudio';
import { C } from '../constants/theme';
import {
  deleteSelectedClip,
  duplicateSelectedClip,
  nudgeSelectedClip,
  splitSelectedClip,
  togglePlay,
} from '../lib/actions';
import { boot, getState, redo, setState, undo, useStore } from '../lib/store';
import { getSession } from '../lib/supabase';
import { startSync } from '../lib/sync';
import { ArrangeView } from './ArrangeView';
import { BottomBar } from './BottomBar';
import { ClipPanel } from './ClipPanel';
import { ExportPanel } from './ExportPanel';
import { Txt } from './kit';
import { LibraryPanel } from './LibraryPanel';
import { MixerPanel } from './MixerPanel';
import { PianoRollPanel } from './PianoRollPanel';
import { ProjectsPanel } from './ProjectsPanel';
import { PromptBar } from './PromptBar';
import { SessionView } from './SessionView';
import { TrackPanel } from './TrackPanel';
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
            {panel === 'clip' && <ClipPanel />}
            {panel === 'track' && <TrackPanel />}
            {panel === 'export' && <ExportPanel />}
            {panel === 'piano' && <PianoRollPanel />}
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

/**
 * Web: start audio on the first tap anywhere, and again after iOS paused it (lock screen, call).
 * Safari only allows that inside a gesture, and a later async step (decoding, loading) is too late.
 */
function useAudioUnlock() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onGesture = () => {
      preparePageAudio(); // iOS pauses the silent player in the background
      if (engine.ctx?.state !== 'running') void engine.unlock().catch(() => undefined);
    };
    const events = ['touchend', 'click', 'keydown'] as const;
    events.forEach((ev) => window.addEventListener(ev, onGesture, true));
    return () => events.forEach((ev) => window.removeEventListener(ev, onGesture, true));
  }, []);
}

/** Ableton-style keys on web: Space play/stop, Cmd/Ctrl+Z undo (+Shift or Y: redo), Cmd/Ctrl+E split, Cmd/Ctrl+D duplicate, Delete, arrows nudge. */
function useShortcuts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select')) return;
      const mod = e.metaKey || e.ctrlKey;
      const arrange = getState().view === 'arrange';
      // A focused button already handles Space itself (react-native-web presses it).
      if (e.code === 'Space' && target !== document.body && target?.closest?.('[tabindex], button, [role="button"]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        void togglePlay();
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'e' && arrange) {
        e.preventDefault();
        splitSelectedClip();
      } else if (mod && e.key.toLowerCase() === 'd' && arrange) {
        e.preventDefault();
        duplicateSelectedClip();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && arrange) {
        e.preventDefault();
        deleteSelectedClip();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && arrange && getState().selectedClipId) {
        e.preventDefault();
        nudgeSelectedClip((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.25));
      } else if (e.key === 'Escape') {
        setState({ panel: 'none', armedSampleId: null, selectedClipId: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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

  useShortcuts();
  useAudioUnlock();

  useEffect(() => {
    // getSession restores the login (on web it also finishes a Google sign-in that just redirected
    // back with ?code=), then Drive sync starts.
    void Promise.all([boot(), getSession()]).then(startSync);
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
