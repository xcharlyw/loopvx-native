import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { engine } from '../audio/engine';
import { preparePageAudio } from '../audio/pageAudio';
import { C } from '../constants/theme';
import {
  consolidateSelectedClip,
  copySelectedClips,
  loopSelection,
  pasteClipsAtCursor,
  selectAllClipsOfTrack,
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
import { ArrangerPanel } from './ArrangerPanel';
import { MarkersPanel } from './MarkersPanel';
import { AutomationPanel } from './AutomationPanel';
import { DevicePanel } from './DevicePanel';
import { InstrumentPanel } from './InstrumentPanel';
import { PianoRollPanel } from './PianoRollPanel';
import { ProjectsPanel } from './ProjectsPanel';
import { PromptBar } from './PromptBar';
import { SessionView } from './SessionView';
import { TrackPanel } from './TrackPanel';
import { TopBar } from './TopBar';
import { sheetLayout } from './sheetLayout';

function Shell() {
  const view = useStore((st) => st.view);
  const panel = useStore((st) => st.panel);
  const sheetSize = useStore((st) => st.sheetSize);
  const toasts = useStore((st) => st.toasts);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [bottomH, setBottomH] = useState(0);
  const close = () => setState({ panel: 'none' });
  const open = panel !== 'none';
  const layout = sheetLayout(sheetSize, { width, height });
  const docked = open && layout.docked;

  // The Android back button closes the panel (the panel used to be a Modal that did this).
  useEffect(() => {
    if (!open || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setState({ panel: 'none' });
      return true;
    });
    return () => sub.remove();
  }, [open]);

  return (
    <View style={[s.app, { paddingTop: insets.top }]}>
      <TopBar />
      {/* A docked panel takes its height from the arrangement, so the tracks above stay visible and scrollable. */}
      <View style={[s.main, docked && { marginBottom: layout.height }]}>
        {view === 'arrange' ? <ArrangeView /> : <SessionView />}
        <PromptBar />
      </View>
      <View onLayout={(e) => setBottomH(e.nativeEvent.layout.height)}>
        <BottomBar />
      </View>

      {open && (
        <View style={[s.overlay, docked ? { left: 0, right: 0, bottom: bottomH, height: layout.height } : { top: 0, left: 0, right: 0, bottom: 0 }]} pointerEvents="box-none">
          <View style={docked ? s.dockRow : s.modalRow} pointerEvents="box-none">
            {!docked && <Pressable style={s.backdrop} onPress={close} />}
            {docked && <View style={{ flex: 1 }} pointerEvents="none" />}
            <View style={[s.sheet, docked ? s.sheetDocked : { paddingTop: insets.top, paddingBottom: insets.bottom }, { width: layout.width }]}>
              {panel === 'library' && <LibraryPanel />}
              {panel === 'mixer' && <MixerPanel />}
              {panel === 'projects' && <ProjectsPanel />}
              {panel === 'clip' && <ClipPanel />}
              {panel === 'track' && <TrackPanel />}
              {panel === 'export' && <ExportPanel />}
              {panel === 'piano' && <PianoRollPanel />}
              {panel === 'instrument' && <InstrumentPanel />}
              {panel === 'devices' && <DevicePanel />}
              {panel === 'automation' && <AutomationPanel />}
              {panel === 'arranger' && <ArrangerPanel />}
              {panel === 'markers' && <MarkersPanel />}
            </View>
          </View>
        </View>
      )}

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
      } else if (mod && e.key.toLowerCase() === 'c' && arrange && getState().selectedClipId) {
        e.preventDefault();
        copySelectedClips();
      } else if (mod && e.key.toLowerCase() === 'v' && arrange) {
        e.preventDefault();
        pasteClipsAtCursor();
      } else if (mod && e.key.toLowerCase() === 'l' && arrange) {
        e.preventDefault();
        loopSelection();
      } else if (mod && e.key.toLowerCase() === 'a' && arrange) {
        e.preventDefault();
        selectAllClipsOfTrack();
      } else if (mod && e.key.toLowerCase() === 'j' && arrange) {
        e.preventDefault();
        void consolidateSelectedClip();
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
  overlay: { position: 'absolute', zIndex: 30 },
  modalRow: { flex: 1, flexDirection: 'row' },
  dockRow: { flex: 1, flexDirection: 'row' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: C.bg2, borderLeftWidth: 1, borderLeftColor: C.line },
  sheetDocked: { borderTopWidth: 1, borderTopColor: C.line, borderTopLeftRadius: 14, overflow: 'hidden' },
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
