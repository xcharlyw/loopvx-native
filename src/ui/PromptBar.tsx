import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { C, font, mono } from '../constants/theme';
import { formatBarPosition } from '../audio/timing';
import { uid } from '../lib/project';
import { errorText, setState, toast, useStore } from '../lib/store';
import { db } from '../storage/db';
import { getSession } from '../lib/supabase';
import { generateVocal } from '../lib/vocals';
import { voiceSources } from '../lib/voiceClip';
import { presetVoice, removePreset, upsertPreset, type VocalPreset } from '../lib/vocalPresets';
import { cloneVoice, loadVoices, removeVoice, type Voice } from '../lib/voices';
import { useSmall } from './hooks';
import { ArrowUp, Close, Sparkle, Wave } from './icons';
import { Btn, Chip, IconBtn, Spacer, Txt } from './kit';
import { RecordButton } from './RecordButton';
import { Knob, KnobRow } from './synth/Knob';

const LENGTHS = [4, 8, 16, 32];

/** Suno-style floating prompt box for AI vocals, same layout as the original web app. */
export function PromptBar() {
  const project = useStore((st) => st.project);
  const cursor = useStore((st) => st.cursor);
  const { width } = useWindowDimensions();
  const small = useSmall();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [bars, setBars] = useState(8);
  const [vocalsOnly, setVocalsOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const samples = useStore((st) => st.samples);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [gender, setGender] = useState<'male' | 'female' | null>(null);
  const [style, setStyle] = useState<'rap' | 'spoken' | 'sing' | null>(null);
  const [language, setLanguage] = useState<'de' | 'es' | 'en' | null>(null);
  const [speed, setSpeed] = useState(1);
  const [expression, setExpression] = useState(0.3);
  const [stability, setStability] = useState(0.5);
  const [presets, setPresets] = useState<VocalPreset[]>([]);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [cloning, setCloning] = useState(false);
  const [cloneFrom, setCloneFrom] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [consent, setConsent] = useState(false);
  const [cloneBusy, setCloneBusy] = useState(false);
  useEffect(() => {
    void db.getKv<VocalPreset[]>('vocalPresets').then((p) => setPresets(p ?? []));
  }, []);
  useEffect(() => {
    // the chosen voice is remembered, otherwise every restart goes back to the AI voice
    void Promise.all([loadVoices(), db.getKv<string>('voiceId')]).then(([list, chosen]) => {
      setVoices(list);
      if (chosen && list.some((v) => v.id === chosen)) setVoiceId(chosen);
    });
  }, []);
  const storePresets = (list: VocalPreset[]) => {
    setPresets(list);
    void db.setKv('vocalPresets', list);
  };
  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const preset: VocalPreset = { id: uid(), name, prompt, lyrics, bars, vocalsOnly, gender, style, language, speed, expression, stability, voiceId };
    const list = upsertPreset(presets, preset);
    storePresets(list);
    setPresetId(list.find((p) => p.name.toLowerCase() === name.toLowerCase())?.id ?? null);
    setSaving(false);
    setPresetName('');
    toast(`Preset „${name}“ gespeichert.`);
  };
  const loadPreset = (p: VocalPreset) => {
    setPresetId(p.id);
    setPrompt(p.prompt);
    setLyrics(p.lyrics);
    setBars(p.bars);
    setVocalsOnly(p.vocalsOnly);
    setGender(p.gender);
    setStyle(p.style);
    setLanguage(p.language);
    setSpeed(p.speed);
    setExpression(p.expression);
    setStability(p.stability);
    pickVoice(presetVoice(p, voices.map((v) => v.id)));
  };
  // the style chips are a quick pick for the voice knobs: rap = faster, livelier, less calm; speaking = natural
  const pickStyle = (st: 'rap' | 'spoken') => {
    if (style === st) return setStyle(null);
    setStyle(st);
    setSpeed(st === 'rap' ? 1.1 : 1);
    setExpression(st === 'rap' ? 0.6 : 0.3);
    setStability(st === 'rap' ? 0.35 : 0.5);
  };
  const pickVoice = (id: string | null) => {
    setVoiceId(id);
    void db.setKv('voiceId', id);
  };
  const [search, setSearch] = useState('');
  const sources = voiceSources(samples, search);

  if (!open) {
    return (
      <View style={[s.fab, { flexDirection: 'row', gap: 8 }]}>
        <Btn accessibilityLabel="Arrangement-Generator" onPress={() => setState({ panel: 'arranger' })}>
          <Sparkle size={16} />
          Arrangement
        </Btn>
        <Btn kind="primary" onPress={() => setOpen(true)}>
          <Sparkle size={16} color={C.accentInk} />
          AI Vocals
        </Btn>
      </View>
    );
  }

  const submit = async () => {
    if (busy || (!prompt.trim() && !lyrics.trim())) return;
    if (!(await getSession())) {
      toast('Bitte zuerst mit Google anmelden.');
      setState({ panel: 'projects' });
      return;
    }
    setBusy(true);
    toast('Vocal wird generiert, das kann bis zu einer Minute dauern …');
    try {
      const s = await generateVocal({
        prompt,
        lyrics,
        bars,
        vocalsOnly,
        ...(language ? { language } : {}),
        ...(voiceId
          ? { voiceId, voiceName: voices.find((v) => v.id === voiceId)?.name, ...(style && style !== 'sing' ? { style } : {}), speed, expression, stability }
          : { ...(gender ? { gender } : {}), ...(style ? { style } : {}) }),
      });
      toast(`${voiceId ? `In der Stimme „${voices.find((v) => v.id === voiceId)?.name}“ gesprochen: ` : ''}„${s.name}“ liegt auf der Vocal-Spur bei Takt ${Math.floor(cursor) + 1}`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const clone = async () => {
    if (!cloneFrom || cloneBusy) return;
    setCloneBusy(true);
    try {
      const v = await cloneVoice(cloneFrom, cloneName, consent);
      setVoices((x) => [...x, v]);
      pickVoice(v.id);
      setCloning(false);
      setCloneName('');
      setConsent(false);
      toast(`Stimme „${v.name}“ ist geklont und für die nächsten Vocals ausgewählt.`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setCloneBusy(false);
    }
  };
  const dropVoice = async (v: Voice) => {
    try {
      await removeVoice(v.id);
      setVoices((x) => x.filter((y) => y.id !== v.id));
      if (voiceId === v.id) pickVoice(null);
      toast(`Stimme „${v.name}“ gelöscht.`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const boxW = Math.min(600, width - 24);

  return (
    <View style={[s.wrap, { width: boxW, left: (width - boxW) / 2, bottom: small ? 8 : 12 }]}>
      <View style={s.prompt}>
        <View style={s.top}>
          <Chip variant="solid">
            <Wave size={14} color="#111" />
            Vocal-Spur
          </Chip>
          <Chip textStyle={[mono(), { fontSize: 12 }]}>{`ab ${formatBarPosition(Math.floor(cursor))}`}</Chip>
          <View style={s.badge}>
            <Txt style={s.badgeText}>BETA</Txt>
          </View>
          <Spacer />
          <IconBtn onPress={() => setOpen(false)} accessibilityLabel="Schließen">
            <Close size={16} />
          </IconBtn>
        </View>
        <View style={s.promptRow}>
          <TextInput
            style={[s.input, s.textarea]}
            multiline
            placeholder={`Beschreibe die Vocals, z. B. „dunkle Frauenstimme, Rave-Hook, hallig“ (${project.bpm} BPM, ${project.key})`}
            placeholderTextColor={C.dim}
            value={prompt}
            onChangeText={setPrompt}
          />
          <Pressable style={[s.send, busy && { opacity: 0.4 }]} onPress={() => void submit()} disabled={busy} accessibilityLabel="Generieren">
            {busy ? <ActivityIndicator size="small" color={C.accentInk} /> : <ArrowUp size={18} color={C.accentInk} />}
          </Pressable>
        </View>
        <View style={s.lyrics}>
          <TextInput
            style={[s.input, s.textInput]}
            placeholder={voiceId ? 'Text, den deine Stimme sprechen soll' : 'Text, der gesungen werden soll (optional)'}
            placeholderTextColor={C.dim}
            value={lyrics}
            onChangeText={setLyrics}
          />
        </View>
        <View style={s.row}>
          {LENGTHS.map((l) => (
            <Chip key={l} variant={bars === l ? 'on' : 'ghost'} onPress={() => setBars(l)}>
              {`${l} Takte`}
            </Chip>
          ))}
          <Chip variant={vocalsOnly ? 'on' : 'ghost'} onPress={() => setVocalsOnly(!vocalsOnly)}>
            Nur Vocals
          </Chip>
        </View>
        <View style={s.row}>
          <Txt style={s.small}>Presets:</Txt>
          {presets.length === 0 && <Txt style={s.small}>noch keine gespeichert</Txt>}
          {presets.map((p) => (
            <Chip key={p.id} variant={presetId === p.id ? 'on' : 'ghost'} onPress={() => loadPreset(p)}>
              {p.name}
            </Chip>
          ))}
          <Chip variant={saving ? 'on' : 'ghost'} onPress={() => setSaving(!saving)}>
            ＋ Speichern
          </Chip>
          {presetId !== null && (
            <Chip
              onPress={() => {
                storePresets(removePreset(presets, presetId));
                setPresetId(null);
              }}
            >
              Preset löschen
            </Chip>
          )}
        </View>
        {saving && (
          <View style={s.row}>
            <TextInput style={[s.input, s.textInput]} placeholder="Name des Presets, z. B. Rave-Hook deutsch" placeholderTextColor={C.dim} value={presetName} onChangeText={setPresetName} onSubmitEditing={savePreset} />
            <Btn kind="primary" onPress={savePreset} disabled={!presetName.trim()}>
              Speichern
            </Btn>
          </View>
        )}
        <View style={s.row}>
          <Txt style={s.small}>Schnellwahl:</Txt>
          {voiceId === null && (
            <>
              <Chip variant={gender === 'male' ? 'on' : 'ghost'} onPress={() => setGender(gender === 'male' ? null : 'male')}>
                Männlich
              </Chip>
              <Chip variant={gender === 'female' ? 'on' : 'ghost'} onPress={() => setGender(gender === 'female' ? null : 'female')}>
                Weiblich
              </Chip>
            </>
          )}
          <Chip variant={style === 'rap' ? 'on' : 'ghost'} onPress={() => pickStyle('rap')}>
            Rap
          </Chip>
          <Chip variant={style === 'spoken' ? 'on' : 'ghost'} onPress={() => pickStyle('spoken')}>
            Sprechen
          </Chip>
          {voiceId === null && (
            <Chip variant={style === 'sing' ? 'on' : 'ghost'} onPress={() => setStyle(style === 'sing' ? null : 'sing')}>
              Gesang
            </Chip>
          )}
          <Chip variant={language === 'de' ? 'on' : 'ghost'} onPress={() => setLanguage(language === 'de' ? null : 'de')}>
            Deutsch
          </Chip>
          <Chip variant={language === 'es' ? 'on' : 'ghost'} onPress={() => setLanguage(language === 'es' ? null : 'es')}>
            Spanisch
          </Chip>
          <Chip variant={language === 'en' ? 'on' : 'ghost'} onPress={() => setLanguage(language === 'en' ? null : 'en')}>
            Englisch
          </Chip>
        </View>
        <View style={s.row}>
          <Txt style={s.small}>Stimme:</Txt>
          <Chip variant={voiceId === null ? 'on' : 'ghost'} onPress={() => pickVoice(null)}>
            AI-Stimme
          </Chip>
          {voices.map((v) => (
            <Chip key={v.id} variant={voiceId === v.id ? 'on' : 'ghost'} onPress={() => pickVoice(v.id)}>
              {v.name}
            </Chip>
          ))}
          <Chip variant={cloning ? 'on' : 'ghost'} onPress={() => setCloning(!cloning)}>
            ＋ Stimme klonen
          </Chip>
        </View>
        {voiceId !== null && (
          <View style={s.row}>
            <Txt style={s.small}>Deine Stimme spricht den Text (sie singt nicht): schreib ihn unten in der gewünschten Sprache. Die Regler stellen Tempo, Ausdruck und Ruhe der Stimme ein.</Txt>
            <Chip onPress={() => void dropVoice(voices.find((v) => v.id === voiceId)!)}>Stimme löschen</Chip>
          </View>
        )}
        {voiceId !== null && (
          <KnobRow>
            <Knob label="Tempo" value={speed} min={0.7} max={1.2} step={0.05} reset={1} format={(v) => `${v.toFixed(2)}x`} onChange={setSpeed} />
            <Knob label="Ausdruck" value={expression} min={0} max={1} step={0.05} reset={0.3} format={(v) => `${Math.round(v * 100)} %`} onChange={setExpression} />
            <Knob label="Ruhe" value={stability} min={0} max={1} step={0.05} reset={0.5} format={(v) => `${Math.round(v * 100)} %`} onChange={setStability} />
          </KnobRow>
        )}
        {cloning && (
          <View style={s.lyrics}>
            <Txt style={s.small}>Wähle eine Aufnahme aus der Library: eine eigene Aufnahme, ein hochgeladenes iPhone-Sprachmemo oder eine mp3 (egal in welcher Kategorie, die neuesten stehen oben, mit dem Suchfeld findest du den Rest). Je mehr saubere Stimme, desto besser: am besten eine bis zwei Minuten, es werden höchstens die ersten 80 Sekunden verwendet.</Txt>
            <Txt style={[s.small, { marginTop: 8 }]}>Oder jetzt direkt aufnehmen: sprich oder sing etwa eine Minute klar ins Mikrofon (ruhiger Raum, nicht zu nah, ohne Musik im Hintergrund). Die Aufnahme wird gleich als Quelle ausgewählt.</Txt>
            <View style={s.row}>
              <RecordButton
                hidePlace
                onSaved={(x) => {
                  setCloneFrom(x.id);
                  if (!cloneName.trim()) setCloneName('Meine Stimme');
                }}
              />
            </View>
            <TextInput style={[s.input, s.textInput, { marginTop: 8 }]} placeholder="Aufnahme suchen (Name)" placeholderTextColor={C.dim} value={search} onChangeText={setSearch} />
            <View style={s.row}>
              {sources.length === 0 && <Txt style={s.small}>Keine passende Aufnahme in der Library.</Txt>}
              {sources.map((x) => (
                <Chip key={x.id} variant={cloneFrom === x.id ? 'on' : 'ghost'} onPress={() => setCloneFrom(x.id)}>
                  {x.name.slice(0, 28)}
                </Chip>
              ))}
            </View>
            <TextInput style={[s.input, s.textInput, { marginTop: 8 }]} placeholder="Name der Stimme" placeholderTextColor={C.dim} value={cloneName} onChangeText={setCloneName} />
            <View style={s.row}>
              <Chip variant={consent ? 'on' : 'ghost'} onPress={() => setConsent(!consent)}>
                {consent ? '✓ ' : ''}Ich darf diese Stimme verwenden (meine eigene oder mit Erlaubnis)
              </Chip>
            </View>
            <View style={s.row}>
              <Btn kind="primary" onPress={() => void clone()} disabled={!cloneFrom || !cloneName.trim() || !consent || cloneBusy}>
                {cloneBusy ? 'klont …' : 'Stimme klonen'}
              </Btn>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fab: { position: 'absolute', right: 14, bottom: 14, zIndex: 6 },
  wrap: { position: 'absolute', zIndex: 6 },
  prompt: {
    backgroundColor: 'rgba(24,24,27,0.96)',
    borderWidth: 1,
    borderColor: '#34343a',
    borderRadius: 18,
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 20 },
    elevation: 12,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  badge: { borderWidth: 1, borderColor: '#ff4d7d', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 10, ...font(700), color: '#ff4d7d' },
  promptRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, color: C.text, ...font(400), fontSize: 14, padding: 0, outlineWidth: 0 },
  // Browser defaults the original inherits: textarea padding 2px, rows=2; input padding 1px 2px.
  textarea: { height: 38, padding: 2, lineHeight: 17 },
  textInput: { paddingVertical: 1, paddingHorizontal: 2 },
  send: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  lyrics: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 8, paddingTop: 8 },
  small: { color: C.muted, fontSize: 11, lineHeight: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 },
});
