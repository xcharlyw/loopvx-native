import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { C } from '../constants/theme';
import { canShareFiles, exportForAbleton, exportRegion, exportStems, exportWav, renderMixdown, shareMixdown } from '../lib/actions';
import { useStore } from '../lib/store';
import { Export } from './icons';
import { Btn, Section, Txt } from './kit';
import { Sheet } from './Sheet';

/** Mixdown or stems of the loop region (or the whole arrangement when the loop is off). */
export function ExportPanel() {
  const project = useStore((st) => st.project);
  const [busy, setBusy] = useState(false);
  // A rendered mixdown waiting for the "Jetzt teilen" tap (the share sheet needs a fresh gesture), with the project it was made of.
  const [ready, setReady] = useState<{ data: Uint8Array; name: string; of: typeof project } | null>(null);
  const shared = ready && ready.of === project ? ready : null;
  const native = Platform.OS !== 'web';
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
          {shared ? (
            <Btn kind="primary" accessibilityLabel="Mixdown jetzt teilen" onPress={() => void shareMixdown(shared).then(() => setReady(null))}>
              Jetzt teilen
            </Btn>
          ) : (
            <Btn
              disabled={busy}
              accessibilityLabel="Mixdown teilen"
              onPress={() =>
                void run(async () => {
                  const mix = await renderMixdown();
                  if (!mix) return;
                  // Native opens the share sheet right away; a browser needs a second tap.
                  if (native) await shareMixdown(mix);
                  else setReady({ ...mix, of: project });
                })
              }
            >
              Teilen
            </Btn>
          )}
        </View>
        <Txt style={s.note}>
          {shared
            ? `${shared.name} ist fertig – tippe auf „Jetzt teilen“.`
            : native || canShareFiles()
              ? 'Teilen: WhatsApp, AirDrop, Mail … direkt vom Handy.'
              : 'Teilen: dieser Browser kann keine Dateien teilen, die WAV wird stattdessen geladen.'}
        </Txt>
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

      <Section title="Für Ableton Live">
        <Txt style={[s.note, { marginTop: 0, marginBottom: 10 }]}>
          Das ganze Arrangement (unabhängig vom Loop) als Live-12-Projektordner in einer ZIP: ein fertiges Live-Set (.als) mit Spuren, Clips, MIDI-Noten, Tempo, Markern, Lautstärken, Pan und Sends. Die Audiospuren kommen ohne LOOPVX-Effekte, damit du deine Ableton-Plugins davorsetzt; die MIDI-Spuren (Sequencer und Arpeggiator schon eingerechnet) haben noch keinen Synth. Dazu ein Referenz-Mixdown und „Projekt-Info.txt“ mit dem passenden Live-Gerät für jeden Effekt.
        </Txt>
        <View style={s.row}>
          <Btn disabled={busy || !project.tracks.some((t) => t.clips.length)} onPress={() => void run(exportForAbleton)}>
            Für Ableton (ZIP)
          </Btn>
        </View>
      </Section>
    </Sheet>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 6 },
});
