import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { C } from '../constants/theme';
import { setCursor } from '../lib/actions';
import { structureText } from '../lib/referenceArrange';
import { buildKick, rebuildWithOriginalStems, splitDrumsAudio, stemTunes } from '../lib/referenceRun';
import { errorText, setState, toast, useStore } from '../lib/store';
import { DEFAULT_KICK, type KickDesign } from '../lib/drumSplit';
import { Btn, Chip, Section, Txt } from './kit';
import { Knob, KnobRow } from './synth/Knob';

/** "Aufbau von einem Tune": the structure of a tune whose stems are in the library, rebuilt with the project's own tracks. */
export function ReferenceRebuild() {
  const samples = useStore((st) => st.samples);
  const tunes = stemTunes(samples);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [design, setDesign] = useState<KickDesign>(DEFAULT_KICK);
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
      return `✓ „${tune}“ aus den Original-Stems nachgebaut (${r.bpm} BPM${r.offsetSec > 0.02 ? `, Takt 1 beginnt bei ${r.offsetSec.toFixed(2).replace('.', ',')} s` : ''}): ${structureText(r.sections)}. Spuren: ${r.tracks.join(', ')}${r.split ? '. Die Drums wurden dafür zuerst per Filter in Kick und Top Loop geteilt (Library, Ordner des Tunes).' : ''}`;
    });
  const build = (folder: string, tune: string) =>
    void work(`${folder}#kick`, async () => {
      const k = await buildKick(folder, design);
      return `✓ „${tune}“: neue Kick „${k.name}“ gebaut (Library, Ordner des Tunes). Hör sie dir dort mit ▶ an oder zieh sie auf eine Spur.`;
    });
  const split = (folder: string, tune: string) =>
    void work(`${folder}#split`, async () => {
      const r = await splitDrumsAudio(folder);
      return `✓ „${tune}“: Drums aufgeteilt in ${r.map((x) => x.name.split(' - ').pop()!.replace(/\.wav$/, '')).join(', ')} (Library, Ordner des Tunes)`;
    });

  return (
    <Section title="Aufbau von einem Tune nachbauen" style={{ marginTop: 12 }}>
      <Txt style={s.note}>
        Die App hört in die Stems eines Tunes (Library → Stems trennen). „Aufbau nachbauen“ erkennt Intro, Build-up, Drop, Break und Outro und legt die Original-Stems des Tunes auf eigene Spuren, jeweils nur dort, wo sie im Tune spielen. Die Drums kommen einzeln (Kick und Top Loop), wenn sie getrennt in der Library liegen, sonst teilt die App sie vorher. „Drums → Kick / Top Loop“ holt die Kick (Rumble, Body und Klick, nur auf den Beats) aus den Drums, der Top Loop ist der Rest. Beide zusammen ergeben wieder genau die Original-Drums.
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
                  {busy === `${t.folder}#split` ? 'teilt auf …' : 'Drums → Kick / Top Loop'}
                </Chip>
                <Chip variant={editing === t.folder ? 'on' : 'ghost'} onPress={() => setEditing(editing === t.folder ? null : t.folder)} accessibilityLabel={`Kick von ${t.tune} bearbeiten`}>
                  Kick bearbeiten
                </Chip>
              </View>
              {editing === t.folder && (
                <View>
                  <Txt style={s.note}>
                    Die Kick besteht aus drei Teilen: Rumble (unter 150 Hz, volle Länge), Body (150–600 Hz, nach jedem Kick auf dem Beat, mit Fade-out) und Klick (über 600 Hz, nur die ersten Millisekunden). Stell die Teile ein und drück „Kick bauen“: die drei Teile werden zu einer neuen Kick kombiniert, genauso lang wie der Drums-Stem. Die Kick und der Top Loop vom Trennen bleiben unverändert.
                  </Txt>
                  <KnobRow>
                    <Knob label="Rumble" value={design.rumbleDb} min={-24} max={12} step={0.5} reset={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => setDesign((d) => ({ ...d, rumbleDb: v }))} />
                    <Knob label="Body" value={design.bodyDb} min={-24} max={12} step={0.5} reset={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => setDesign((d) => ({ ...d, bodyDb: v }))} />
                    <Knob label="Body-Länge" value={design.bodyMs} min={40} max={300} step={5} reset={DEFAULT_KICK.bodyMs} format={(v) => `${Math.round(v)} ms`} onChange={(v) => setDesign((d) => ({ ...d, bodyMs: v }))} />
                    <Knob label="Klick" value={design.clickDb} min={-24} max={12} step={0.5} reset={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} onChange={(v) => setDesign((d) => ({ ...d, clickDb: v }))} />
                    <Knob label="Klick-Länge" value={design.clickMs} min={2} max={20} step={1} reset={DEFAULT_KICK.clickMs} format={(v) => `${Math.round(v)} ms`} onChange={(v) => setDesign((d) => ({ ...d, clickMs: v }))} />
                  </KnobRow>
                  <View style={s.row}>
                    <Chip variant={busy === `${t.folder}#kick` ? 'on' : 'ghost'} onPress={() => (busy ? undefined : build(t.folder, t.tune))} accessibilityLabel={`Kick von ${t.tune} bauen`}>
                      {busy === `${t.folder}#kick` ? 'baut …' : 'Kick bauen'}
                    </Chip>
                    <Chip variant="ghost" onPress={() => setDesign(DEFAULT_KICK)} accessibilityLabel="Kick-Regler zurücksetzen">
                      Zurücksetzen
                    </Chip>
                  </View>
                </View>
              )}
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
