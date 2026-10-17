import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { engine } from '../audio/engine';
import { preparePageAudio } from '../audio/pageAudio';
import { C } from '../constants/theme';
import { matchesKey } from '../lib/keymap';
import { boot, setState, useStore } from '../lib/store';
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
import { COMMANDS } from './commands';
import { SampleDragGhost } from './dnd';
import { MENU_BAR_H, MenuBar, MenuPanel, ShortcutsPanel } from './MenuBar';
import { SlicePanel } from './SlicePanel';
import { RecordPanel } from './RecordPanel';
import { useAppDims, useSmall } from './hooks';
import { browserWidth, clampScale, fullHeight, placementFor } from './sheetLayout';
import { useDrag, web } from './drag';
import { SheetPlace } from './Sheet';
import { ExportProgressCard } from './ExportProgressCard';
import { FloatingWindow } from './FloatingWindow';
import { NoteFxPanel } from './NoteFxPanel';
import { openWindow, refitWindows } from '../lib/windowActions';
import { isFloatPanel, type WinId } from '../lib/windows';
import type { ReactNode } from 'react';

const BROWSER_PLACE = { column: true, onClose: () => setState({ browserOpen: false }) };

const WINDOW_PANELS: Record<WinId, ReactNode> = { instrument: <InstrumentPanel />, devices: <DevicePanel />, notefx: <NoteFxPanel /> };

