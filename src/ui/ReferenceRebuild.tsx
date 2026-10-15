import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { C } from '../constants/theme';
import { setCursor } from '../lib/actions';
import { structureText } from '../lib/referenceArrange';
import { rebuildWithOriginalStems, splitDrumsAudio, stemTunes } from '../lib/referenceRun';
import { errorText, setState, toast, useStore } from '../lib/store';
import { Btn, Chip, Section, Txt } from './kit';

/** "Aufbau von einem Tune": the structure of a tune whose stems are in the library, rebuilt with the project's own tracks. */
export function ReferenceRebuild() {
  const samples = useStore((st) => st.samples);
  const tunes = stemTunes(samples);
  const [busy, setBusy] = useState<string | null>(null);
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
  const original = (folder: string, tune: string) =>
    void work(`${folder}#orig`, async () => {
      const r = await rebuildWithOriginalStems(folder);
      setCursor(0);
      return `✓ „${tune}“ aus den Original-Stems nachgebaut (${r.bpm} BPM${r.offsetSec > 0.02 ? `, Takt 1 beginnt bei ${r.offsetSec.toFixed(2).replace('.', ',')} s` : ''}): ${structureText(r.sections)}. Spuren: ${r.tracks.join(', ')}${r.split ? '. Die Drums wurden dafür zuerst per Filter in Kick / Clap + Snare / HiHats geteilt (Library, Ordner des Tunes).' : ''}`;
    });
  const split = (folder: string, tune: string) =>
    void work(`${folder}#split`, async () => {
      const r = await splitDrumsAudio(folder);
      return `✓ „${tune}“: Drums aufgeteilt in ${r.map((x) => x.name.split(' - ').pop()!.replace(/\.wav$/, '')).join(', ')} (Library, Ordner des Tunes)`;
    });

  return (
    <Section title="Aufbau von einem Tune nachbauen" style={{ marginTop: 12 }}>
      <Txt style={s.note}>
        Die App hört in die Stems eines Tunes (Library → Stems trennen). „Aufbau nachbauen“ erkennt Intro, Build-up, Drop, Break und Outro und legt die Original-Stems des Tunes auf eigene Spuren, jeweils nur dort, wo sie im Tune spielen. Die Drums kommen einzeln (Kick, Clap, HiHats), wenn sie getrennt in der Library liegen, sonst teilt die App sie vorher. „Drums → Kick / Clap / HiHats“ teilt den Drum-Stem per Filter in drei Audio-Spuren (nicht ganz sauber getrennt).
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
                <Chip variant={busy === `${t.folder}#orig` ? 'on' : 'ghost'} onPress={() => (busy ? undefined : original(t.folder, t.tune))} accessibilityLabel={`${t.tune} aus den Original-Stems nachbauen`}>
                  {busy === `${t.folder}#orig` ? 'hört rein …' : 'Aufbau nachbauen'}
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
    </Section>
  );
}

const s = StyleSheet.create({
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tune: { gap: 6 },
  tuneName: { color: C.text, fontSize: 13 },
});
