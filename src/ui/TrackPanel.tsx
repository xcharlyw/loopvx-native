import { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { C, font } from '../constants/theme';
import { MAX_TRACK_NAME, renameTrack } from '../lib/project';
import { setState, updateProject, useStore } from '../lib/store';
import { Section, Txt } from './kit';
import { Sheet } from './Sheet';

/** Rename the selected track. Saves as you type; leaving the field empty restores the old name. */
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

  return (
    <Sheet title="Spur umbenennen">
      <Section title="Name">
        <TextInput
          style={s.input}
          value={value}
          maxLength={MAX_TRACK_NAME}
          autoFocus
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
    </Sheet>
  );
}

const s = StyleSheet.create({
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
