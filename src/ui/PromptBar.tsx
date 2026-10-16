import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { C, font, mono } from '../constants/theme';
import { formatBarPosition } from '../audio/timing';
import { uid } from '../lib/project';
import { errorText, setState, toast, useStore } from '../lib/store';
import { db } from '../storage/db';
import { GENRES, ideaText, requestLyrics, type Genre, type LyricIdea } from '../lib/lyrics';
import { inspirationOf, lyricsFromFile, removeSongText, titleFromText, upsertSongText, type SongText } from '../lib/songTexts';
import { pickFile } from '../lib/samples';
import { listSongTextFiles, readSongTextFile, saveSongTextToDrive } from '../lib/songFiles';
import type { DriveFile } from '../lib/drive';
import { transcribeSample } from '../lib/transcribe';
import { getSession } from '../lib/supabase';
import { generateVocal } from '../lib/vocals';
import { SamplePicker } from './SamplePicker';
import { FACTORY_PRESETS, presetVoice, removePreset, upsertPreset, type VocalPreset } from '../lib/vocalPresets';
import { cloneVoice, loadVoices, removeVoice, type Voice } from '../lib/voices';
import { useAppDims, useSmall } from './hooks';
import { ArrowUp, Close, Sparkle, Wave } from './icons';
import { Btn, Chip, IconBtn, Spacer, Txt } from './kit';
import { RecordButton } from './RecordButton';
import { Knob, KnobRow } from './synth/Knob';

const LENGTHS = [4, 8, 16, 32];

