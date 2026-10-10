import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../constants/theme';
import { engine } from '../audio/engine';
import { deleteSelectedClip, deleteSelectedTrack, duplicateSelectedClip, splitSelectedClip } from '../lib/actions';
import { redo, setState, undo, useStore } from '../lib/store';
import { confirmDestructive } from './confirm';
import { Copy, GridIcon, Mixer, More, Pencil, Redo, Scissors, TimelineIcon, Trash, Undo, ZoomIn, ZoomOut } from './icons';
import { useSmall } from './hooks';
import { IconBtn, PillGroup, Spacer, iconColor } from './kit';

export function BottomBar() {
  const view = useStore((s) => s.view);
  const zoom = useStore((s) => s.zoom);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const hasSelectedTrack = useStore((s) => s.project.tracks.some((t) => t.id === s.selectedTrackId));
  const insets = useSafeAreaInsets();
  const small = useSmall();

  const switchView = (v: 'arrange' | 'session') => {
    if (v === view) return;
    engine.stop();
    setState({ view: v, armedSampleId: null });
  };

  return (
    <View style={[s.bar, small && s.barSm, { paddingBottom: 8 + insets.bottom }]}>
      <PillGroup>
        <IconBtn accessibilityLabel="Mixer" onPress={() => setState({ panel: 'mixer' })}>
          <Mixer size={18} />
        </IconBtn>
      </PillGroup>
      <PillGroup>
        <IconBtn accessibilityLabel="Arrangement" onPress={() => switchView('arrange')}>
          <TimelineIcon size={18} color={iconColor(view === 'arrange')} />
        </IconBtn>
        <IconBtn accessibilityLabel="Session-Grid" onPress={() => switchView('session')}>
          <GridIcon size={18} color={iconColor(view === 'session')} />
        </IconBtn>
      </PillGroup>

      <PillGroup>
        <IconBtn accessibilityLabel="Rückgängig" disabled={!canUndo} onPress={undo}>
          <Undo size={16} />
        </IconBtn>
        <IconBtn accessibilityLabel="Wiederholen" disabled={!canRedo} onPress={redo}>
          <Redo size={16} />
        </IconBtn>
      </PillGroup>

      {view === 'arrange' && selectedClipId && (
        <PillGroup>
          <IconBtn accessibilityLabel="Teilen" onPress={splitSelectedClip}>
            <Scissors size={16} />
          </IconBtn>
          <IconBtn accessibilityLabel="Duplizieren" onPress={duplicateSelectedClip}>
            <Copy size={16} />
          </IconBtn>
          <IconBtn accessibilityLabel="Löschen" onPress={deleteSelectedClip}>
            <Trash size={16} />
          </IconBtn>
          <IconBtn accessibilityLabel="Clip: Länge & Tempo" onPress={() => setState({ panel: 'clip' })}>
            <More size={16} />
          </IconBtn>
        </PillGroup>
      )}

      {view === 'arrange' && !selectedClipId && hasSelectedTrack && (
        <PillGroup>
          <IconBtn accessibilityLabel="Spur bearbeiten" onPress={() => setState({ panel: 'track' })}>
            <Pencil size={16} />
          </IconBtn>
          {/* On a phone the bar is full: delete lives in the track sheet there. */}
          {!small && (
            <IconBtn accessibilityLabel="Spur löschen" onPress={() => void deleteSelectedTrack(confirmDestructive)}>
              <Trash size={16} color={C.danger} />
            </IconBtn>
          )}
        </PillGroup>
      )}

      <Spacer />

      {/* On a phone the clip tools need the room; zoom comes back once the clip is deselected. */}
      {view === 'arrange' && !(small && selectedClipId) && (
        <PillGroup>
          <IconBtn accessibilityLabel="Herauszoomen" onPress={() => setState({ zoom: Math.max(8, zoom / 1.4) })}>
            <ZoomOut size={18} />
          </IconBtn>
          <IconBtn accessibilityLabel="Hineinzoomen" onPress={() => setState({ zoom: Math.min(240, zoom * 1.4) })}>
            <ZoomIn size={18} />
          </IconBtn>
        </PillGroup>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  barSm: { gap: 4, paddingHorizontal: 10 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: C.lineSoft,
    backgroundColor: C.bg,
    zIndex: 5,
  },
});
