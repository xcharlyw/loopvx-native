import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../constants/theme';
import { engine } from '../audio/engine';
import { deleteSelectedClip, deleteSelectedTrack, duplicateSelectedClip, scaleSelectedClip } from '../lib/actions';
import { setState, useStore } from '../lib/store';
import { confirmDestructive } from './confirm';
import { Copy, GridIcon, Mixer, TimelineIcon, Trash, ZoomIn, ZoomOut } from './icons';
import { IconBtn, PillGroup, Spacer, Txt, iconColor } from './kit';

export function BottomBar() {
  const view = useStore((s) => s.view);
  const zoom = useStore((s) => s.zoom);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const hasSelectedTrack = useStore((s) => s.project.tracks.some((t) => t.id === s.selectedTrackId));
  const insets = useSafeAreaInsets();

  const switchView = (v: 'arrange' | 'session') => {
    if (v === view) return;
    engine.stop();
    setState({ view: v, armedSampleId: null });
  };

  return (
    <View style={[s.bar, { paddingBottom: 8 + insets.bottom }]}>
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

      {view === 'arrange' && selectedClipId && (
        <PillGroup>
          <IconBtn accessibilityLabel="Halbe Länge" onPress={() => scaleSelectedClip(0.5)}>
            <Txt>½</Txt>
          </IconBtn>
          <IconBtn accessibilityLabel="Doppelte Länge" onPress={() => scaleSelectedClip(2)}>
            <Txt>×2</Txt>
          </IconBtn>
          <IconBtn accessibilityLabel="Duplizieren" onPress={duplicateSelectedClip}>
            <Copy size={16} />
          </IconBtn>
          <IconBtn accessibilityLabel="Löschen" onPress={deleteSelectedClip}>
            <Trash size={16} />
          </IconBtn>
        </PillGroup>
      )}

      {view === 'arrange' && !selectedClipId && hasSelectedTrack && (
        <PillGroup>
          <IconBtn accessibilityLabel="Spur löschen" onPress={() => void deleteSelectedTrack(confirmDestructive)}>
            <Trash size={16} color={C.danger} />
          </IconBtn>
        </PillGroup>
      )}

      <Spacer />

      {view === 'arrange' && (
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
