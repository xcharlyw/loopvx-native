import { useMemo, useState, type MutableRefObject } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { C, font, mono } from '../../constants/theme';
import { sampleMatches, shortKey } from '../../lib/browser';
import { allFolders, childFolders, moveSamples, normPath, parentOf, prettyPath, samplesIn } from '../../lib/folders';
import { keysFit, sortSamples, type SortBy } from '../../lib/libraryFilter';
import { CATEGORY_COLORS, CATEGORY_LABELS, KEYS } from '../../lib/project';
import { deleteSample } from '../../lib/samples';
import { downloadSample } from '../../lib/actions';
import { getState, removeSamples, setSamples, toast, upsertSample, upsertSamples, useStore } from '../../lib/store';
import { db } from '../../storage/db';
import type { Sample, SampleCategory } from '../../types';
import { confirmDestructive } from '../confirm';
import { Check } from '../icons';
import { Btn, Txt } from '../kit';
import { FolderBar, FolderPicker, FolderRows } from '../LibraryFolders';
import { BrowserRow, RowAction, browserStyles } from './Row';
import { useNav, type NavList } from './nav';

// The samples of the library, like Live's content pane: tag filters (category, project tempo, key), a sortable column header,
// folders to browse (without a search or filter) and one compact row per sample. Row ids: `s:<sampleId>`, folders `f:<path>`.

const FILTERS: (SampleCategory | 'all')[] = ['all', 'kick', 'top', 'synth', 'vocal', 'other'];
const SHORT: Record<SampleCategory, string> = { kick: 'Kick', top: 'Top', synth: 'Synth', vocal: 'Vocal', other: 'Sonst.' };
export const COL_BPM = 40;
export const COL_KEY = 40;


export const baseName = (name: string) => name.replace(/\.[a-z0-9]+$/i, '');

interface Props {
  words: string[];
  sel: string | null;
  setSel: (id: string | null) => void;
  nav: MutableRefObject<NavList | null>;
  path: string;
  setPath: (p: string) => void;
  /** A tap auditions (Live's preview switch). */
  autoPreview: boolean;
  audition: (x: Sample, restart?: boolean) => void;
  insert: (x: Sample) => void;
}

