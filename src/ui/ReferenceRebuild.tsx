import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { C } from '../constants/theme';
import { setCursor } from '../lib/actions';
import { structureText } from '../lib/referenceArrange';
import { drumsToMidi, rebuildFromStems, splitDrumsAudio, stemTunes } from '../lib/referenceRun';
import { errorText, getState, setState, toast, useStore } from '../lib/store';
import { confirmDestructive } from './confirm';
import { Btn, Chip, Section, Txt } from './kit';

/** "Aufbau von einem Tune": the structure of a tune whose stems are in the library, rebuilt with the project's own tracks. */
export function ReferenceRebuild() {
  const samples = useStore((st) => st.samples);
  const tunes = stemTunes(samples);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ tune: string; text: string; bpm: number; added: string[] } | null>(null);
  const [lines, setLines] = useState<string[]>([]);

  const work = async (key: string, job: () => Promise<string>) => {
    setBusy(key);
    try {
      const line = await job();
      setLines((l) => [line, ...l].slice(0, 4));
      toast(line);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const midi = (folder: string, tune: string) =>
    void work(`${folder}#midi`, async () => {
      const r = await drumsToMidi(folder);
      return `✓ „${tune}“: Drums als MIDI auf Spur „${r.track}“ (${r.notes} Schläge, ${r.bars} Takte, Raster ${r.bpm} BPM)`;
    });
  const split = (folder: string, tune: string) =>
    void work(`${folder}#split`, async () => {
      const r = await splitDrumsAudio(folder);
      return `✓ „${tune}“: Drums aufgeteilt in ${r.map((x) => x.name.split(' - ').pop()!.replace(/\.wav$/, '')).join(', ')} (Library, Ordner des Tunes)`;
    });

  const go = async (folder: string, tune: string) => {
    if (getState().project.tracks.some((t) => t.clips.length > 0)) {
      const ok = await confirmDestructive(`Aufbau von „${tune}“ übernehmen?`, 'Das ersetzt die Clips der Spuren, die es belegt. Mit „Rückgängig“ (↩) bekommst du dein altes Arrangement zurück.', 'Übernehmen');
      if (!ok) return;
    }
    setBusy(folder);
    try {
      const r = await rebuildFromStems(folder);
      setCursor(0);
      setDone({ tune, text: structureText(r.sections), bpm: r.bpm, added: r.result.added });
      toast(`Aufbau von „${tune}“ übernommen`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Aufbau von einem Tune nachbauen" style={{ marginTop: 12 }}>
      <Txt style={s.note}>
        Die App hört in die Stems eines Tunes (Library → Stems trennen). „Aufbau nachbauen“ erkennt Intro, Build-up, Drop, Break und Outro und baut sie mit deinen Spuren nach. „Drums → MIDI“ schreibt Kick, Clap und HiHats als MIDI auf eine neue 909-Spur. „Drums → Kick / Clap / HiHats“ teilt den Drum-Stem per Filter in drei Audio-Spuren (nicht ganz sauber getrennt).
      </Txt>
      {tunes.length === 0 ? (
        <View style={s.row}>
          <Btn small onPress={() => setState({ panel: 'library' })}>Erst einen Tune in Stems trennen</Btn>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {tunes.map((t) => (
            <View key={t.folder} style={s.tune}>
              <Txt style={s.tuneName} numberOfLines={1}>
                {t.tune}
              </Txt>
              <View style={s.row}>
                <Chip variant={busy === t.folder ? 'on' : 'ghost'} onPress={() => (busy ? undefined : void go(t.folder, t.tune))} accessibilityLabel={`Aufbau von ${t.tune} übernehmen`}>
                  {busy === t.folder ? 'hört rein …' : 'Aufbau nachbauen'}
                </Chip>
                <Chip variant={busy === `${t.folder}#midi` ? 'on' : 'ghost'} onPress={() => (busy ? undefined : midi(t.folder, t.tune))} accessibilityLabel={`Drums von ${t.tune} als MIDI`}>
                  {busy === `${t.folder}#midi` ? 'erkennt Drums …' : 'Drums → MIDI'}
                </Chip>
                <Chip variant={busy === `${t.folder}#split` ? 'on' : 'ghost'} onPress={() => (busy ? undefined : split(t.folder, t.tune))} accessibilityLabel={`Drums von ${t.tune} aufteilen`}>
                  {busy === `${t.folder}#split` ? 'teilt auf …' : 'Drums → Kick / Clap / HiHats'}
                </Chip>
              </View>
            </View>
          ))}
        </View>
      )}
      {lines.map((l) => (
        <Txt key={l} style={[s.note, { color: C.text, marginTop: 6 }]}>
          {l}
        </Txt>
      ))}
      {done && (
        <>
          <Txt style={[s.note, { color: C.text, marginTop: 8 }]}>{`✓ „${done.tune}“ (${done.bpm} BPM): ${done.text}`}</Txt>
          {done.added.length > 0 && <Txt style={s.note}>{`Neue Spuren: ${done.added.join(', ')}.`}</Txt>}
        </>
      )}
    </Section>
  );
}

const s = StyleSheet.create({
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tune: { gap: 6 },
  tuneName: { color: C.text, fontSize: 13 },
});
