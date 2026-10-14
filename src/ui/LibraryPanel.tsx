import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { C, font, mono } from '../constants/theme';
import { engine } from '../audio/engine';
import { auditionSample, autoDetectTempos, downloadSample, placeSample, type AuditionInfo } from '../lib/actions';
import { moveSamples, prettyPath, normPath, samplesIn } from '../lib/folders';
import { SORT_LABELS, keysFit, sortSamples, type SortBy } from '../lib/libraryFilter';
import { CATEGORY_COLORS, CATEGORY_LABELS, KEYS } from '../lib/project';
import { deleteSample, importSamplesFromDevice } from '../lib/samples';
import { startStemSeparation } from '../lib/stems';
import { errorText, getState, removeSamples, setSamples, setState, toast, upsertSample, upsertSamples, useStore } from '../lib/store';
import { db } from '../storage/db';
import type { Sample, SampleCategory } from '../types';
import { DriveImport } from './DriveImport';
import { SpliceSearch } from './SpliceSearch';
import { useEngine } from './hooks';
import { Check, Play, Plus, Stop, Upload } from './icons';
import { FolderBar, FolderPicker, FolderRows } from './LibraryFolders';
import { confirmDestructive } from './confirm';
import { RecordButton } from './RecordButton';
import { PreviewLevel, previewStyles } from './PreviewLevel';
import { Btn, Chip, IconBtn, Section, Txt } from './kit';
import { Sheet } from './Sheet';
import { sampleDragJustEnded, useSampleDragSource } from './dnd';
import { web } from './drag';

const FILTERS: (SampleCategory | 'all')[] = ['all', 'kick', 'top', 'synth', 'vocal', 'other'];

