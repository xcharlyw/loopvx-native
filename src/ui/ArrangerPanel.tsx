import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { engine } from '../audio/engine';
import { C, font, mono } from '../constants/theme';
import { setCursor, togglePlay } from '../lib/actions';
import { requestPlan } from '../lib/aiArrange';
import { arrange, sectionsFor, type ArrangeLength, type ArrangeResult } from '../lib/arranger';
import { planSections, type ArrangePlan } from '../lib/arrangePlan';
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
  const [prompt, setPrompt] = useState('');
  const [plan, setPlan] = useState<ArrangePlan | null>(null);
  const [thinking, setThinking] = useState(false);

  const sections = plan ? planSections(plan) : sectionsFor(length);
  const totalBars = sections.reduce((n, sec) => Math.max(n, sec.start + sec.bars), 0);

  const askAi = async () => {
    setThinking(true);
    try {
      const next = await requestPlan(prompt, getState().project, getState().samples);
      setPlan(next);
      setLast(null);
      setRolls(0);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setThinking(false);
    }
  };
  const hasClips = project.tracks.some((t) => t.clips.length > 0);

  const run = async () => {
    if (hasClips && !last) {
      const ok = await confirmDestructive('Vorhandene Clips ersetzen?', 'Das Arrangement ersetzt die Clips aller Spuren, die es belegt. Mit „Rückgängig“ (↩) bekommst du dein altes Arrangement zurück.', 'Ersetzen');
      if (!ok) return;
    }
    try {
      if (engine.playing) engine.stop();
      // A plan may set tempo and key; they change with the arrangement (one undo step).
      const current = getState().project;
      const source = plan ? { ...current, bpm: plan.bpm ?? current.bpm, key: plan.key ?? current.key, ...(plan.key && plan.key !== current.key ? { scale: undefined } : {}) } : current;
      const result = arrange(source, getState().samples, {
        length,
        seed: Math.floor(Math.random() * 2 ** 31),
        addMissingTracks: addMissing,
        automation: plan ? plan.automation && automation : automation,
        ...(plan ? { sections, styles: plan.styles, addRoles: plan.addRoles } : {}),
      });
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
        {`Legt ein ganzes Hard-Techno-Stück an (${project.bpm} BPM, ${project.key}): Intro, Build-up, Drop, Break, zweiter Drop und Outro. Es nutzt deine Spuren und passende Samples aus der Library (Tempo und Tonart) und füllt den Rest mit MIDI-Grooves. Ohne KI-Plan ist es ein Regelwerk mit Zufall: jedes Würfeln ergibt eine andere Variante.`}
      </Txt>

      <Section title="Mit KI (Gemini)">
        <View style={s.promptBox}>
          <TextInput
            style={s.input}
            multiline
            placeholder="Beschreibe das Stück, z. B. „düster, 160 BPM, langer Break ohne Bass, Acid im zweiten Drop“"
            placeholderTextColor={C.dim}
            value={prompt}
            onChangeText={setPrompt}
            accessibilityLabel="Beschreibung für die KI"
          />
        </View>
        <View style={s.chips}>
          <Btn kind={plan ? undefined : 'primary'} disabled={thinking || !prompt.trim()} accessibilityLabel="Mit KI planen" onPress={() => void askAi()}>
            {thinking ? <ActivityIndicator size="small" color={C.text} /> : null}
            {plan ? 'Neu planen' : 'Mit KI planen'}
          </Btn>
          {plan && (
            <Chip variant="ghost" accessibilityLabel="KI-Plan verwerfen" onPress={() => setPlan(null)}>
              Plan verwerfen
            </Chip>
          )}
        </View>
        {plan ? (
          <Txt style={[s.note, { color: C.text }]}>
            {[plan.summary, plan.bpm && plan.bpm !== project.bpm ? `Tempo → ${plan.bpm} BPM.` : '', plan.key && plan.key !== project.key ? `Tonart → ${plan.key}.` : ''].filter(Boolean).join(' ')}
          </Txt>
        ) : (
          <Txt style={s.note}>Die KI plant Aufbau, Längen und Stil; die Noten und Clips baut danach das Regelwerk. Braucht Anmeldung und den Gemini-Schlüssel auf dem Server.</Txt>
        )}
      </Section>

      <Section title={plan ? `Aufbau (KI) · ${totalBars} Takte` : 'Länge'} style={{ marginTop: 12 }}>
        {!plan && (
          <View style={s.chips}>
            {([64, 128] as const).map((n) => (
              <Chip key={n} variant={length === n ? 'on' : 'ghost'} accessibilityLabel={`${n} Takte`} onPress={() => setLength(n)}>
                {`${n} Takte`}
              </Chip>
            ))}
          </View>
        )}
        <View style={s.sections}>
          {sections.map((sec) => (
            <View key={sec.id} style={s.sec}>
              <Txt style={s.secName}>{sec.mute?.length ? `${sec.label} · ohne ${sec.mute.map((r) => ROLE_DE[r]).join(', ')}` : sec.label}</Txt>
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

const ROLE_DE: Record<string, string> = { drums: 'Drums', bass: 'Bass', lead: 'Lead', pad: 'Pad', kickLoop: 'Kick-Loop', topLoop: 'Top-Loop', synthLoop: 'Synth-Loop', vocal: 'Vocals' };

const s = StyleSheet.create({
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8, alignItems: 'center' },
  sections: { gap: 4 },
  sec: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  secName: { ...font(600), fontSize: 13 },
  secBars: { ...mono(), fontSize: 11, color: C.muted },
  promptBox: { borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: C.bg2, padding: 10, marginBottom: 8 },
  input: { color: C.text, ...font(400), fontSize: 14, minHeight: 54, padding: 0, outlineWidth: 0, textAlignVertical: 'top' },
});
