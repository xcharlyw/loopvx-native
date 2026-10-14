import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { engine } from '../audio/engine';
import { C, font } from '../constants/theme';
import { setCursor, togglePlay } from '../lib/actions';
import { requestPlan } from '../lib/aiArrange';
import { arrange, type ArrangeResult } from '../lib/arranger';
import { planSections, type ArrangePlan } from '../lib/arrangePlan';
import { errorText, getState, setState, toast, updateProject, useStore } from '../lib/store';
import { confirmDestructive } from './confirm';
import { Btn, Section, Txt } from './kit';
import { Sheet } from './Sheet';

/**
 * One step: the text goes to Gemini, which answers with a plan (`requestPlan`), and the app applies it right away. A request for
 * single additions ("Impact FX bei Takt 65") only places those; a request for an arrangement lays out the whole track from the
 * project's tracks and the library (rule based, "Anderes Ergebnis" rolls another variation). Everything is one undo step.
 */
export function ArrangerPanel() {
  const project = useStore((st) => st.project);
  const [last, setLast] = useState<ArrangeResult | null>(null);
  const [prompt, setPrompt] = useState('');
  const [plan, setPlan] = useState<ArrangePlan | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (p: ArrangePlan) => {
    const fxOnly = p.scope === 'fx_only';
    if (engine.playing) engine.stop();
    // A full plan may set tempo and key; they change with the arrangement (one undo step).
    const current = getState().project;
    const source = fxOnly ? current : { ...current, bpm: p.bpm ?? current.bpm, key: p.key ?? current.key, ...(p.key && p.key !== current.key ? { scale: undefined } : {}) };
    const result = arrange(source, getState().samples, {
      seed: Math.floor(Math.random() * 2 ** 31),
      addMissingTracks: true,
      automation: p.automation,
      sections: planSections(p),
      styles: p.styles,
      addRoles: p.addRoles,
      fx: p.fx,
      fxOnly,
    });
    updateProject(() => result.project);
    setLast(result);
    if (!fxOnly) setCursor(0);
    const lacking = [...result.missingSamples, ...result.fxMissing];
    toast(lacking.length ? `Fertig. Keine passenden Samples für: ${lacking.join(', ')}` : 'Fertig');
  };

  const go = async () => {
    setBusy(true);
    try {
      const next = await requestPlan(prompt, getState().project, getState().samples);
      setPlan(next);
      setLast(null);
      // Only a whole new arrangement replaces clips: ask first (after the AI has said what it would do).
      if (next.scope === 'full' && getState().project.tracks.some((t) => t.clips.length > 0)) {
        const ok = await confirmDestructive('Vorhandene Clips ersetzen?', `${next.summary ?? 'Die KI plant ein neues Arrangement.'}\n\nDas ersetzt die Clips der Spuren, die es belegt. Mit „Rückgängig“ (↩) bekommst du dein altes Arrangement zurück.`, 'Ersetzen');
        if (!ok) return;
      }
      apply(next);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    if (!plan) return;
    try {
      apply(plan);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const listen = () => {
    setState({ panel: 'none' });
    setCursor(0);
    void togglePlay();
  };

  const fxOnly = plan?.scope === 'fx_only';
  return (
    <Sheet title="Arrangement">
      <Txt style={s.note}>
        {`Schreib, was die KI machen soll (${project.bpm} BPM, ${project.key}). Sie setzt es sofort um, z. B. „Impact FX bei Takt 65 auf neuer Spur“ oder „baue ein 128-Takte-Arrangement mit langem Break“. Mit „Rückgängig“ (↩) nimmst du alles zurück.`}
      </Txt>

      <View style={s.promptBox}>
        <TextInput
          style={s.input}
          multiline
          placeholder="Was soll die KI machen?"
          placeholderTextColor={C.dim}
          value={prompt}
          onChangeText={setPrompt}
          accessibilityLabel="Beschreibung für die KI"
        />
      </View>
      <View style={s.chips}>
        <Btn kind="primary" disabled={busy || !prompt.trim()} accessibilityLabel="KI ausführen" onPress={() => void go()}>
          {busy ? <ActivityIndicator size="small" color={C.accentInk} /> : null}
          {busy ? 'KI arbeitet …' : 'Ausführen'}
        </Btn>
        {last && (
          <Btn accessibilityLabel={fxOnly ? 'Anderes Sample' : 'Anderes Ergebnis'} disabled={busy} onPress={again}>
            {fxOnly ? 'Anderes Sample' : 'Anderes Ergebnis'}
          </Btn>
        )}
        {last && !fxOnly && (
          <Btn accessibilityLabel="Arrangement anhören" onPress={listen}>
            Anhören
          </Btn>
        )}
      </View>

      {plan && (
        <Section title="Ergebnis" style={{ marginTop: 12 }}>
          {plan.summary ? <Txt style={[s.note, { color: C.text }]}>{plan.summary}</Txt> : null}
          {last?.fx.map((f) => (
            <Txt key={`${f.track}${f.bar}`} style={s.note}>{`✓ ${f.track}: „${f.sample}“ bei Takt ${f.bar}`}</Txt>
          ))}
          {last && !fxOnly && last.added.length > 0 && <Txt style={s.note}>{`Neue Spuren: ${last.added.join(', ')}.`}</Txt>}
          {last && last.fxMissing.length > 0 && (
            <Txt style={[s.note, { color: C.danger }]}>{`Kein Sample in deiner Library gefunden für: ${last.fxMissing.join(', ')}. Probier ein anderes Wort (z. B. „Boom“ statt „Impact“) oder schreib den Sample-Namen in die Anfrage.`}</Txt>
          )}
          {last && !fxOnly && last.missingSamples.length > 0 && <Txt style={[s.note, { color: C.muted }]}>{`Ohne passende Library-Samples geblieben: ${last.missingSamples.join(', ')}.`}</Txt>}
          {plan.notes?.map((n) => (
            <Txt key={n} style={[s.note, { color: C.muted }]}>{`Nicht umgesetzt: ${n}`}</Txt>
          ))}
          {plan.model ? <Txt style={[s.note, { color: C.dim }]}>{`Geplant mit ${plan.model}${/lite/i.test(plan.model) ? ' (Leichtmodell, weil das große gerade ausgelastet war: nochmal „Ausführen“ versucht es erneut)' : ''}.`}</Txt> : null}
        </Section>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8, alignItems: 'center' },
  promptBox: { borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: C.bg2, padding: 10, marginBottom: 8 },
  input: { color: C.text, ...font(400), fontSize: 14, minHeight: 54, padding: 0, outlineWidth: 0, textAlignVertical: 'top' },
});
