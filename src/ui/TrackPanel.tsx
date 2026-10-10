import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { C, font } from '../constants/theme';
import { deleteSelectedTrack } from '../lib/actions';
import { MAX_TRACK_NAME, TRACK_COLORS, mapTrack, renameTrack } from '../lib/project';
import { getState, setState, updateProject, useStore } from '../lib/store';
import { confirmDestructive } from './confirm';
import { Trash } from './icons';
import { Btn, Section, Txt } from './kit';
import { Sheet } from './Sheet';

/** Rename, recolour or delete the selected track. Saves as you type; leaving the field empty restores the old name. */
export function TrackPanel() {
  const track = useStore((st) => st.project.tracks.find((t) => t.id === st.selectedTrackId));
  const [draft, setDraft] = useState<string | null>(null);
  if (!track) {
    return (
      <Sheet title="Spur">
        <Txt style={s.note}>Tippe im Arrangement auf eine Spur, um sie umzubenennen.</Txt>
      </Sheet>
    );
  }
  const trackId = track.id;
  const value = draft ?? track.name;

  const change = (text: string) => {
    setDraft(text);
    // The name updates live (it is what the headers and the mixer show); empty only while typing.
    updateProject((p) => renameTrack(p, trackId, text), { reschedule: false });
  };
  const finish = () => {
    if (!value.trim()) updateProject((p) => renameTrack(p, trackId, track.name || 'Spur'), { reschedule: false });
    else if (value !== value.trim()) updateProject((p) => renameTrack(p, trackId, value.trim()), { reschedule: false });
    setDraft(null);
    setState({ panel: 'none' });
  };

  const remove = async () => {
    await deleteSelectedTrack(confirmDestructive);
    if (!getState().project.tracks.some((t) => t.id === trackId)) setState({ panel: 'none' });
  };

  return (
    <Sheet title="Spur bearbeiten">
      <Section title="Name">
        <TextInput
          style={s.input}
          value={value}
          maxLength={MAX_TRACK_NAME}
          selectTextOnFocus
          returnKeyType="done"
          onChangeText={change}
          onBlur={() => {
            if (!value.trim()) updateProject((p) => renameTrack(p, trackId, 'Spur'), { reschedule: false });
          }}
          onSubmitEditing={finish}
          accessibilityLabel="Spurname"
        />
        <Txt style={s.note}>Tipp: Ein langer Druck auf den Spurnamen öffnet diese Ansicht auch direkt.</Txt>
      </Section>

      <Section title="Farbe">
        <View style={s.swatches}>
          {TRACK_COLORS.map((color) => (
            <Pressable
              key={color}
              accessibilityLabel={`Farbe ${color}`}
              accessibilityState={{ selected: track.color === color }}
              onPress={() => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, color })), { reschedule: false })}
              style={[s.swatch, { backgroundColor: color }, track.color === color && s.swatchOn]}
            />
          ))}
        </View>
      </Section>

      <Section title="Spur">
        <View style={{ flexDirection: 'row' }}>
          <Btn kind="danger" onPress={() => void remove()}>
            <Trash size={16} color={C.danger} />
            Spur löschen
          </Btn>
        </View>
      </Section>
    </Sheet>
  );
}

const s = StyleSheet.create({
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: '#fff' },
  input: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panel,
    paddingHorizontal: 12,
    marginBottom: 8,
    color: C.text,
    ...font(400),
    fontSize: 14,
    outlineWidth: 0,
  },
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
});
