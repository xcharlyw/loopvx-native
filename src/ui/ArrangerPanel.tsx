import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { engine } from '../audio/engine';
import { C, font, mono } from '../constants/theme';
import { setCursor, togglePlay } from '../lib/actions';
import { arrange, sectionsFor, type ArrangeLength, type ArrangeResult } from '../lib/arranger';
import { errorText, getState, setState, toast, updateProject, useStore } from '../lib/store';
import { confirmDestructive } from './confirm';
import { Btn, Chip, Section, Txt } from './kit';
import { Sheet } from './Sheet';

/**
 * "Arrangement erzeugen": lays out intro, build-up, drop, break, second drop and outro from the project's tracks and the
 * library, with MIDI grooves and automation. Rule based, not a language model: a new roll gives another variation.
 */
export function ArrangerPanel() {
  const project = useStore((st) => st.project);
  const samples = useStore((st) => st.samples);
  const [length, setLength] = useState<ArrangeLength>(128);
  const [addMissing, setAddMissing] = useState(true);
  const [automation, setAutomation] = useState(true);
  const [last, setLast] = useState<ArrangeResult | null>(null);
  const [rolls, setRolls] = useState(0);

  const sections = sectionsFor(length);
  const hasClips = project.tracks.some((t) => t.clips.length > 0);

  const run = async () => {
    if (hasClips && !last) {
      const ok = await confirmDestructive('Vorhandene Clips ersetzen?', 'Das Arrangement ersetzt die Clips aller Spuren, die es belegt. Mit „Rückgängig“ (↩) bekommst du dein altes Arrangement zurück.', 'Ersetzen');
      if (!ok) return;
    }
    try {
      if (engine.playing) engine.stop();
      const result = arrange(getState().project, getState().samples, { length, seed: Math.floor(Math.random() * 2 ** 31), addMissingTracks: addMissing, automation });
      updateProject(() => result.project);
      setLast(result);
      setRolls((n) => n + 1);
      setCursor(0);
      toast(result.missingSamples.length ? `Arrangement erzeugt. Keine passenden Samples für: ${result.missingSamples.join(', ')}` : 'Arrangement erzeugt');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const listen = () => {
    setState({ panel: 'none' });
    setCursor(0);
    void togglePlay();
  };

  return (
    <Sheet title="Arrangement">
      <Txt style={s.note}>
        {`Legt ein ganzes Hard-Techno-Stück an (${project.bpm} BPM, ${project.key}): Intro, Build-up, Drop, Break, zweiter Drop und Outro. Es nutzt deine Spuren und passende Samples aus der Library (Tempo und Tonart) und füllt den Rest mit MIDI-Grooves. Das ist ein Regelwerk mit Zufall, keine KI: jedes Würfeln ergibt eine andere Variante.`}
      </Txt>

      <Section title="Länge">
        <View style={s.chips}>
          {([64, 128] as const).map((n) => (
            <Chip key={n} variant={length === n ? 'on' : 'ghost'} accessibilityLabel={`${n} Takte`} onPress={() => setLength(n)}>
              {`${n} Takte`}
            </Chip>
          ))}
        </View>
        <View style={s.sections}>
          {sections.map((sec) => (
            <View key={sec.id} style={s.sec}>
              <Txt style={s.secName}>{sec.label}</Txt>
              <Txt style={s.secBars}>{`Takt ${sec.start + 1}–${sec.start + sec.bars}`}</Txt>
            </View>
          ))}
        </View>
      </Section>

      <Section title="Optionen" style={{ marginTop: 12 }}>
        <View style={s.chips}>
          <Chip variant={addMissing ? 'on' : 'ghost'} accessibilityLabel="Fehlende Spuren anlegen" onPress={() => setAddMissing(!addMissing)}>
            Fehlende Spuren anlegen
          </Chip>
          <Chip variant={automation ? 'on' : 'ghost'} accessibilityLabel="Automationen" onPress={() => setAutomation(!automation)}>
            Automationen
          </Chip>
        </View>
        <Txt style={s.note}>
          {`Spuren: 909-Drums, Rumble-Bass, Lead und Pad, wo es sie noch nicht gibt. Automationen: Filter öffnet in den Build-ups, Hall-Wurf vor dem Drop, Drive-Anstieg im Bass, Ausblenden am Ende.`}
        </Txt>
      </Section>

      <View style={[s.chips, { marginTop: 14 }]}>
        <Btn kind="primary" accessibilityLabel="Arrangement erzeugen" onPress={() => void run()}>
          {rolls ? 'Neu würfeln' : 'Arrangement erzeugen'}
        </Btn>
        {last && (
          <Btn accessibilityLabel="Arrangement anhören" onPress={listen}>
            Anhören
          </Btn>
        )}
      </View>

      {last && (
        <Section title="Ergebnis" style={{ marginTop: 12 }}>
          <Txt style={s.note}>{last.added.length ? `Neue Spuren: ${last.added.join(', ')}.` : 'Keine neuen Spuren.'}</Txt>
          {last.missingSamples.length > 0 && <Txt style={[s.note, { color: C.muted }]}>{`Ohne passende Library-Samples geblieben: ${last.missingSamples.join(', ')}. Importiere Loops mit passendem Tempo (±8 BPM) und Tonart, dann nochmal würfeln.`}</Txt>}
          <Txt style={s.note}>Noten und Automation lassen sich danach in der Piano Roll und unter „Spur bearbeiten → Automation“ ändern.</Txt>
        </Section>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8, alignItems: 'center' },
  sections: { gap: 4 },
  sec: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  secName: { ...font(600), fontSize: 13 },
  secBars: { ...mono(), fontSize: 11, color: C.muted },
});
