import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { engine } from '../audio/engine';
import { C, font } from '../constants/theme';
import { setCursor, togglePlay } from '../lib/actions';
import { requestPlan } from '../lib/aiArrange';
import { arrange, type ArrangeResult } from '../lib/arranger';
import { fetchMissingFx, type FxSources } from '../lib/fxDrive';
import { spliceAvailable } from '../lib/splice';
import { planSections, type ArrangePlan } from '../lib/arrangePlan';
import { errorText, getState, setState, toast, updateProject, useStore } from '../lib/store';
import { confirmDestructive } from './confirm';
import { Btn, Chip, Section, Txt } from './kit';
import { Sheet } from './Sheet';

// Where the AI may take sounds from; kept while the app runs. Splice is off by default (the first download costs a credit).
let chosenSources: FxSources = { library: true, drive: true, splice: false };

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
  const [sources, setSources] = useState<FxSources>(chosenSources);
  const [notes, setNotes] = useState<string[]>([]);
  const toggle = (k: keyof FxSources) => {
    const next = { ...sources, [k]: !sources[k] };
    if (!next.library && !next.drive && !next.splice) return; // at least one source
    chosenSources = next;
    setSources(next);
  };

  const apply = async (p: ArrangePlan) => {
    const fxOnly = p.scope === 'fx_only';
    if (engine.playing) engine.stop();
    // Sounds that are not in the library yet are looked up in the user's Drive and imported first.
    const got = await fetchMissingFx(p.fx, getState().project, sources, (name) => confirmDestructive(`„${name}“ von Splice laden?`, 'Der erste Download eines Sounds kostet einen Splice-Credit, danach ist er kostenlos.', 'Laden'));
    setNotes(got.notes);
    const fromDrive = got.loaded;
    const pool = sources.library ? getState().samples : got.pool;
    // A full plan may set tempo and key; they change with the arrangement (one undo step).
    const current = getState().project;
    const source = fxOnly ? current : { ...current, bpm: p.bpm ?? current.bpm, key: p.key ?? current.key, ...(p.key && p.key !== current.key ? { scale: undefined } : {}) };
    const result = arrange(source, pool, {
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
    toast(lacking.length ? `Fertig. Keine passenden Samples für: ${lacking.join(', ')}` : fromDrive.length ? `Fertig, neu geladen: ${fromDrive.map((x) => x.name).join(', ')}` : 'Fertig');
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
      await apply(next);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const again = async () => {
    if (!plan) return;
    try {
      await apply(plan);
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

      <View style={s.chips}>
        <Txt style={[s.note, { marginBottom: 0 }]}>Sounds aus:</Txt>
        <Chip variant={sources.library ? 'on' : 'ghost'} onPress={() => toggle('library')} accessibilityLabel="Quelle Library">
          Library
        </Chip>
        <Chip variant={sources.drive ? 'on' : 'ghost'} onPress={() => toggle('drive')} accessibilityLabel="Quelle Google Drive">
          Google Drive
        </Chip>
        {spliceAvailable() && (
          <Chip variant={sources.splice ? 'on' : 'ghost'} onPress={() => toggle('splice')} accessibilityLabel="Quelle Splice">
            Splice
          </Chip>
        )}
      </View>
      {sources.splice && <Txt style={s.note}>Splice: der erste Download eines Sounds kostet einen Credit, die App fragt vorher.</Txt>}

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
          <Btn accessibilityLabel={fxOnly ? 'Anderes Sample' : 'Anderes Ergebnis'} disabled={busy} onPress={() => void again()}>
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
          {/* For single additions only what the app really did counts (the model's own summary may promise more). */}
          {plan.summary && !fxOnly ? <Txt style={[s.note, { color: C.text }]}>{plan.summary}</Txt> : null}
          {last?.fx.map((f) => (
            <Txt key={`${f.track}${f.bar}`} style={s.note}>{`✓ ${f.track}: „${f.sample}“ ab Takt ${f.bar}${f.bars > 4 ? `, ${f.bars} Takte` : ''}`}</Txt>
          ))}
          {last && !fxOnly && last.added.length > 0 && <Txt style={s.note}>{`Neue Spuren: ${last.added.join(', ')}.`}</Txt>}
          {last && last.fxMissing.length > 0 && (
            <Txt style={[s.note, { color: C.danger }]}>{`Kein Sample in deiner Library gefunden für: ${last.fxMissing.join(', ')}. Probier ein anderes Wort (z. B. „Boom“ statt „Impact“) oder schreib den Sample-Namen in die Anfrage.`}</Txt>
          )}
          {last && !fxOnly && last.missingSamples.length > 0 && <Txt style={[s.note, { color: C.muted }]}>{`Ohne passende Library-Samples geblieben: ${last.missingSamples.join(', ')}.`}</Txt>}
          {notes.map((n) => (
            <Txt key={n} style={[s.note, { color: C.muted }]}>{n}</Txt>
          ))}
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
