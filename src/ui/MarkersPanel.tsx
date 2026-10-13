import { StyleSheet, TextInput, View } from 'react-native';
import { formatBarPosition } from '../audio/timing';
import { C, font, mono } from '../constants/theme';
import { setCursor } from '../lib/actions';
import { addMarker, moveMarker, removeMarker, renameMarker } from '../lib/markers';
import { getState, setState, updateProject, useStore } from '../lib/store';
import { Btn, Txt } from './kit';
import { Sheet } from './Sheet';

/** The project's markers: rename, nudge, jump to, delete; and a new one at the playhead. */
export function MarkersPanel() {
  const markers = useStore((st) => st.project.markers ?? []);
  const edit = (fn: Parameters<typeof updateProject>[0]) => updateProject(fn, { reschedule: false });
  return (
    <Sheet title="Marker">
      <Txt style={s.note}>Marker benennen Abschnitte wie „Drop 1“. Tippen im Lineal springt hin, langes Drücken auf den leeren Streifen setzt einen neuen.</Txt>
      {markers.length === 0 && <Txt style={s.note}>Noch keine Marker.</Txt>}
      {markers.map((m) => (
        <View key={m.id} style={s.row}>
          <TextInput style={s.input} defaultValue={m.name} accessibilityLabel={`Name von ${m.name}`} onEndEditing={(e) => edit((p) => renameMarker(p, m.id, e.nativeEvent.text))} onSubmitEditing={(e) => edit((p) => renameMarker(p, m.id, e.nativeEvent.text))} />
          <Txt style={s.pos}>{formatBarPosition(m.bar)}</Txt>
          <Btn small accessibilityLabel={`${m.name} früher`} onPress={() => edit((p) => moveMarker(p, m.id, m.bar - 1))}>
            ◀
          </Btn>
          <Btn small accessibilityLabel={`${m.name} später`} onPress={() => edit((p) => moveMarker(p, m.id, m.bar + 1))}>
            ▶
          </Btn>
          <Btn
            small
            accessibilityLabel={`Zu ${m.name}`}
            onPress={() => {
              setCursor(m.bar);
              setState({ panel: 'none' });
            }}
          >
            Hin
          </Btn>
          <Btn small kind="danger" accessibilityLabel={`${m.name} löschen`} onPress={() => edit((p) => removeMarker(p, m.id))}>
            ✕
          </Btn>
        </View>
      ))}
      <View style={[s.row, { marginTop: 10 }]}>
        <Btn kind="primary" accessibilityLabel="Marker hinzufügen" onPress={() => edit((p) => addMarker(p, getState().cursor))}>
          + Marker an der Abspielposition
        </Btn>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  input: { flex: 1, minWidth: 110, height: 34, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, paddingHorizontal: 10, color: C.text, ...font(500), fontSize: 13, outlineWidth: 0 },
  pos: { ...mono(), fontSize: 11, color: C.muted },
});
