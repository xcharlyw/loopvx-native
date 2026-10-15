import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { C, font, mono } from '../constants/theme';
import { formatBarPosition } from '../audio/timing';
import { errorText, setState, toast, useStore } from '../lib/store';
import { getSession } from '../lib/supabase';
import { generateVocal } from '../lib/vocals';
import { cloneVoice, loadVoices, removeVoice, type Voice } from '../lib/voices';
import { useSmall } from './hooks';
import { ArrowUp, Close, Sparkle, Wave } from './icons';
import { Btn, Chip, IconBtn, Spacer, Txt } from './kit';

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
  const [cloning, setCloning] = useState(false);
  const [cloneFrom, setCloneFrom] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [consent, setConsent] = useState(false);
  const [cloneBusy, setCloneBusy] = useState(false);
  useEffect(() => {
    void loadVoices().then(setVoices);
  }, []);
  // own recordings, uploaded mp3s and vocal samples (not the generated ones)
  const sources = samples
    .filter((x) => (x.category === 'vocal' || x.folder === 'Aufnahmen') && x.folder !== 'AI Vocals')
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 12);

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
      const s = await generateVocal({ prompt, lyrics, bars, vocalsOnly, ...(voiceId ? { voiceId } : {}) });
      toast(`„${s.name}“ liegt auf der Vocal-Spur bei Takt ${Math.floor(cursor) + 1}`);
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
      setVoiceId(v.id);
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
      if (voiceId === v.id) setVoiceId(null);
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
            placeholder="Text, der gesungen werden soll (optional)"
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
          <Chip variant={vocalsOnly || voiceId ? 'on' : 'ghost'} onPress={() => setVocalsOnly(!vocalsOnly)}>
            Nur Vocals
          </Chip>
        </View>
        <View style={s.row}>
          <Txt style={s.small}>Stimme:</Txt>
          <Chip variant={voiceId === null ? 'on' : 'ghost'} onPress={() => setVoiceId(null)}>
            AI-Stimme
          </Chip>
          {voices.map((v) => (
            <Chip key={v.id} variant={voiceId === v.id ? 'on' : 'ghost'} onPress={() => setVoiceId(v.id)}>
              {v.name}
            </Chip>
          ))}
          <Chip variant={cloning ? 'on' : 'ghost'} onPress={() => setCloning(!cloning)}>
            ＋ Stimme klonen
          </Chip>
        </View>
        {voiceId !== null && (
          <View style={s.row}>
            <Txt style={s.small}>Die Vocals werden zuerst erzeugt und dann in dieser Stimme gesungen (Voice Changer). Ob das bei Gesang so klingt wie gewünscht, probier es kurz aus.</Txt>
            <Chip onPress={() => void dropVoice(voices.find((v) => v.id === voiceId)!)}>Stimme löschen</Chip>
          </View>
        )}
        {cloning && (
          <View style={s.lyrics}>
            <Txt style={s.small}>Wähle eine Aufnahme aus der Library (Library → Aufnahme, oder eine mp3 hochladen). Je mehr saubere Stimme, desto besser: am besten eine bis zwei Minuten, es werden höchstens die ersten 80 Sekunden verwendet.</Txt>
            <View style={s.row}>
              {sources.length === 0 && <Txt style={s.small}>Noch keine Aufnahme in der Library.</Txt>}
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