export function LibraryPanel() {
  const samples = useStore((st) => st.samples);
  const project = useStore((st) => st.project);
  const view = useStore((st) => st.view);
  const [filter, setFilter] = useState<SampleCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [tempoMatch, setTempoMatch] = useState(false);
  const [keyMatch, setKeyMatch] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [editing, setEditing] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [heard, setHeard] = useState<({ id: string } & AuditionInfo) | null>(null);
  const previewing = useEngine(() => engine.isPreviewing());
  const playingSample = previewing && previewId ? samples.find((x) => x.id === previewId) : undefined;
  const [path, setPath] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const stemStatus = useStore((st) => st.stemStatus);
  const jump = useStore((st) => st.libraryJump);
  // After a stem separation the Library opens the stems' folder.
  useEffect(() => {
    if (!jump) return;
    setQuery('');
    setFilter('all');
    setPath(jump);
    setState({ libraryJump: null });
  }, [jump]);
  // Without a search or filter the library is browsed folder by folder; with one, all folders are searched at once.
  const browsing = !query.trim() && filter === 'all' && !tempoMatch && !keyMatch;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (browsing) return sortSamples(samplesIn(samples, path), sortBy);
    return sortSamples(
      samples
        .filter((x) => filter === 'all' || x.category === filter)
        .filter((x) => !q || x.name.toLowerCase().includes(q) || (x.folder ?? '').toLowerCase().includes(q))
        .filter((x) => !tempoMatch || !x.bpm || Math.abs(x.bpm - project.bpm) <= 2)
        .filter((x) => !keyMatch || keysFit(x.key, project.key)),
      sortBy,
    );
  }, [samples, filter, query, tempoMatch, keyMatch, sortBy, project.bpm, project.key, browsing, path]);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
    setPicking(false);
  };
  const moveTo = async (folder: string) => {
    const changed = moveSamples(samples, selected, folder);
    await upsertSamples(changed);
    toast(changed.length ? `${changed.length} Sample(s) nach „${folder ? prettyPath(folder) : 'Hauptebene'}“ verschoben` : 'Die Samples liegen dort schon.');
    stopSelecting();
  };

  const removeSelected = async () => {
    const doomed = samples.filter((x) => selected.has(x.id));
    if (!doomed.length) return;
    const ok = await confirmDestructive(`${doomed.length} Sample(s) löschen?`, 'Sie werden auch aus deinem Drive-Ordner LOOPVX entfernt (Papierkorb). Clips in Projekten, die diese Samples nutzen, werden stumm. Deine Originale in Drive bleiben unberührt.', 'Löschen');
    if (!ok) return;
    await removeSamples(doomed, deleteSample);
    toast(`${doomed.length} Sample(s) gelöscht`);
    stopSelecting();
  };

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

  const togglePreview = async (x: Sample) => {
    if (previewing && previewId === x.id) {
      engine.stopPreview();
      setPreviewId(null);
      return;
    }
    try {
      setPreviewId(x.id);
      setHeard(null);
      const info = await auditionSample(x);
      setHeard({ id: x.id, ...info });
      if (info.detected) toast(`Tempo erkannt: ${info.bpm} BPM, läuft auf ${project.bpm} BPM`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const add = (x: Sample) => {
    if (view === 'session') {
      setState({ armedSampleId: x.id, panel: 'none' });
      toast('Tippe jetzt auf einen leeren Slot');
      return;
    }
    void placeSample(x);
    setState({ panel: 'none' });
  };

  return (
    <Sheet title="Library">
      <Section title="Stems trennen">
        <Txt style={s.note}>Einen fertigen Tune hochladen: die KI trennt ihn in Drums, Bass, Synth + FX, Keys, Gitarre und Vocal. Die Stems landen hier im Ordner „Stems Export / Name des Tunes“.</Txt>
        <View style={[s.row, { marginTop: 10 }]}>
          <Btn small kind="primary" disabled={stemStatus !== null} accessibilityLabel="Tune in Stems trennen" onPress={() => void startStemSeparation()}>
            {stemStatus ? 'Läuft …' : 'Tune hochladen und trennen'}
          </Btn>
        </View>
        {stemStatus && <Txt style={[s.note, { marginTop: 8, color: C.accent }]}>{stemStatus}</Txt>}
      </Section>

      <Section title="Google Drive">
        <Txt style={s.note}>Samples direkt aus deinem Google Drive vorhören und einfügen, oder vom Gerät hochladen.</Txt>
        <View style={[s.row, { marginTop: 10 }]}>
          <Btn small onPress={() => void upload()}>
            <Upload size={14} />
            Vom Gerät hochladen
          </Btn>
          <RecordButton />
        </View>
        <View style={{ marginTop: 10 }}>
          <DriveImport />
        </View>
      </Section>

      <Section title="Splice">
        <SpliceSearch />
      </Section>

      <TextInput style={s.search} placeholder="Suchen …" placeholderTextColor={C.dim} value={query} onChangeText={setQuery} />
      <ScrollView horizontal style={s.filtersScroll} contentContainerStyle={s.filters}>
        {FILTERS.map((f) => (
          <Chip key={f} variant={filter === f ? 'on' : 'ghost'} onPress={() => setFilter(f)}>
            {f === 'all' ? 'Alle' : CATEGORY_LABELS[f]}
          </Chip>
        ))}
        <Chip variant={tempoMatch ? 'on' : 'ghost'} onPress={() => setTempoMatch(!tempoMatch)}>
          {`${project.bpm} BPM`}
        </Chip>
        <Chip variant={keyMatch ? 'on' : 'ghost'} accessibilityLabel="Nur passende Tonarten" onPress={() => setKeyMatch(!keyMatch)}>
          {`Passt zu ${project.key}`}
        </Chip>
      </ScrollView>
      <ScrollView horizontal style={s.filtersScroll} contentContainerStyle={s.filters}>
        <Txt style={s.note}>Sortieren:</Txt>
        {(Object.keys(SORT_LABELS) as SortBy[]).map((k) => (
          <Chip key={k} variant={sortBy === k ? 'on' : 'ghost'} accessibilityLabel={`Sortieren nach ${SORT_LABELS[k]}`} onPress={() => setSortBy(k)} textStyle={{ fontSize: 12 }}>
            {SORT_LABELS[k]}
          </Chip>
        ))}
      </ScrollView>

      {browsing && <FolderBar path={path} setPath={setPath} selecting={selecting} onSelecting={(on) => (on ? setSelecting(true) : stopSelecting())} />}
      {selecting && (
        <View style={[s.row, { marginBottom: 8 }]}>
          <Txt style={s.note}>{`${selected.size} ausgewählt`}</Txt>
          <Chip onPress={() => setSelected(new Set(list.map((x) => x.id)))} textStyle={{ fontSize: 12 }}>
            Alle hier
          </Chip>
          <Chip onPress={() => setSelected(new Set())} textStyle={{ fontSize: 12 }}>
            Keine
          </Chip>
          <Btn small kind="primary" disabled={!selected.size} accessibilityLabel="Ausgewählte verschieben" onPress={() => setPicking(true)}>
            Verschieben …
          </Btn>
          <Btn small disabled={!selected.size} accessibilityLabel="Ausgewählte löschen" onPress={() => void removeSelected()}>
            <Txt style={{ color: C.danger }}>Löschen</Txt>
          </Btn>
        </View>
      )}
      {picking && <FolderPicker count={selected.size} onPick={(f) => void moveTo(f)} onClose={() => setPicking(false)} />}
      {browsing && <FolderRows path={path} setPath={setPath} />}

      <PreviewLevel category={playingSample?.category}>
        {previewing && playingSample ? (
          <Txt numberOfLines={2} style={previewStyles.playing}>
            {`▶ ${playingSample.name.replace(/\.[a-z0-9]+$/i, '')} · ${playingSample.bpm ? `${heard?.id === playingSample.id && heard.detected ? '~' : ''}${playingSample.bpm} → ${project.bpm} BPM` : 'ohne Tempo: Originaltempo'}${engine.playing ? ' · im Takt zum Song' : ''}`}
          </Txt>
        ) : (
          <Txt style={s.muted}>▶ spielt ein Sample im Projekttempo, im Takt zum laufenden Song.</Txt>
        )}
      </PreviewLevel>
      {list.length === 0 && !browsing && <Txt style={[s.muted, { marginVertical: 14 }]}>Keine Samples gefunden.</Txt>}
      {list.length === 0 && browsing && !samples.length && <Txt style={[s.muted, { marginVertical: 14 }]}>Noch keine Samples. Lade welche hoch oder importiere sie aus Drive oder Splice.</Txt>}

      {list.map((x) => (
        <View key={x.id} style={s.sample}>
          <View style={s.sampleMain}>
            {selecting && (
              <Pressable accessibilityLabel={`${x.name} auswählen`} accessibilityState={{ checked: selected.has(x.id) }} onPress={() => toggle(x.id)} style={[s.check, selected.has(x.id) && s.checkOn]}>
                {selected.has(x.id) && <Check size={12} color={C.accentInk} />}
              </Pressable>
            )}
            <IconBtn onPress={() => void togglePreview(x)} accessibilityLabel="Vorhören">
              {previewing && previewId === x.id ? <Stop size={14} /> : <Play size={14} />}
            </IconBtn>
            <DragName sample={x} disabled={selecting} onPress={() => (selecting ? toggle(x.id) : setEditing(editing === x.id ? null : x.id))}>
              <Txt numberOfLines={1} style={{ fontSize: 13 }}>
                {x.name.replace(/\.[a-z0-9]+$/i, '')}
              </Txt>
              <Txt numberOfLines={1} style={s.meta}>
                <Txt style={[s.meta, { color: CATEGORY_COLORS[x.category] }]}>●</Txt> {x.bpm ? `${x.bpm} BPM` : 'One-Shot'}
                {x.key ? ` · ${x.key}` : ''}
                {!browsing && x.folder ? ` · ${prettyPath(normPath(x.folder))}` : ''}
              </Txt>
            </DragName>
            <Btn small onPress={() => add(x)} accessibilityLabel="Hinzufügen">
              <Plus size={14} />
            </Btn>
          </View>
          {editing === x.id && !selecting && (
            <SampleEditor
              sample={x}
              onDone={() => setEditing(null)}
              onMove={() => {
                setEditing(null);
                setSelecting(true);
                setSelected(new Set([x.id]));
                setPicking(true);
              }}
            />
          )}
        </View>
      ))}
    </Sheet>
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
      <TextInput style={[s.field, s.fieldInput]} inputMode="decimal" placeholder="BPM" placeholderTextColor={C.dim} value={bpm} onChangeText={setBpm} />
      <Pressable style={s.field} onPress={() => setKey(cycle(keys, key))}>
        <Txt numberOfLines={1} style={s.fieldText}>
          {key || 'Tonart'}
        </Txt>
      </Pressable>
      <Pressable style={s.field} onPress={() => setCategory(cycle(categories, category))}>
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
  note: { color: C.muted, fontSize: 13 },
  muted: { color: C.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  search: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panel,
    paddingHorizontal: 12,
    marginBottom: 8,
    color: C.text,
    ...font(400),
    fontSize: 14,
    outlineWidth: 0,
  },
  filtersScroll: { flexGrow: 0 },
  filters: { gap: 6, paddingBottom: 8 },
  sample: { borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  sampleMain: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  sampleName: { flex: 1, minWidth: 0 },
  meta: { ...mono(), fontSize: 11, color: C.muted },
  edit: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 10 },
  field: {
    flexBasis: '31%',
    flexGrow: 1,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panel2,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  fieldInput: { color: C.text, ...font(400), fontSize: 14, outlineWidth: 0 },
  fieldText: { fontSize: 14 },
  cell: { flexBasis: '31%', flexGrow: 1 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: C.accent, borderColor: C.accent },
});

/** A sample's name in the list, and the handle to drag it into the sampler (web: mouse drag, or hold then drag on touch). */
function DragName({ sample, disabled, onPress, children }: { sample: Sample; disabled: boolean; onPress: () => void; children: ReactNode }) {
  const ref = useSampleDragSource(disabled ? null : { sampleId: sample.id, name: sample.name });
  return (
    <View ref={ref} style={[s.sampleName, web({ WebkitTouchCallout: 'none', userSelect: 'none', cursor: 'grab' })]}>
      <Pressable onPress={() => !sampleDragJustEnded() && onPress()}>{children}</Pressable>
    </View>
  );
}