function Shell() {
  const view = useStore((st) => st.view);
  const panel = useStore((st) => st.panel);
  const sheetSize = useStore((st) => st.sheetSize);
  const sheetScale = useStore((st) => st.sheetScale);
  const toasts = useStore((st) => st.toasts);
  const insets = useSafeAreaInsets();
  const { width, height } = useAppDims();
  const small = useSmall();
  const menuBar = Platform.OS === 'web' && !small;
  const [bottomH, setBottomH] = useState(0);
  const close = () => setState({ panel: 'none' });
  const windows = useStore((st) => st.windows);
  // Wide screens: the plugin panels float as windows instead of opening as a sheet (see the effect below).
  const floated = menuBar && isFloatPanel(panel);
  const open = panel !== 'none' && !floated;
  const browserOpen = useStore((st) => st.browserOpen);
  const browser = menuBar && browserOpen;
  const browserW = browser ? browserWidth(width) : 0;
  const layout = placementFor(panel, sheetSize, { width: width - browserW, height }, menuBar, sheetScale);
  const docked = open && layout.docked;
  // The handle on a docked sheet's top edge: drag up or down to make it as tall as you need (kept as a fraction of its full height).
  const dragStart = useRef(0);
  const fullH = fullHeight(panel, { height }, menuBar);
  const handle = useDrag('start', docked && sheetSize !== 'bar', (_dx, dy, phase) => {
    if (phase === 'cancel') return;
    if (dragStart.current === 0) dragStart.current = layout.height ?? 0;
    const next = clampScale((dragStart.current - dy) / fullH);
    setState({ sheetSize: 'full', sheetScale: next });
    if (phase === 'end') dragStart.current = 0;
  });

  // Live layout: on a wide screen the Library is the browser column, not a panel.
  useEffect(() => {
    if (menuBar && panel === 'library') setState({ panel: 'none', browserOpen: true });
  }, [menuBar, panel]);

  // Plugin windows: opening Sound, Geräte or MIDI-Effekte on a wide screen opens (or raises) a floating window.
  useEffect(() => {
    if (floated && isFloatPanel(panel)) openWindow(panel);
  }, [floated, panel]);
  // A resized browser window pulls the plugin windows back on screen.
  useEffect(() => {
    refitWindows();
  }, [width, height]);

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
      {menuBar && <MenuBar />}
      <TopBar />
      {/* A docked panel takes its height from the arrangement, so the tracks above stay visible and scrollable. */}
      <View style={s.row}>
        {browser && (
          <View style={[s.browser, { width: browserW }]}>
            <SheetPlace.Provider value={BROWSER_PLACE}>
              <LibraryPanel />
            </SheetPlace.Provider>
          </View>
        )}
        <View style={[s.main, docked && { marginBottom: layout.height }]}>
          {view === 'arrange' ? <ArrangeView /> : <SessionView />}
          <PromptBar />
        </View>
      </View>
      <View onLayout={(e) => setBottomH(e.nativeEvent.layout.height)}>
        <BottomBar />
      </View>

      {open && (
        <View style={[s.overlay, docked ? { left: layout.detail ? browserW : 0, right: 0, bottom: bottomH, height: layout.height } : { top: menuBar ? MENU_BAR_H : 0, left: 0, right: 0, bottom: 0 }]} pointerEvents="box-none">
          <View style={docked ? s.dockRow : s.modalRow} pointerEvents="box-none">
            {!docked && <Pressable style={s.backdrop} onPress={close} />}
            {docked && !layout.detail && <View style={{ flex: 1 }} pointerEvents="none" />}
            <View style={[s.sheet, docked ? s.sheetDocked : { paddingTop: insets.top, paddingBottom: insets.bottom }, layout.detail ? { flex: 1, borderTopLeftRadius: 0 } : { width: layout.width }]}>
              {docked && sheetSize !== 'bar' && (
                <View {...handle} accessibilityLabel="Fenstergröße ziehen" style={[s.grip, web({ touchAction: 'none', cursor: 'ns-resize' })]}>
                  <View style={s.gripPill} />
                </View>
              )}
              {panel === 'library' && <LibraryPanel />}
              {panel === 'mixer' && <MixerPanel />}
              {panel === 'projects' && <ProjectsPanel />}
              {panel === 'clip' && <ClipPanel />}
              {panel === 'track' && <TrackPanel />}
              {panel === 'export' && <ExportPanel />}
              {panel === 'piano' && <PianoRollPanel />}
              {panel === 'instrument' && <InstrumentPanel />}
              {panel === 'devices' && <DevicePanel />}
              {panel === 'notefx' && <NoteFxPanel />}
              {panel === 'automation' && <AutomationPanel />}
              {panel === 'arranger' && <ArrangerPanel />}
              {panel === 'markers' && <MarkersPanel />}
              {panel === 'shortcuts' && <ShortcutsPanel />}
              {panel === 'menu' && <MenuPanel />}
              {panel === 'slice' && <SlicePanel />}
              {panel === 'record' && <RecordPanel />}
            </View>
          </View>
        </View>
      )}

      {menuBar &&
        windows.map((w, i) => (
          <FloatingWindow key={w.id} win={w} z={i}>
            {WINDOW_PANELS[w.id]}
          </FloatingWindow>
        ))}

      <View pointerEvents="none" style={[s.toasts, { top: 12 + insets.top, width: Math.min(440, width - 24), left: (width - Math.min(440, width - 24)) / 2 }]}>
        {toasts.map((t) => (
          <View key={t.id} style={[s.toast, t.kind === 'error' && { borderColor: C.danger }]}>
            <Txt>{t.text}</Txt>
          </View>
        ))}
      </View>
      <ExportProgressCard bottom={96 + insets.bottom} />
      <SampleDragGhost />
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

/** Keyboard shortcuts (web): Ableton Live's, from the command table in `commands.ts`. */
function useShortcuts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      // A focused button already handles Space itself (react-native-web presses it).
      if (e.code === 'Space' && target !== document.body && target?.closest?.('[tabindex], button, [role="button"]')) return;
      for (const cmd of COMMANDS) {
        if (!cmd.keys?.some((k) => matchesKey(e, k))) continue;
        if (cmd.enabled && !cmd.enabled()) continue;
        e.preventDefault();
        cmd.run();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Zooms the whole interface (web): CSS zoom scales the content, the box keeps filling the window. */
function ZoomBox({ children }: { children: ReactNode }) {
  const scale = useStore((st) => st.uiScale);
  if (Platform.OS !== 'web' || scale === 1) return <>{children}</>;
  const zoomed = { zoom: scale, width: '100%', height: '100%' } as unknown as object;
  return <View style={zoomed}>{children}</View>;
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
      {ready && fontsLoaded ? (
        <ZoomBox>
          <Shell />
        </ZoomBox>
      ) : (
        <View style={s.app} />
      )}
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.bg, overflow: 'hidden' },
  main: { flex: 1, minHeight: 0, minWidth: 0 },
  row: { flex: 1, flexDirection: 'row', minHeight: 0 },
  browser: { backgroundColor: C.bg2, borderRightWidth: 1, borderRightColor: C.line },
  overlay: { position: 'absolute', zIndex: 30 },
  modalRow: { flex: 1, flexDirection: 'row' },
  dockRow: { flex: 1, flexDirection: 'row' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: C.bg2, borderLeftWidth: 1, borderLeftColor: C.line },
  grip: { position: 'absolute', top: 0, left: 0, right: 0, height: 18, zIndex: 20, alignItems: 'center', justifyContent: 'center' },
  gripPill: { width: 44, height: 4, borderRadius: 2, backgroundColor: C.dim },
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
