import { StyleSheet, View } from 'react-native';
import { C, mono } from '../constants/theme';
import { disableMidi, enableMidi, startLearn } from '../lib/midiControl';
import { CC_TARGETS, ccOf } from '../lib/midiIn';
import { trackKind } from '../lib/project';
import { setCcMap, useStore } from '../lib/store';
import { DEFAULT_CC_MAP } from '../lib/midiIn';
import { Btn, Chip, Section, Txt } from './kit';
import { Sheet } from './Sheet';

/** MIDI keyboards, pads (Launchpad, Push) and knob controllers over USB, through Web MIDI. */
export function MidiPanel() {
  const midi = useStore((st) => st.midi);
  const ccMap = useStore((st) => st.ccMap);
  const track = useStore((st) => st.project.tracks.find((t) => t.id === st.selectedTrackId));
  const playsTrack = track && trackKind(track) === 'midi' ? track.name : null;

  return (
    <Sheet title="MIDI-Controller">
      {!midi.supported ? (
        <Section title="Nicht möglich">
          <Txt style={s.note}>Dieser Browser kann kein Web MIDI. Es geht in Chrome, Edge oder Opera am PC und auf Android. Safari und jeder Browser auf dem iPhone können es nicht; dafür kommt später die native App.</Txt>
        </Section>
      ) : (
        <>
          <Section title="Eingang">
            <View style={s.row}>
              {midi.enabled ? (
                <Btn small accessibilityLabel="MIDI ausschalten" onPress={disableMidi}>
                  Ausschalten
                </Btn>
              ) : (
                <Btn small kind="primary" accessibilityLabel="MIDI einschalten" onPress={() => void enableMidi()}>
                  MIDI einschalten
                </Btn>
              )}
            </View>
            <Txt style={s.note}>
              {!midi.enabled
                ? 'Schließe dein Keyboard oder Pad-Gerät per USB an und schalte den Eingang ein. Der Browser fragt einmal nach der Erlaubnis.'
                : midi.inputs.length
                  ? `Verbunden: ${midi.inputs.join(', ')}`
                  : 'Eingang ist an, aber kein Gerät gefunden. Stecke es an, es erscheint dann hier.'}
            </Txt>
            {!!midi.last && <Txt style={s.last}>{midi.last}</Txt>}
          </Section>

          <Section title="Noten spielen">
            <Txt style={s.note}>
              {playsTrack
                ? `Tasten und Pads spielen „${playsTrack}“ mit ihrem Instrument und ihren Effekten. Mit ● in der Transportleiste nimmst du deine Noten ab dem Playhead auf (Einzähler und Rastern stehen unter „Aufnahme“).`
                : 'Wähle im Arrangement eine MIDI-Spur aus: Tasten und Pads spielen dann ihr Instrument. Bei einem Slicer oder dem 909-Kit liegen die Pads ab C1 (Note 36).'}
            </Txt>
            <Txt style={s.note}>Der Ton darf erst klingen, nachdem du die Seite einmal angetippt hast (Play, Taste, Schalter): das schreibt der Browser vor.</Txt>
          </Section>

          <Section title="Regler">
            <Txt style={s.note}>Die Drehregler und Fader deines Geräts steuern die ausgewählte Spur. Tippe „Lernen“ und bewege dann einen Regler, um ihn zuzuweisen.</Txt>
            {CC_TARGETS.map((t) => {
              const cc = ccOf(ccMap, t.id);
              const learning = midi.learn === t.id;
              return (
                <View key={t.id} style={s.target}>
                  <Txt style={s.targetName}>{t.label}</Txt>
                  <Txt style={s.cc}>{cc === undefined ? '–' : `CC ${cc}`}</Txt>
                  <Chip variant={learning ? 'on' : 'ghost'} accessibilityLabel={`${t.label}: Regler lernen`} onPress={() => startLearn(learning ? null : t.id)}>
                    {learning ? 'Bewege Regler …' : 'Lernen'}
                  </Chip>
                </View>
              );
            })}
            <View style={[s.row, { marginTop: 10 }]}>
              <Btn small accessibilityLabel="Regler zurücksetzen" onPress={() => { setCcMap({ ...DEFAULT_CC_MAP }); startLearn(null); }}>
                Standard-Belegung
              </Btn>
            </View>
          </Section>
        </>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  last: { color: C.accent, fontSize: 12, marginTop: 8, ...mono() },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  target: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  targetName: { flex: 1, fontSize: 13 },
  cc: { width: 56, ...mono(), fontSize: 12, color: C.muted, textAlign: 'right' },
});
