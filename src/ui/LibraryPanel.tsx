import { useContext, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { C, font } from '../constants/theme';
import { engine } from '../audio/engine';
import { auditionSample, autoDetectTempos, placeSample, type AuditionInfo } from '../lib/actions';
import { BROWSER_CATS, SEARCHABLE, searchWords, stepSelection, type BrowserCat } from '../lib/browser';
import { allFolders, childFolders, countIn, nameOf } from '../lib/folders';
import { importSamplesFromDevice } from '../lib/samples';
import { startStemSeparation } from '../lib/stems';
import { errorText, getState, setSamples, setState, toast, useStore } from '../lib/store';
import type { Sample } from '../types';
import { DriveImport } from './DriveImport';
import { SpliceSearch } from './SpliceSearch';
import { useEngine } from './hooks';
import { Close, Upload } from './icons';
import { RecordButton } from './RecordButton';
import { Btn, Txt } from './kit';
import { Sheet, SheetPlace } from './Sheet';
import { FxList, MidiFxList, SoundList } from './browser/ItemLists';
import { PreviewStrip } from './browser/PreviewStrip';
import { BrowserRow, GroupTitle, browserStyles } from './browser/Row';
import { SampleList } from './browser/SampleList';
import { revealRow, useBrowserKeys } from './browser/keys';
import type { NavList } from './browser/nav';

// The Library as Ableton Live 12's browser: a search field, the categories (Samples, Sounds, Drums, Audio-Effekte, MIDI-Effekte) and
// places (Google Drive, Splice, Aufnahmen, Stems) in a sidebar (tabs on a narrow panel), the content list, and the preview strip.
// A tap selects and auditions, a double tap / Enter / ＋ loads, and anything can be dragged onto a track, the sampler or the device chain.

/** Wide enough for the sidebar next to the list. */
const SIDEBAR_FROM = 390;
const SIDEBAR_W = 136;

let keptAutoPreview = true;
let keptSel: string | null = null;
let keptPath = '';
let focusSearch: (() => void) | null = null;
/** Where takes and uploads from this device land. */
const OWN_FOLDERS = ['Aufnahmen', 'Uploads'];

/** Puts the cursor into the browser's search field (Cmd/Ctrl+F); the browser must be open. */
export const focusBrowserSearch = () => focusSearch?.();

export function LibraryPanel() {
  const cat = useStore((st) => st.browserCat);
  const view = useStore((st) => st.view);
  const jump = useStore((st) => st.libraryJump);
  const place = useContext(SheetPlace);
  const [width, setWidth] = useState(0);
  const [query, setQuery] = useState('');
  const [sel, setSelState] = useState<string | null>(keptSel);
  const [path, setPathState] = useState(keptPath);
  const [autoPreview, setAutoPreviewState] = useState(keptAutoPreview);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [heard, setHeard] = useState<({ id: string } & AuditionInfo) | null>(null);
  const previewing = useEngine(() => engine.isPreviewing());
  const nav = useRef<NavList | null>(null);
  const search = useRef<TextInput>(null);
  const setSel = (id: string | null) => {
    keptSel = id;
    setSelState(id);
  };
  const setPath = (p: string) => {
    keptPath = p;
    setPathState(p);
  };
  const setAutoPreview = (on: boolean) => {
    keptAutoPreview = on;
    setAutoPreviewState(on);
  };
  const setCat = (c: BrowserCat) => {
    setState({ browserCat: c });
    setSel(null);
  };

  useEffect(() => {
    focusSearch = () => search.current?.focus();
    return () => {
      focusSearch = null;
    };
  }, []);

  // After a stem separation the Library opens the stems' folder.
  useEffect(() => {
    if (!jump) return;
    setQuery('');
    setState({ browserCat: 'samples', libraryJump: null });
    setPath(jump);
  }, [jump]);

  const audition = async (x: Sample, restart = false) => {
    if (!restart && previewing && previewId === x.id) {
      engine.stopPreview();
      setPreviewId(null);
      return;
    }
    try {
      setPreviewId(x.id);
      setHeard(null);
      const info = await auditionSample(x);
      setHeard({ id: x.id, ...info });
      if (info.detected) toast(`Tempo erkannt: ${info.bpm} BPM, läuft auf ${getState().project.bpm} BPM`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const insert = (x: Sample) => {
    if (view === 'session') {
      setState({ armedSampleId: x.id, ...(place.column ? {} : { panel: 'none' as const }) });
      toast('Tippe jetzt auf einen leeren Slot');
      return;
    }
    void placeSample(x);
    // The browser column stays (Live); the phone sheet gets out of the way so the new clip is seen.
    if (!place.column) setState({ panel: 'none' });
  };

  const activate = (id: string) => nav.current?.activate(id);

  const root = useBrowserKeys((key) => {
    const list = nav.current;
    if (!list) return false;
    if (key === 'up' || key === 'down') {
      const next = stepSelection(list.ids, sel, key === 'down' ? 1 : -1);
      if (next) {
        (list.pick ?? setSel)(next);
        requestAnimationFrame(() => revealRow(next));
      }
      return true;
    }
    if (key === 'enter') {
      if (sel) list.activate(sel);
      return !!sel;
    }
    if (key === 'right') return !!sel && !!list.open?.(sel);
    return !!list.back?.(sel);
  });

  const words = SEARCHABLE.has(cat) ? searchWords(query) : [];
  const sidebar = width >= SIDEBAR_FROM;
  const label = BROWSER_CATS.find((c) => c.id === cat)?.label ?? '';
  const common = { words, sel, setSel, nav, autoPreview };

  const content = (() => {
    switch (cat) {
      case 'samples':
        return <SampleList {...common} path={path} setPath={setPath} audition={(x, r) => void audition(x, r)} insert={insert} />;
      case 'sounds':
        return <SoundList {...common} drums={false} />;
      case 'drums':
        return <SoundList {...common} drums />;
      case 'fx':
        return <FxList {...common} />;
      case 'midifx':
        return <MidiFxList {...common} />;
      case 'drive':
        return (
          <View style={s.place}>
            <Txt style={s.note}>Samples direkt aus deinem Google Drive vorhören und einfügen, oder ganze Ordner importieren.</Txt>
            <DriveImport />
          </View>
        );
      case 'splice':
        return (
          <View style={s.place}>
            <SpliceSearch />
          </View>
        );
      case 'record':
        return <RecordPlace open={(p) => (setCat('samples'), setPath(p))} />;
      case 'stems':
        return <StemsPlace open={(p) => (setCat('samples'), setPath(p))} />;
    }
  })();

  return (
    <Sheet title="Browser" scroll={false}>
      <View ref={root} style={s.root} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={s.searchRow}>
          <TextInput
            ref={search}
            style={[s.search, !SEARCHABLE.has(cat) && { opacity: 0.45 }]}
            editable={SEARCHABLE.has(cat)}
            placeholder={SEARCHABLE.has(cat) ? `Suchen in ${label} …` : `${label} hat eine eigene Suche`}
            placeholderTextColor={C.dim}
            value={SEARCHABLE.has(cat) ? query : ''}
            onChangeText={setQuery}
            accessibilityLabel="Im Browser suchen"
          />
          {!!query && SEARCHABLE.has(cat) && (
            <Pressable accessibilityLabel="Suche löschen" onPress={() => setQuery('')} style={s.clear} hitSlop={6}>
              <Close size={12} />
            </Pressable>
          )}
        </View>
        <View style={[s.body, !sidebar && { flexDirection: 'column' }]}>
          {sidebar ? (
            <ScrollView style={s.sidebar} contentContainerStyle={{ paddingVertical: 4 }}>
              {(['Kategorien', 'Orte'] as const).map((g) => (
                <View key={g}>
                  <GroupTitle>{g}</GroupTitle>
                  {BROWSER_CATS.filter((c) => c.group === g).map((c) => (
                    <Pressable key={c.id} accessibilityRole="tab" accessibilityLabel={c.label} accessibilityState={{ selected: cat === c.id }} onPress={() => setCat(c.id)} style={[s.side, cat === c.id && s.sideOn]}>
                      <Txt style={[s.sideIcon, cat === c.id && { color: C.accent }]}>{c.icon}</Txt>
                      <Txt numberOfLines={1} style={[s.sideText, cat === c.id && { color: C.text }]}>
                        {c.label}
                      </Txt>
                    </Pressable>
                  ))}
                </View>
              ))}
            </ScrollView>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabsScroll} contentContainerStyle={s.tabs}>
              {BROWSER_CATS.map((c) => (
                <Pressable key={c.id} accessibilityRole="tab" accessibilityLabel={c.label} accessibilityState={{ selected: cat === c.id }} onPress={() => setCat(c.id)} style={[s.tab, cat === c.id && s.tabOn]}>
                  <Txt style={[s.tabText, cat === c.id && { color: C.accentInk }]}>{`${c.icon} ${c.label}`}</Txt>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <ScrollView style={s.content} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
            {content}
          </ScrollView>
        </View>
        <PreviewStrip sel={sel} autoPreview={autoPreview} setAutoPreview={setAutoPreview} previewId={previewId} heardBpm={heard} audition={(x) => void audition(x)} activate={activate} />
      </View>
    </Sheet>
  );
}

/** Orte › Aufnahmen: record the microphone or upload files from this device; both land in the library (folders Aufnahmen / Uploads). */
function RecordPlace({ open }: { open: (path: string) => void }) {
  const samples = useStore((st) => st.samples);
  const upload = async () => {
    try {
      const added = await importSamplesFromDevice();
      if (!added.length) return;
      setSamples([...getState().samples, ...added]);
      toast(`${added.length} Datei(en) hinzugefügt`);
      const tempos = await autoDetectTempos(added);
      if (tempos) toast(`Tempo bei ${tempos} Loop(s) automatisch erkannt`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <View style={s.place}>
      <Txt style={s.note}>Mit dem Mikrofon aufnehmen (Ordner „Aufnahmen“) oder Dateien von diesem Gerät in die Library laden (Ordner „Uploads“).</Txt>
      <View style={s.wrap}>
        <RecordButton />
        <Btn small onPress={() => void upload()}>
          <Upload size={14} />
          Vom Gerät hochladen
        </Btn>
      </View>
      {OWN_FOLDERS.map((f) => {
        const n = countIn(samples, f).total;
        return n > 0 ? <BrowserRow key={f} id={`f:${f}`} title={f} sub={`${n} Datei(en)`} glyph="▤" color="#d8b45a" selected={false} onSelect={() => open(f)} /> : null;
      })}
    </View>
  );
}

/** Orte › Stems: split a finished tune into stems (ElevenLabs), and the tunes already split. */
function StemsPlace({ open }: { open: (path: string) => void }) {
  const samples = useStore((st) => st.samples);
  const extra = useStore((st) => st.folders);
  const status = useStore((st) => st.stemStatus);
  const tunes = childFolders(allFolders(samples, extra), 'Stems Export');
  return (
    <View style={s.place}>
      <Txt style={s.note}>Einen fertigen Tune hochladen: die KI trennt ihn in Drums, Bass, Synth + FX, Keys, Gitarre und Vocal. Die Stems landen im Ordner „Stems Export / Name des Tunes“.</Txt>
      <View style={s.wrap}>
        <Btn small kind="primary" disabled={status !== null} accessibilityLabel="Tune in Stems trennen" onPress={() => void startStemSeparation()}>
          {status ? 'Läuft …' : 'Tune hochladen und trennen'}
        </Btn>
      </View>
      {status && <Txt style={[s.note, { color: C.accent }]}>{status}</Txt>}
      {tunes.length > 0 && <GroupTitle>Getrennte Tunes</GroupTitle>}
      {tunes.map((f) => (
        <BrowserRow key={f} id={`f:${f}`} title={nameOf(f)} sub={`${countIn(samples, f).total} Stems`} glyph="▤" color="#d8b45a" selected={false} onSelect={() => open(f)} />
      ))}
      {!tunes.length && !status && <Txt style={browserStyles.empty}>Noch keine getrennten Tunes.</Txt>}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingBottom: 6 },
  search: { flex: 1, height: 32, borderRadius: 6, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, paddingLeft: 10, paddingRight: 28, color: C.text, ...font(400), fontSize: 13, outlineWidth: 0 },
  clear: { position: 'absolute', right: 18, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minHeight: 0, flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line },
  sidebar: { width: SIDEBAR_W, flexGrow: 0, borderRightWidth: 1, borderRightColor: C.line, backgroundColor: C.bg },
  side: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 28, paddingHorizontal: 10, marginHorizontal: 4, borderRadius: 5 },
  sideOn: { backgroundColor: C.panel2 },
  sideIcon: { width: 12, textAlign: 'center', fontSize: 11, color: C.dim },
  sideText: { ...font(500), fontSize: 12, color: C.muted, flex: 1 },
  tabsScroll: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: C.line },
  tabs: { gap: 5, paddingHorizontal: 8, paddingVertical: 6 },
  tab: { height: 26, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: C.accent, borderColor: C.accent },
  tabText: { ...font(600), fontSize: 11.5, color: C.text },
  content: { flex: 1, minWidth: 0, minHeight: 0 },
  place: { padding: 10, gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  note: { ...font(400), fontSize: 12, color: C.muted, lineHeight: 17 },
});
