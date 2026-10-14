import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { C } from '../constants/theme';
import { setCursor } from '../lib/actions';
import { structureText } from '../lib/referenceArrange';
import { rebuildFromStems, stemTunes } from '../lib/referenceRun';
import { errorText, getState, setState, toast, useStore } from '../lib/store';
import { confirmDestructive } from './confirm';
import { Btn, Chip, Section, Txt } from './kit';

/** "Aufbau von einem Tune": the structure of a tune whose stems are in the library, rebuilt with the project's own tracks. */
export function ReferenceRebuild() {
  const samples = useStore((st) => st.samples);
  const tunes = stemTunes(samples);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ tune: string; text: string; bpm: number; added: string[] } | null>(null);

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
        Die App hört in die Stems eines Tunes (Library → Stems trennen), erkennt Intro, Build-up, Drop, Break und Outro und wo Drums, Bass, Synth und Vocal spielen, und baut diesen Aufbau mit deinen Spuren und Sounds nach.
      </Txt>
      {tunes.length === 0 ? (
        <View style={s.row}>
          <Btn small onPress={() => setState({ panel: 'library' })}>Erst einen Tune in Stems trennen</Btn>
        </View>
      ) : (
        <View style={s.row}>
          {tunes.map((t) => (
            <Chip key={t.folder} variant={busy === t.folder ? 'on' : 'ghost'} onPress={() => (busy ? undefined : void go(t.folder, t.tune))} accessibilityLabel={`Aufbau von ${t.tune} übernehmen`}>
              {busy === t.folder ? `${t.tune}: hört rein …` : t.tune}
            </Chip>
          ))}
        </View>
      )}
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
});
