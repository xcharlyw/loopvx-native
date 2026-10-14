import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { engine } from '../audio/engine';
import { C, font, mono } from '../constants/theme';
import { setCursor, togglePlay } from '../lib/actions';
import { requestPlan } from '../lib/aiArrange';
import { arrange, FX_TRACK, type ArrangeResult } from '../lib/arranger';
import { planSections, type ArrangePlan } from '../lib/arrangePlan';
import { errorText, getState, setState, toast, updateProject, useStore } from '../lib/store';
import { confirmDestructive } from './confirm';
import { Btn, Chip, Section, Txt } from './kit';
import { Sheet } from './Sheet';

/**
 * Arrangement from a text: Gemini plans the structure (`requestPlan`), then "Arrangement erzeugen" lays it out from the
 * project's tracks and the library with MIDI grooves and automation (rule based, a new roll gives another variation).
 * There is no plan-less default any more: the plan decides the sections.
 */
export function ArrangerPanel() {
  const project = useStore((st) => st.project);
  const samples = useStore((st) => st.samples);
  const [addMissing, setAddMissing] = useState(true);
  const [automation, setAutomation] = useState(true);
  const [last, setLast] = useState<ArrangeResult | null>(null);
  const [rolls, setRolls] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [plan, setPlan] = useState<ArrangePlan | null>(null);
  const [thinking, setThinking] = useState(false);

  const sections = plan ? planSections(plan) : [];
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
    if (!plan) return;
    if (hasClips && !last) {
      const ok = await confirmDestructive('Vorhandene Clips ersetzen?', 'Das Arrangement ersetzt die Clips aller Spuren, die es belegt. Mit „Rückgängig“ (↩) bekommst du dein altes Arrangement zurück.', 'Ersetzen');
      if (!ok) return;
    }
    try {
      if (engine.playing) engine.stop();
      // A plan may set tempo and key; they change with the arrangement (one undo step).
      const current = getState().project;
      const source = { ...current, bpm: plan.bpm ?? current.bpm, key: plan.key ?? current.key, ...(plan.key && plan.key !== current.key ? { scale: undefined } : {}) };
      const result = arrange(source, getState().samples, {
        seed: Math.floor(Math.random() * 2 ** 31),
        addMissingTracks: addMissing,
        automation: plan.automation && automation,
        sections,
        styles: plan?.styles,
        addRoles: plan?.addRoles,
        fx: plan.fx,
      });
      updateProject(() => result.project);
      setLast(result);
      setRolls((n) => n + 1);
      setCursor(0);
      const lacking = [...result.missingSamples, ...result.fxMissing];
      toast(lacking.length ? `Arrangement erzeugt. Keine passenden Samples für: ${lacking.join(', ')}` : 'Arrangement erzeugt');
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
        {`Beschreibe dein Hard-Techno-Stück (${project.bpm} BPM, ${project.key}). Die KI plant den Aufbau, danach legt die App Clips, MIDI-Grooves und Automationen aus deinen Spuren und passenden Library-Samples an.`}
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
          <Txt style={s.note}>Z. B. Länge, Tempo, Stimmung, wo Bass oder Lead fehlen sollen, oder „Impact FX bei Takt 65 auf neuer Spur“. Braucht die Anmeldung mit Google.</Txt>
        )}
        {plan?.model ? <Txt style={[s.note, { color: C.dim }]}>{`Geplant mit ${plan.model}${/lite/i.test(plan.model) ? ' (Leichtmodell, weil das große gerade ausgelastet war: „Neu planen“ versucht es nochmal)' : ''}.`}</Txt> : null}
      </Section>

      {plan?.notes?.length ? (
        <Section title="Nicht umgesetzt" style={{ marginTop: 12 }}>
          {plan.notes.map((n) => (
            <Txt key={n} style={[s.note, { color: C.muted }]}>{`• ${n}`}</Txt>
          ))}
        </Section>
      ) : null}

      {plan?.fx.length ? (
        <Section title="Effekt-Sounds aus deiner Library" style={{ marginTop: 12 }}>
          <View style={s.sections}>
            {plan.fx.map((f, i) => (
              <View key={`${f.kind}${f.bar}${i}`} style={s.sec}>
                <Txt style={s.secName}>{`${f.track ?? FX_TRACK[f.kind]} · neue Spur`}</Txt>
                <Txt style={s.secBars}>{`Takt ${f.bar + 1}`}</Txt>
              </View>
            ))}
          </View>
          <Txt style={s.note}>Das Sample sucht die App beim Erzeugen in deiner Library (nach dem Namen, den die KI vorgibt, und typischen Wörtern wie „impact“, „hit“, „riser“).</Txt>
        </Section>
      ) : null}

      {plan && (
        <Section title={`Aufbau · ${totalBars} Takte`} style={{ marginTop: 12 }}>
          <View style={s.sections}>
            {sections.map((sec) => (
              <View key={sec.id + sec.start} style={s.sec}>
                <Txt style={s.secName}>{sec.mute?.length ? `${sec.label} · ohne ${sec.mute.map((r) => ROLE_DE[r]).join(', ')}` : sec.label}</Txt>
                <Txt style={s.secBars}>{`Takt ${sec.start + 1}–${sec.start + sec.bars}`}</Txt>
              </View>
            ))}
          </View>
        </Section>
      )}

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
        <Btn kind="primary" disabled={!plan} accessibilityLabel="Arrangement erzeugen" onPress={() => void run()}>
          {rolls ? 'Neu würfeln' : plan ? 'Arrangement erzeugen' : 'Zuerst mit KI planen'}
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
          {last.fx.map((f) => (
            <Txt key={`${f.track}${f.bar}`} style={s.note}>{`✓ ${f.track}: „${f.sample}“ bei Takt ${f.bar}`}</Txt>
          ))}
          {last.fxMissing.length > 0 && (
            <Txt style={[s.note, { color: C.danger }]}>{`Kein passendes Sample gefunden für: ${last.fxMissing.join(', ')}. Schreib den Sample-Namen in die Beschreibung (z. B. „Impact FX mit dem Sample ‚SSE Pattern 05 Perc FX‘“) und plane neu.`}</Txt>
          )}
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
