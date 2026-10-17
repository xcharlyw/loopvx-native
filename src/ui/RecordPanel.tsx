import { StyleSheet, View } from 'react-native';
import { C, mono } from '../constants/theme';
import { MAX_LATENCY_MS } from '../lib/recordingMath';
import { trackKind } from '../lib/project';
import { recordTarget } from '../lib/takes';
import { setRecSettings, setState, useStore } from '../lib/store';
import { startTrackRecording } from '../lib/trackRecording';
import { Btn, Chip, Section, Txt } from './kit';
import { Sheet } from './Sheet';

/** Settings of the ● button: count-in and the device-latency offset, and where the take will go. */
export function RecordPanel() {
  const settings = useStore((st) => st.recSettings);
  const project = useStore((st) => st.project);
  const selectedTrackId = useStore((st) => st.selectedTrackId);
  const cursor = useStore((st) => st.cursor);
  const target = recordTarget(project, selectedTrackId).trackId;
  const name = target ? project.tracks.find((t) => t.id === target)?.name : undefined;
  const selected = project.tracks.find((t) => t.id === selectedTrackId);
  const midiTrack = selected && trackKind(selected) === 'midi' ? selected.name : null;
  const step = (d: number) => setRecSettings({ latencyMs: settings.latencyMs + d });

  return (
    <Sheet title="Aufnahme">
      <Section title="Ziel">
        <Txt style={s.note}>
          {midiTrack
            ? `Noten aufnehmen ab Takt ${Math.floor(cursor) + 1} auf „${midiTrack}“ (MIDI-Controller nötig).`
            : `Mikrofon-Aufnahme ab Takt ${Math.floor(cursor) + 1} auf ${name ? `„${name}“` : 'eine neue Spur „Aufnahme“'}. Wähle vorher eine andere Audio-Spur aus, um sie zu nehmen; eine MIDI-Spur nimmt Noten vom Controller auf.`}
        </Txt>
      </Section>

      <Section title="Einzähler">
        <View style={s.chips}>
          {([0, 1, 2] as const).map((n) => (
            <Chip key={n} variant={settings.countIn === n ? 'on' : 'ghost'} accessibilityLabel={n ? `${n} Takt Einzähler` : 'Kein Einzähler'} onPress={() => setRecSettings({ countIn: n })}>
              {n === 0 ? 'Aus' : n === 1 ? '1 Takt' : '2 Takte'}
            </Chip>
          ))}
        </View>
        <Txt style={s.note}>Der Einzähler klickt immer, auch wenn das Metronom aus ist. Mit eingeschaltetem Metronom (Transportleiste) klickt es während der Aufnahme weiter.</Txt>
      </Section>

      <Section title="Versatz (Latenz)">
        <View style={s.chips}>
          <Chip variant="ghost" accessibilityLabel="Versatz kleiner" onPress={() => step(-10)}>
            −
          </Chip>
          <Txt style={s.value}>{`${settings.latencyMs} ms`}</Txt>
          <Chip variant="ghost" accessibilityLabel="Versatz größer" onPress={() => step(10)}>
            +
          </Chip>
          <Chip variant="ghost" onPress={() => setRecSettings({ latencyMs: 0 })}>
            0
          </Chip>
        </View>
        <Txt style={s.note}>{`Mikrofon und Lautsprecher brauchen Zeit: eine Aufnahme liegt sonst etwas hinter dem Takt. Kommt sie zu spät, erhöhe den Wert (bis ${MAX_LATENCY_MS} ms); mit Kopfhörern per Kabel reichen meist 30 bis 80 ms, Bluetooth braucht deutlich mehr. Probiere es mit dem Einzähler: zähl mit und schau, ob der erste Schlag auf der Taktlinie sitzt.`}</Txt>
      </Section>

      <Section title="MIDI-Noten">
        <View style={s.chips}>
          <Chip variant={settings.quantize ? 'on' : 'ghost'} accessibilityLabel="Noten auf 1/16 runden" onPress={() => setRecSettings({ quantize: !settings.quantize })}>
            Auf 1/16 runden
          </Chip>
        </View>
        <Txt style={s.note}>Ist eine MIDI-Spur ausgewählt, nimmt ● die Noten auf, die du am MIDI-Controller spielst (Menü → MIDI-Controller). Beginnt die Aufnahme auf dem Takt eines vorhandenen Clips, kommen die Noten in diesen Clip dazu: so baust du ein Pattern Schicht für Schicht auf.</Txt>
      </Section>

      <View style={s.buttons}>
        <Btn kind="primary" accessibilityLabel="Aufnahme starten" onPress={() => { setState({ panel: 'none' }); void startTrackRecording(); }}>
          ● Aufnahme starten
        </Btn>
      </View>
      <Txt style={s.note}>Liegt die neue Aufnahme auf einem Clip, entsteht darunter eine Take-Spur („… Take 2“): nur der neueste Take ist hörbar, die älteren sind stummgeschaltet (Clip auswählen, Taste 0 schaltet ihn wieder ein).</Txt>
    </Sheet>
  );
}

const s = StyleSheet.create({
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  value: { ...mono(), minWidth: 64, textAlign: 'center', fontSize: 14 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 14 },
});
