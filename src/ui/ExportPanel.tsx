import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { C } from '../constants/theme';
import { exportRegion, exportStems, exportWav } from '../lib/actions';
import { useStore } from '../lib/store';
import { Export } from './icons';
import { Btn, Section, Txt } from './kit';
import { Sheet } from './Sheet';

/** Mixdown or stems of the loop region (or the whole arrangement when the loop is off). */
export function ExportPanel() {
  const project = useStore((st) => st.project);
  const [busy, setBusy] = useState(false);
  const region = exportRegion(project);
  const tracks = project.tracks.filter((t) => t.clips.some((c) => c.start < region.to && c.start + c.length > region.from));
  const bars = `Takt ${region.from + 1}–${Math.ceil(region.to)}`;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Export">
      <Section title="Bereich">
        <Txt>{project.loop.enabled ? `Loop · ${bars}` : `Ganzes Arrangement · ${bars}`}</Txt>
        <Txt style={s.note}>Ändern: Loop oben im Takt-Lineal verschieben oder ausschalten.</Txt>
      </Section>

      <Section title="Mixdown">
        <Txt style={[s.note, { marginTop: 0, marginBottom: 10 }]}>Alle Spuren zusammen als eine WAV (44,1 kHz, Stereo), mit Mixer, Mute und Solo.</Txt>
        <View style={s.row}>
          <Btn kind="primary" disabled={busy} onPress={() => void run(exportWav)}>
            <Export size={16} color={C.accentInk} />
            Mixdown (WAV)
          </Btn>
        </View>
      </Section>

      <Section title="Stems">
        <Txt style={[s.note, { marginTop: 0, marginBottom: 10 }]}>
          {tracks.length
            ? `Jede Spur einzeln als WAV in einer ZIP-Datei (${tracks.length} ${tracks.length === 1 ? 'Spur' : 'Spuren'}), mit Spur-Lautstärke, ohne Mute/Solo. Alle gleich lang – direkt in Ableton ziehen.`
            : 'Im Exportbereich liegen keine Clips.'}
        </Txt>
        <View style={s.row}>
          <Btn disabled={busy || !tracks.length} onPress={() => void run(exportStems)}>
            Stems (ZIP)
          </Btn>
        </View>
      </Section>
    </Sheet>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row' },
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 6 },
});
