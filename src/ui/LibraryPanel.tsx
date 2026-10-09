import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { C, font, mono } from '../constants/theme';
import { engine } from '../audio/engine';
import { placeSample } from '../lib/actions';
import { CATEGORY_COLORS, CATEGORY_LABELS, KEYS } from '../lib/project';
import { deleteSample, importSamplesFromDevice } from '../lib/samples';
import { errorText, getState, setSamples, setState, toast, upsertSample, useStore } from '../lib/store';
import { db } from '../storage/db';
import type { Sample, SampleCategory } from '../types';
import { useEngine } from './hooks';
import { Check, Play, Plus, Stop, Upload } from './icons';
import { Btn, Chip, IconBtn, Section, Txt } from './kit';
import { Sheet } from './Sheet';

const FILTERS: (SampleCategory | 'all')[] = ['all', 'kick', 'top', 'synth', 'vocal', 'other'];

export function LibraryPanel() {
  const samples = useStore((st) => st.samples);
  const project = useStore((st) => st.project);
  const view = useStore((st) => st.view);
  const [filter, setFilter] = useState<SampleCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [tempoMatch, setTempoMatch] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewing = useEngine(() => engine.isPreviewing());

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return samples
      .filter((x) => filter === 'all' || x.category === filter)
      .filter((x) => !q || x.name.toLowerCase().includes(q) || (x.folder ?? '').toLowerCase().includes(q))
      .filter((x) => !tempoMatch || !x.bpm || Math.abs(x.bpm - project.bpm) <= 2)
      .sort((a, b) => (a.folder ?? '').localeCompare(b.folder ?? '') || a.name.localeCompare(b.name));
  }, [samples, filter, query, tempoMatch, project.bpm]);

  const upload = async () => {
    try {
      const added = await importSamplesFromDevice();
      if (!added.length) return;
      setSamples([...getState().samples, ...added]);
      toast(`${added.length} Datei(en) hinzugefügt`);
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
      await engine.preview(x, project.bpm);
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
      <Section title="Google Drive">
        <Txt style={s.note}>Drive ist noch nicht eingerichtet. Samples kannst du direkt vom Gerät hochladen.</Txt>
        <View style={[s.row, { marginTop: 10 }]}>
          <Btn small onPress={() => void upload()}>
            <Upload size={14} />
            Vom Gerät hochladen
          </Btn>
        </View>
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
      </ScrollView>

      {list.length === 0 && <Txt style={[s.muted, { marginVertical: 14 }]}>Keine Samples gefunden.</Txt>}

      {list.map((x) => (
        <View key={x.id} style={s.sample}>
          <View style={s.sampleMain}>
            <IconBtn onPress={() => void togglePreview(x)} accessibilityLabel="Vorhören">
              {previewing && previewId === x.id ? <Stop size={14} /> : <Play size={14} />}
            </IconBtn>
            <Pressable style={s.sampleName} onPress={() => setEditing(editing === x.id ? null : x.id)}>
              <Txt numberOfLines={1} style={{ fontSize: 13 }}>
                {x.name.replace(/\.[a-z0-9]+$/i, '')}
              </Txt>
              <Txt numberOfLines={1} style={s.meta}>
                <Txt style={[s.meta, { color: CATEGORY_COLORS[x.category] }]}>●</Txt> {x.bpm ? `${x.bpm} BPM` : 'One-Shot'}
                {x.key ? ` · ${x.key}` : ''}
                {x.folder ? ` · ${x.folder}` : ''}
              </Txt>
            </Pressable>
            <Btn small onPress={() => add(x)} accessibilityLabel="Hinzufügen">
              <Plus size={14} />
            </Btn>
          </View>
          {editing === x.id && <SampleEditor sample={x} onDone={() => setEditing(null)} />}
        </View>
      ))}
    </Sheet>
  );
}

function SampleEditor({ sample, onDone }: { sample: Sample; onDone: () => void }) {
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
      <Btn small kind="danger" style={s.cell} onPress={() => void remove()}>
        Entfernen
      </Btn>
      <View style={s.cell} />
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
});