/** Suno-style floating prompt box for AI vocals, same layout as the original web app. */
export function PromptBar() {
  const project = useStore((st) => st.project);
  const cursor = useStore((st) => st.cursor);
  const selectedTrackId = useStore((st) => st.selectedTrackId);
  const selectedTrack = project.tracks.find((t) => t.id === selectedTrackId);
  // where the vocal lands: the selected audio track, else a vocal track
  const targetName = selectedTrack && selectedTrack.kind !== 'midi' && !selectedTrack.synth ? selectedTrack.name : 'neue Vocal-Spur';
  const { width } = useAppDims();
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
  const [language, setLanguage] = useState<'de' | 'es' | 'en' | 'pt' | null>(null);
  const [songTexts, setSongTexts] = useState<SongText[]>([]);
  const [inspo, setInspo] = useState<string[]>([]);
  const [tOpen, setTOpen] = useState(false);
  const [tSource, setTSource] = useState<string | null>(null);
  const [tMode, setTMode] = useState<'vocals' | 'load'>('vocals');
  const [tText, setTText] = useState('');
  const [tTitle, setTTitle] = useState('');
  const [tBusy, setTBusy] = useState(false);
  const [lineCount, setLineCount] = useState<4 | 8 | 16>(4);
  const [genre, setGenre] = useState<Genre | null>(null);
  const [menu, setMenu] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [expression, setExpression] = useState(0);
  const [stability, setStability] = useState(0.5);
  const [similarity, setSimilarity] = useState(0.9);
  const [denoise, setDenoise] = useState(false);
  const [theme, setTheme] = useState('');
  const [ideas, setIdeas] = useState<LyricIdea[]>([]);
  const [ideasBusy, setIdeasBusy] = useState(false);
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
    void Promise.all([db.getKv<SongText[]>('songTexts'), db.getKv<string[]>('inspoIds')]).then(([list, ids]) => {
      setSongTexts(list ?? []);
      setInspo((ids ?? []).filter((id) => (list ?? []).some((t) => t.id === id)));
    });
  }, []);
  useEffect(() => {
    // the chosen voice is remembered, otherwise every restart goes back to the AI voice
    void Promise.all([loadVoices(), db.getKv<string>('voiceId')]).then(([list, chosen]) => {
      setVoices(list);
      if (chosen && list.some((v) => v.id === chosen)) setVoiceId(chosen);
    });
  }, []);
  // endless ideas: every round asks for new ones and tells Gemini which titles it already showed
  const moreIdeas = async (fresh: boolean) => {
    if (ideasBusy) return;
    if (!(await getSession())) {
      toast('Bitte zuerst mit Google anmelden.');
      setState({ panel: 'projects' });
      return;
    }
    setIdeasBusy(true);
    try {
      const list = await requestLyrics({
        theme,
        language: language ?? 'de',
        ...(voiceId === null && gender ? { gender } : {}),
        ...(style ? { style } : {}),
        ...(genre ? { genre } : {}),
        ...(inspo.length ? { inspiration: inspirationOf(songTexts, inspo) } : {}),
        vocalsOnly,
        lines: lineCount,
        // longer texts, fewer ideas per round
        count: lineCount === 4 ? 4 : lineCount === 8 ? 3 : 2,
        avoid: (fresh ? [] : ideas).map((i) => i.title),
      });
      setIdeas((old) => (fresh ? list : [...old, ...list]));
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setIdeasBusy(false);
    }
  };
  const storeTexts = (list: SongText[], ids: string[]) => {
    setSongTexts(list);
    setInspo(ids);
    void db.setKv('songTexts', list);
    void db.setKv('inspoIds', ids);
  };
  const toggleInspo = (id: string) => storeTexts(songTexts, inspo.includes(id) ? inspo.filter((x) => x !== id) : [...inspo, id]);
  const toText = async () => {
    if (!tSource || tBusy) return;
    setTBusy(true);
    try {
      const r = await transcribeSample(tSource);
      setTText(r.lines.join('\n'));
      setTTitle(titleFromText(r.lines.join('\n')));
      if (r.language === 'de' || r.language === 'en' || r.language === 'es' || r.language === 'pt') setLanguage(r.language);
      toast(`${r.lines.length} Zeilen erkannt: prüf den Text kurz, bevor du ihn speicherst.`);
      // the transcript is also kept as a text file in Drive (LOOPVX / Songtexte); "Lyrics laden" lists it
      const title = titleFromText(r.lines.join('\n'));
      void saveSongTextToDrive(title, r.lines.join('\n')).then(
        (name) => toast(`„${name}“ liegt in Google Drive unter LOOPVX / Songtexte.`),
        () => undefined,
      );
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setTBusy(false);
    }
  };
  const loadLyrics = async () => {
    try {
      const f = await pickFile();
      if (!f) return;
      if (f.data.byteLength > 512_000) throw new Error('Die Datei ist zu groß für einen Songtext (max. 500 KB).');
      const { title, text } = lyricsFromFile(f.name, new TextDecoder().decode(f.data));
      if (!text) throw new Error('In der Datei steht kein Text. Nimm eine .txt- oder .lrc-Datei.');
      setTText(text);
      setTTitle(title);
      toast(`„${title}“ geladen: ${text.split('\n').filter((l) => l.trim()).length} Zeilen.`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const [driveTexts, setDriveTexts] = useState<DriveFile[] | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  const saveToDrive = async () => {
    if (!tText.trim() || driveBusy) return;
    setDriveBusy(true);
    try {
      const name = await saveSongTextToDrive(tTitle.trim() || titleFromText(tText), tText);
      setDriveTexts(null);
      toast(`„${name}“ liegt in Google Drive unter LOOPVX / Songtexte. Unter „Lyrics laden“ kannst du sie wieder wählen.`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setDriveBusy(false);
    }
  };
  const showDriveTexts = async () => {
    if (driveBusy) return;
    setDriveBusy(true);
    try {
      setDriveTexts(await listSongTextFiles());
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setDriveBusy(false);
    }
  };
  const loadDriveText = async (f: DriveFile) => {
    if (driveBusy) return;
    setDriveBusy(true);
    try {
      const { title, text } = lyricsFromFile(f.name, await readSongTextFile(f.id));
      if (!text) throw new Error('In der Datei steht kein Text.');
      setTText(text);
      setTTitle(title);
      setDriveTexts(null);
      toast(`„${title}“ geladen: ${text.split('\n').filter((l) => l.trim()).length} Zeilen.`);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setDriveBusy(false);
    }
  };
  const openTexts = (mode: 'vocals' | 'load') => {
    if (tOpen && tMode === mode) setTOpen(false);
    else {
      setTMode(mode);
      setTOpen(true);
    }
  };
  const saveText = () => {
    if (!tText.trim()) return;
    const item: SongText = { id: uid(), title: tTitle.trim() || titleFromText(tText), text: tText.trim(), ...(language ? { language } : {}), addedAt: Date.now() };
    const list = upsertSongText(songTexts, item);
    const saved = list.find((t) => t.title.toLowerCase() === item.title.toLowerCase());
    storeTexts(list, saved && !inspo.includes(saved.id) ? [...inspo, saved.id] : inspo);
    toast(`Songtext „${item.title}“ gespeichert und als Inspiration eingeschaltet.`);
  };
  const useIdea = (i: LyricIdea) => {
    setLyrics(ideaText(i));
    // spoken in a cloned voice, the style prompt is not needed; for the AI vocal it is the music description
    if (voiceId === null) setPrompt(i.stylePrompt);
    toast(`„${i.title}“ übernommen`);
  };
  const storePresets = (list: VocalPreset[]) => {
    setPresets(list);
    void db.setKv('vocalPresets', list);
  };
  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const preset: VocalPreset = { id: uid(), name, prompt, lyrics, bars, vocalsOnly, gender, style, language, genre, speed, expression, stability, similarity, voiceId };
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
    setGenre(p.genre ?? null);
    setSpeed(p.speed);
    setExpression(p.expression);
    setStability(p.stability);
    setSimilarity(p.similarity ?? 0.9);
    pickVoice(presetVoice(p, voices.map((v) => v.id)));
  };
  // the style chips are a quick pick for the voice knobs: rap = faster, livelier, less calm; speaking = natural
  const pickStyle = (st: 'rap' | 'spoken') => {
    if (style === st) return setStyle(null);
    setStyle(st);
    setSpeed(st === 'rap' ? 1.1 : 1);
    setExpression(st === 'rap' ? 0.6 : 0);
    setStability(st === 'rap' ? 0.35 : 0.5);
  };
  const pickVoice = (id: string | null) => {
    setVoiceId(id);
    void db.setKv('voiceId', id);
  };

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
      const made = await generateVocal({
        prompt,
        lyrics,
        bars,
        vocalsOnly,
        ...(language ? { language } : {}),
        ...(genre ? { genre } : {}),
        ...(voiceId
          ? { voiceId, voiceName: voices.find((v) => v.id === voiceId)?.name, ...(style && style !== 'sing' ? { style } : {}), speed, expression, stability, similarity }
          : { ...(gender ? { gender } : {}), ...(style ? { style } : {}) }),
      });
      toast(`${voiceId ? `In der Stimme „${voices.find((v) => v.id === voiceId)?.name}“ gesprochen: ` : ''}„${made.sample.name}“ liegt auf der Spur „${made.trackName}“ bei Takt ${made.bar}`);
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
      const v = await cloneVoice(cloneFrom, cloneName, consent, denoise);
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
            {`Spur: ${targetName}`}
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
            placeholder={`Beschreibe die Vocals, z. B. „dunkle Frauenstimme, Rave-Hook, hallig“`}
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
          <TextInput style={[s.input, s.textInput]} placeholder="Thema für Text-Ideen (optional), z. B. Hitze, Nacht, Kontrolle" placeholderTextColor={C.dim} value={theme} onChangeText={setTheme} />
          <Btn onPress={() => void moreIdeas(true)} disabled={ideasBusy}>
            {ideasBusy ? 'denkt …' : 'Text-Ideen'}
          </Btn>
          {ideas.length > 0 && (
            <Btn onPress={() => void moreIdeas(false)} disabled={ideasBusy}>
              Mehr Ideen
            </Btn>
          )}
        </View>
        <View style={s.row}>
          <Txt style={s.small}>Textlänge:</Txt>
          {([4, 8, 16] as const).map((n) => (
            <Chip key={n} variant={lineCount === n ? 'on' : 'ghost'} onPress={() => setLineCount(n)}>
              {`${n} Zeilen`}
            </Chip>
          ))}
        </View>
        <View style={s.row}>
          <Txt style={s.small}>Songtexte:</Txt>
          <Chip variant={tOpen && tMode === 'vocals' ? 'on' : 'ghost'} onPress={() => openTexts('vocals')}>
            Text aus Vocals
          </Chip>
          <Chip variant={tOpen && tMode === 'load' ? 'on' : 'ghost'} onPress={() => openTexts('load')}>
            Lyrics laden
          </Chip>
          {songTexts.length > 0 && <Txt style={s.small}>{`${songTexts.length} gespeichert, ${inspo.length} als Inspiration an`}</Txt>}
        </View>
        {tOpen && (
          <View style={s.lyrics}>
            {tMode === 'vocals' ? (
                <View>
                <Txt style={s.small}>Wandelt Gesang oder Rap in Text um. Wähle ein Sample oder nimm direkt auf. Den Text kannst du prüfen, als Songtext speichern und als Inspiration für die Text-Ideen verwenden (die KI übernimmt nur den Stil, keine Zeilen).</Txt>
                <View style={s.row}>
                  <RecordButton hidePlace onSaved={(x) => setTSource(x.id)} />
                </View>
                <SamplePicker samples={samples} value={tSource} onChange={setTSource} />
                <View style={s.row}>
                  <Btn kind="primary" onPress={() => void toText()} disabled={!tSource || tBusy}>
                    {tBusy ? 'hört zu …' : 'In Text umwandeln'}
                  </Btn>
              </View>
              </View>
            ) : (
              <View>
                <Txt style={s.small}>Lade einen Songtext als Datei (.txt, .lrc mit Zeitstempeln geht auch) oder füg ihn unten ein. Dann kannst du ihn als Songtext speichern, als Inspiration für die Text-Ideen nutzen oder direkt ins Textfeld übernehmen.</Txt>
                <View style={s.row}>
                  <Btn kind="primary" onPress={() => void loadLyrics()}>
                    Textdatei wählen
                  </Btn>
                  <Btn onPress={() => void showDriveTexts()} disabled={driveBusy}>
                    Aus Google Drive
                  </Btn>
                </View>
                {driveTexts && (
                  <View>
                    <Txt style={s.small}>{driveTexts.length ? 'Google Drive › LOOPVX › Songtexte:' : 'In LOOPVX / Songtexte liegt noch keine Datei. Wandle Vocals in Text um und speichere sie in Drive.'}</Txt>
                    {driveTexts.map((f) => (
                      <Chip key={f.id} onPress={() => void loadDriveText(f)}>
                        {f.name}
                      </Chip>
                    ))}
                  </View>
                )}
              </View>
            )}
            {(tText !== '' || tMode === 'load') && (
              <View>
                <TextInput style={[s.input, s.textInput, { minHeight: 90, textAlignVertical: 'top' }]} multiline placeholder={tMode === 'load' ? 'Songtext hier einfügen' : 'Erkannter Text'} placeholderTextColor={C.dim} value={tText} onChangeText={setTText} />
                <TextInput style={[s.input, s.textInput, { marginTop: 6 }]} placeholder="Titel" placeholderTextColor={C.dim} value={tTitle} onChangeText={setTTitle} />
                <View style={s.row}>
                  <Chip variant="solid" onPress={saveText}>
                    Als Songtext speichern
                  </Chip>
                  <Chip onPress={() => setLyrics(tText)}>Ins Textfeld</Chip>
                  <Chip onPress={() => void saveToDrive()}>{driveBusy ? 'speichert …' : 'Als Textdatei in Drive speichern'}</Chip>
                </View>
              </View>
            )}
            {songTexts.map((t) => (
              <View key={t.id} style={s.idea}>
                <Txt style={s.ideaTitle}>{t.title}</Txt>
                <Txt style={s.ideaLines} numberOfLines={3}>
                  {t.text}
                </Txt>
                <View style={s.row}>
                  <Chip variant={inspo.includes(t.id) ? 'on' : 'ghost'} onPress={() => toggleInspo(t.id)}>
                    {inspo.includes(t.id) ? '✓ Inspiration' : 'Als Inspiration'}
                  </Chip>
                  <Chip onPress={() => setLyrics(t.text)}>Ins Textfeld</Chip>
                  <Chip onPress={() => storeTexts(removeSongText(songTexts, t.id), inspo.filter((x) => x !== t.id))}>Löschen</Chip>
                </View>
              </View>
            ))}
          </View>
        )}
        {ideas.map((i) => (
          <View key={i.title + i.lines[0]} style={s.idea}>
            <Txt style={s.ideaTitle}>{`${i.title}${i.genre ? ` · ${i.genre}` : ''}`}</Txt>
            <Txt style={s.ideaLines}>{i.lines.join('\n')}</Txt>
            <View style={s.row}>
              <Chip variant="solid" onPress={() => useIdea(i)}>
                Übernehmen
              </Chip>
              <Chip onPress={() => setIdeas((old) => old.filter((x) => x !== i))}>Weg</Chip>
            </View>
          </View>
        ))}
        <View style={s.row}>
          <Txt style={s.small}>Preset:</Txt>
          <Pressable style={s.drop} onPress={() => setMenu(!menu)} accessibilityLabel="Preset wählen">
            <Txt style={s.dropText} numberOfLines={1}>
              {[...FACTORY_PRESETS, ...presets].find((p) => p.id === presetId)?.name ?? 'Preset wählen'}
            </Txt>
            <Txt style={s.dropArrow}>{menu ? '▴' : '▾'}</Txt>
          </Pressable>
          <Chip variant={saving ? 'on' : 'ghost'} onPress={() => setSaving(!saving)}>
            ＋ Speichern
          </Chip>
        </View>
        {menu && (
          <View style={s.menu}>
            <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled>
              <Txt style={s.menuHead}>Vorlagen</Txt>
              {FACTORY_PRESETS.map((p) => (
                <Pressable
                  key={p.id}
                  style={[s.menuItem, presetId === p.id && s.menuItemOn]}
                  onPress={() => {
                    loadPreset(p);
                    setMenu(false);
                  }}
                >
                  <Txt style={[s.menuText, presetId === p.id && { color: C.accentInk }]}>{p.name}</Txt>
                </Pressable>
              ))}
              <Txt style={s.menuHead}>Meine Presets</Txt>
              {presets.length === 0 && <Txt style={[s.small, { paddingHorizontal: 12, paddingVertical: 6 }]}>noch keine gespeichert: stell alles ein und tippe auf „＋ Speichern“</Txt>}
              {presets.map((p) => (
                <View key={p.id} style={[s.menuItem, { flexDirection: 'row', alignItems: 'center' }, presetId === p.id && s.menuItemOn]}>
                  <Pressable
                    style={{ flex: 1 }}
                    onPress={() => {
                      loadPreset(p);
                      setMenu(false);
                    }}
                  >
                    <Txt style={[s.menuText, presetId === p.id && { color: C.accentInk }]}>{p.name}</Txt>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Preset ${p.name} löschen`}
                    onPress={() => {
                      storePresets(removePreset(presets, p.id));
                      if (presetId === p.id) setPresetId(null);
                    }}
                  >
                    <Txt style={[s.menuText, { paddingLeft: 12 }]}>✕</Txt>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
        {saving && (
          <View style={s.row}>
            <TextInput style={[s.input, s.textInput]} placeholder="Name des Presets, z. B. Rave-Hook deutsch" placeholderTextColor={C.dim} value={presetName} onChangeText={setPresetName} onSubmitEditing={savePreset} />
            <Btn kind="primary" onPress={savePreset} disabled={!presetName.trim()}>
              Speichern
            </Btn>
          </View>
        )}
        <View style={s.row}>
          <Txt style={s.small}>Genre:</Txt>
          {GENRES.map((g) => (
            <Chip key={g.id} variant={genre === g.id ? 'on' : 'ghost'} onPress={() => setGenre(genre === g.id ? null : g.id)}>
              {g.label}
            </Chip>
          ))}
        </View>
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
          <Chip variant={language === 'pt' ? 'on' : 'ghost'} onPress={() => setLanguage(language === 'pt' ? null : 'pt')}>
            Portugiesisch
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
            <Knob label="Ausdruck" value={expression} min={0} max={1} step={0.05} reset={0} format={(v) => `${Math.round(v * 100)} %`} onChange={setExpression} />
            <Knob label="Ähnlichkeit" value={similarity} min={0} max={1} step={0.05} reset={0.9} format={(v) => `${Math.round(v * 100)} %`} onChange={setSimilarity} />
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
            <SamplePicker samples={samples} value={cloneFrom} onChange={setCloneFrom} />
            <TextInput style={[s.input, s.textInput, { marginTop: 8 }]} placeholder="Name der Stimme" placeholderTextColor={C.dim} value={cloneName} onChangeText={setCloneName} />
            <View style={s.row}>
              <Chip variant={consent ? 'on' : 'ghost'} onPress={() => setConsent(!consent)}>
                {consent ? '✓ ' : ''}Ich darf diese Stimme verwenden (meine eigene oder mit Erlaubnis)
              </Chip>
            </View>
            <View style={s.row}>
              <Chip variant={denoise ? 'on' : 'ghost'} onPress={() => setDenoise(!denoise)}>
                {denoise ? '✓ ' : ''}Hintergrundrauschen entfernen (nur bei verrauschter Aufnahme)
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
  idea: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 8, paddingTop: 8 },
  ideaTitle: { color: C.accent, fontSize: 12, ...font(700) },
  ideaLines: { color: C.text, fontSize: 13, lineHeight: 18, marginTop: 2 },
  drop: { flex: 1, minWidth: 180, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1d1d22', borderWidth: 1, borderColor: '#34343a', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  dropText: { color: C.text, fontSize: 13, ...font(600), flexShrink: 1 },
  dropArrow: { color: C.accent, fontSize: 12, marginLeft: 8 },
  menu: { backgroundColor: '#1d1d22', borderWidth: 1, borderColor: '#34343a', borderRadius: 12, marginTop: 6, overflow: 'hidden' },
  menuHead: { color: C.muted, fontSize: 10, ...font(700), textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2 },
  menuItem: { paddingHorizontal: 12, paddingVertical: 9 },
  menuItemOn: { backgroundColor: C.accent },
  menuText: { color: C.text, fontSize: 13 },
  small: { color: C.muted, fontSize: 11, lineHeight: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 },
});
