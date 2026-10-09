import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { C, font, mono } from '../constants/theme';
import { formatBarPosition } from '../audio/timing';
import { errorText, setState, toast, useStore } from '../lib/store';
import { getSession } from '../lib/supabase';
import { generateVocal } from '../lib/vocals';
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

  if (!open) {
    return (
      <View style={s.fab}>
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
      const s = await generateVocal({ prompt, lyrics, bars, vocalsOnly });
      toast(`„${s.name}“ liegt auf der Vocal-Spur bei Takt ${Math.floor(cursor) + 1}`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
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
          <Chip variant={vocalsOnly ? 'on' : 'ghost'} onPress={() => setVocalsOnly(!vocalsOnly)}>
            Nur Vocals
          </Chip>
        </View>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 },
});