export function SampleList({ words, sel, setSel, nav, path, setPath, autoPreview, audition, insert }: Props) {
  const samples = useStore((st) => st.samples);
  const extra = useStore((st) => st.folders);
  const bpm = useStore((st) => st.project.bpm);
  const key = useStore((st) => st.project.key);
  const [filter, setFilter] = useState<SampleCategory | 'all'>('all');
  const [tempoMatch, setTempoMatch] = useState(false);
  const [keyMatch, setKeyMatch] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [editing, setEditing] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [picking, setPicking] = useState(false);
  // Without a search or filter the library is browsed folder by folder; with one, all folders are searched at once.
  const browsing = !words.length && filter === 'all' && !tempoMatch && !keyMatch;

  const list = useMemo(() => {
    if (browsing) return sortSamples(samplesIn(samples, path), sortBy);
    return sortSamples(
      samples
        .filter((x) => filter === 'all' || x.category === filter)
        .filter((x) => sampleMatches(x, words))
        .filter((x) => !tempoMatch || !x.bpm || Math.abs(x.bpm - bpm) <= 2)
        .filter((x) => !keyMatch || keysFit(x.key, key)),
      sortBy,
    );
  }, [samples, filter, words, tempoMatch, keyMatch, sortBy, bpm, key, browsing, path]);
  const folders = browsing ? childFolders(allFolders(samples, extra), path) : [];

  const tick = (id: string) =>
    setTicked((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setTicked(new Set());
    setPicking(false);
  };
  const moveTo = async (folder: string) => {
    const changed = moveSamples(samples, ticked, folder);
    await upsertSamples(changed);
    toast(changed.length ? `${changed.length} Sample(s) nach „${folder ? prettyPath(folder) : 'Hauptebene'}“ verschoben` : 'Die Samples liegen dort schon.');
    stopSelecting();
  };
  const removeTicked = async () => {
    const doomed = samples.filter((x) => ticked.has(x.id));
    if (!doomed.length) return;
    const ok = await confirmDestructive(`${doomed.length} Sample(s) löschen?`, 'Sie werden auch aus deinem Drive-Ordner LOOPVX entfernt (Papierkorb). Clips in Projekten, die diese Samples nutzen, werden stumm. Deine Originale in Drive bleiben unberührt.', 'Löschen');
    if (!ok) return;
    await removeSamples(doomed, deleteSample);
    toast(`${doomed.length} Sample(s) gelöscht`);
    stopSelecting();
  };

  const byId = new Map(list.map((x) => [`s:${x.id}`, x]));
  // The keys moved onto a sample: it plays like a tap (Live auditions while you walk the list).
  const pick = (x: Sample) => {
    setSel(`s:${x.id}`);
    if (autoPreview) audition(x);
  };
  useNav(nav, {
    pick: (id) => (byId.get(id) ? pick(byId.get(id)!) : setSel(id)),
    ids: [...folders.map((f) => `f:${f}`), ...list.map((x) => `s:${x.id}`)],
    activate: (id) => {
      if (id.startsWith('f:')) setPath(id.slice(2));
      else if (byId.get(id)) insert(byId.get(id)!);
    },
    open: (id) => {
      if (!id.startsWith('f:')) return false;
      setPath(id.slice(2));
      return true;
    },
    back: () => {
      if (!browsing || !path) return false;
      setSel(`f:${path}`);
      setPath(parentOf(path));
      return true;
    },
  });
  const sortHead = (k: SortBy, label: string, width?: number) => (
    <Pressable accessibilityLabel={`Sortieren nach ${label}`} onPress={() => setSortBy(k)} style={width ? { width, alignItems: 'flex-end' } : undefined} hitSlop={4}>
      <Txt style={[s.head, sortBy === k && { color: C.accent }]}>{`${label}${sortBy === k ? ' ▾' : ''}`}</Txt>
    </Pressable>
  );

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.tags}>
        {FILTERS.map((f) => (
          <Tag key={f} on={filter === f} onPress={() => setFilter(f)} color={f === 'all' ? undefined : CATEGORY_COLORS[f]} label={f === 'all' ? 'Alle' : SHORT[f]} a11y={f === 'all' ? 'Alle Kategorien' : CATEGORY_LABELS[f]} />
        ))}
        <Tag on={tempoMatch} onPress={() => setTempoMatch(!tempoMatch)} label={`${bpm} BPM`} a11y="Nur im Projekttempo" />
        <Tag on={keyMatch} onPress={() => setKeyMatch(!keyMatch)} label={`♮ ${key}`} a11y="Nur passende Tonarten" />
      </ScrollView>

      {browsing && <FolderBar path={path} setPath={setPath} selecting={selecting} onSelecting={(on) => (on ? setSelecting(true) : stopSelecting())} />}
      {selecting && (
        <View style={s.selectBar}>
          <Txt style={s.note}>{`${ticked.size} ausgewählt`}</Txt>
          <RowAction label="Alle hier" onPress={() => setTicked(new Set(list.map((x) => x.id)))} />
          <RowAction label="Keine" onPress={() => setTicked(new Set())} />
          <Btn small kind="primary" disabled={!ticked.size} accessibilityLabel="Ausgewählte verschieben" onPress={() => setPicking(true)}>
            Verschieben …
          </Btn>
          <Btn small disabled={!ticked.size} accessibilityLabel="Ausgewählte löschen" onPress={() => void removeTicked()}>
            <Txt style={{ color: C.danger, fontSize: 12 }}>Löschen</Txt>
          </Btn>
        </View>
      )}
      {picking && <FolderPicker count={ticked.size} onPick={(f) => void moveTo(f)} onClose={() => setPicking(false)} />}

      <View style={s.headRow}>
        {sortHead('name', 'Name')}
        {sortHead('new', 'Neu')}
        <View style={{ flex: 1 }} />
        {sortHead('bpm', 'BPM', COL_BPM)}
        {sortHead('key', 'Tonart', COL_KEY)}
        <View style={{ width: 28 }} />
      </View>

      {browsing && <FolderRows path={path} setPath={setPath} selected={sel?.startsWith('f:') ? sel.slice(2) : null} />}

      {list.length === 0 && !browsing && <Txt style={browserStyles.empty}>Keine Samples gefunden.</Txt>}
      {list.length === 0 && browsing && !samples.length && <Txt style={browserStyles.empty}>Noch keine Samples. Lade welche vom Gerät hoch (Orte › Aufnahmen) oder hol sie aus Google Drive oder Splice.</Txt>}

      {list.map((x) => {
        const id = `s:${x.id}`;
        const isSel = sel === id;
        return (
          <View key={x.id}>
            <BrowserRow
              id={id}
              title={baseName(x.name)}
              sub={!browsing && x.folder ? prettyPath(normPath(x.folder)) : undefined}
              color={CATEGORY_COLORS[x.category]}
              glyph={selecting ? (ticked.has(x.id) ? '☑' : '☐') : undefined}
              cols={[
                { text: x.bpm ? String(Math.round(x.bpm * 10) / 10) : '—', width: COL_BPM },
                { text: shortKey(x.key), width: COL_KEY },
              ]}
              selected={isSel}
              onSelect={() => (selecting ? tick(x.id) : pick(x))}
              onActivate={selecting ? undefined : () => insert(x)}
              addLabel="Hinzufügen"
              drag={selecting ? null : { kind: 'sample', sampleId: x.id, name: x.name }}
              actions={!selecting ? <RowAction label="⋯" accessibilityLabel={`${x.name} bearbeiten`} onPress={() => setEditing(editing === x.id ? null : x.id)} /> : undefined}
            />
            {editing === x.id && isSel && !selecting && (
              <SampleEditor
                sample={x}
                onDone={() => setEditing(null)}
                onMove={() => {
                  setEditing(null);
                  setSelecting(true);
                  setTicked(new Set([x.id]));
                  setPicking(true);
                }}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

function Tag({ on, onPress, label, color, a11y }: { on: boolean; onPress: () => void; label: string; color?: string; a11y: string }) {
  return (
    <Pressable accessibilityLabel={a11y} accessibilityState={{ selected: on }} onPress={onPress} style={[s.tag, on && s.tagOn]}>
      {color && <View style={[s.tagDot, { backgroundColor: color }]} />}
      <Txt style={[s.tagText, on && { color: C.accentInk }]}>{label}</Txt>
    </Pressable>
  );
}

function SampleEditor({ sample, onDone, onMove }: { sample: Sample; onDone: () => void; onMove: () => void }) {
  const [bpm, setBpm] = useState(sample.bpm ? String(sample.bpm) : '');
  const [key, setKey] = useState(sample.key ?? '');
  const [category, setCategory] = useState<SampleCategory>(sample.category);
  const categories = Object.keys(CATEGORY_LABELS) as SampleCategory[];
  const keys = ['', ...KEYS, ...(key && !KEYS.includes(key) ? [key] : [])];

  const save = async () => {
    const v = Number(bpm.replace(',', '.'));
    await upsertSample({ ...sample, bpm: v >= 40 && v <= 250 ? v : undefined, key: key || undefined, category });
    onDone();
  };
  const remove = async () => {
    await deleteSample(sample);
    await db.deleteSample(sample.id);
    setSamples(getState().samples.filter((x) => x.id !== sample.id));
    onDone();
  };
  const cycle = <T,>(list: T[], current: T) => list[(list.indexOf(current) + 1) % list.length];

  return (
    <View style={s.edit}>
      <TextInput style={[s.field, s.fieldInput]} inputMode="decimal" placeholder="BPM" placeholderTextColor={C.dim} value={bpm} onChangeText={setBpm} accessibilityLabel="Tempo" />
      <Pressable style={s.field} accessibilityLabel="Tonart" onPress={() => setKey(cycle(keys, key))}>
        <Txt numberOfLines={1} style={s.fieldText}>
          {key || 'Tonart'}
        </Txt>
      </Pressable>
      <Pressable style={s.field} accessibilityLabel="Kategorie" onPress={() => setCategory(cycle(categories, category))}>
        <Txt numberOfLines={1} style={s.fieldText}>
          {CATEGORY_LABELS[category]}
        </Txt>
      </Pressable>
      <Btn small style={s.cell} accessibilityLabel="Sample in Ordner verschieben" onPress={onMove}>
        In Ordner
      </Btn>
      <Btn small kind="danger" style={s.cell} onPress={() => void remove()}>
        Entfernen
      </Btn>
      <Btn small style={s.cell} onPress={() => void downloadSample(sample)}>
        Download
      </Btn>
      <Btn small kind="primary" style={s.cell} onPress={() => void save()}>
        <Check size={14} color={C.accentInk} />
        Speichern
      </Btn>
    </View>
  );
}

const s = StyleSheet.create({
  note: { color: C.muted, fontSize: 12 },
  tags: { gap: 5, paddingHorizontal: 8, paddingVertical: 6 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingHorizontal: 9, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel },
  tagOn: { backgroundColor: C.accent, borderColor: C.accent },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagText: { ...font(600), fontSize: 11, color: C.text },
  selectBar: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingHorizontal: 8, paddingVertical: 6 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 20, paddingRight: 6, height: 24, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.bg },
  head: { ...font(600), fontSize: 10, letterSpacing: 0.6, color: C.muted },
  edit: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 8, backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line },
  field: { flexBasis: '31%', flexGrow: 1, height: 32, borderRadius: 6, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel2, paddingHorizontal: 8, justifyContent: 'center' },
  fieldInput: { color: C.text, ...font(400), fontSize: 13, outlineWidth: 0 },
  fieldText: { fontSize: 13 },
  cell: { flexBasis: '31%', flexGrow: 1 },
  mono: { ...mono(), fontSize: 11 },
});
