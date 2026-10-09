import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CategoryColors, Colors, Spacing } from '../constants/theme';
import { engine } from '../audio/engine';
import { placeSample } from '../lib/actions';
import { CATEGORY_LABELS } from '../lib/project';
import { deleteSample, importSamplesFromDevice } from '../lib/samples';
import { errorText, getState, setSamples, setState, toast, upsertSample, useStore } from '../lib/store';
import type { Sample, SampleCategory } from '../types';
import { useEngine } from './hooks';

const FILTERS: (SampleCategory | 'all')[] = ['all', 'kick', 'top', 'synth', 'vocal', 'other'];

export function LibraryPanel() {
  const samples = useStore((s) => s.samples);
  const project = useStore((s) => s.project);
  const view = useStore((s) => s.view);
  const [filter, setFilter] = useState<SampleCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const previewing = useEngine(() => engine.isPreviewing());

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return samples
      .filter((s) => filter === 'all' || s.category === filter)
      .filter((s) => !q || s.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [samples, filter, query]);

  const doImport = async () => {
    setImporting(true);
    try {
      const added = await importSamplesFromDevice();
      if (added.length) {
        setSamples([...getState().samples, ...added]);
        toast(`${added.length} Sample(s) hinzugefügt`);
      }
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setImporting(false);
    }
  };

  const togglePreview = async (s: Sample) => {
    if (previewing && previewId === s.id) {
      engine.stopPreview();
      setPreviewId(null);
      return;
    }
    try {
      setPreviewId(s.id);
      await engine.preview(s, project.bpm);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const add = (s: Sample) => {
    if (view === 'session') {
      setState({ armedSampleId: s.id, panel: 'none' });
      toast('Tippe jetzt auf einen leeren Slot');
      return;
    }
    void placeSample(s);
    setState({ panel: 'none' });
  };

  const remove = (s: Sample) => {
    deleteSample(s);
    setSamples(getState().samples.filter((x) => x.id !== s.id));
    setEditing(null);
  };

  return (
    <View style={styles.sheet}>
      <View style={styles.head}>
        <Text style={styles.title}>Library</Text>
        <Pressable onPress={() => setState({ panel: 'none' })}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <Pressable style={styles.importBtn} onPress={() => void doImport()} disabled={importing}>
          <Text style={styles.importBtnText}>{importing ? 'Importiere …' : '+ Samples vom Gerät importieren'}</Text>
        </Pressable>
        <Text style={styles.note}>Google-Drive-Sync folgt in einer späteren Phase.</Text>

        <TextInput style={styles.search} placeholder="Suchen …" placeholderTextColor={Colors.textSecondary} value={query} onChangeText={setQuery} />

        <ScrollView horizontal style={styles.filters} contentContainerStyle={{ gap: 6 }}>
          {FILTERS.map((f) => (
            <Pressable key={f} style={[styles.chip, filter === f && styles.chipOn]} onPress={() => setFilter(f)}>
              <Text style={styles.chipText}>{f === 'all' ? 'Alle' : CATEGORY_LABELS[f]}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView style={{ flex: 1 }}>
          {list.length === 0 && <Text style={styles.note}>Keine Samples gefunden.</Text>}
          {list.map((s) => (
            <View key={s.id}>
              <View style={styles.sampleRow}>
                <Pressable style={styles.playBtn} onPress={() => void togglePreview(s)}>
                  <Text style={styles.playBtnText}>{previewing && previewId === s.id ? '■' : '▶'}</Text>
                </Pressable>
                <Pressable style={styles.sampleInfo} onPress={() => setEditing(editing === s.id ? null : s.id)}>
                  <Text style={styles.sampleName} numberOfLines={1}>
                    {s.name.replace(/\.[a-z0-9]+$/i, '')}
                  </Text>
                  <Text style={styles.sampleMeta}>
                    <Text style={{ color: CategoryColors[s.category] }}>● </Text>
                    {s.bpm ? `${s.bpm} BPM` : 'One-Shot'}
                    {s.key ? ` · ${s.key}` : ''}
                  </Text>
                </Pressable>
                <Pressable style={styles.addBtn} onPress={() => add(s)}>
                  <Text style={styles.addBtnText}>+</Text>
                </Pressable>
              </View>
              {editing === s.id && <SampleEditor sample={s} onDone={() => setEditing(null)} onDelete={() => remove(s)} />}
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function SampleEditor({ sample, onDone, onDelete }: { sample: Sample; onDone: () => void; onDelete: () => void }) {
  const [bpm, setBpm] = useState(sample.bpm ? String(sample.bpm) : '');
  const [category, setCategory] = useState<SampleCategory>(sample.category);
  const categories = Object.keys(CATEGORY_LABELS) as SampleCategory[];

  const save = async () => {
    const v = Number(bpm);
    await upsertSample({ ...sample, bpm: v >= 40 && v <= 250 ? v : undefined, category });
    onDone();
  };

  return (
    <View style={styles.editor}>
      <TextInput style={styles.editField} keyboardType="decimal-pad" placeholder="BPM" placeholderTextColor={Colors.textSecondary} value={bpm} onChangeText={setBpm} />
      <ScrollView horizontal contentContainerStyle={{ gap: 6 }}>
        {categories.map((c) => (
          <Pressable key={c} style={[styles.chip, category === c && styles.chipOn]} onPress={() => setCategory(c)}>
            <Text style={styles.chipText}>{CATEGORY_LABELS[c]}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.editActions}>
        <Pressable style={styles.deleteBtn} onPress={onDelete}>
          <Text style={styles.deleteBtnText}>Entfernen</Text>
        </Pressable>
        <Pressable style={styles.saveBtn} onPress={() => void save()}>
          <Text style={styles.saveBtnText}>Speichern</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.surface },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.three, borderBottomWidth: 1, borderBottomColor: Colors.border },
  title: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  close: { color: Colors.textSecondary, fontSize: 18 },
  body: { flex: 1, padding: Spacing.three, gap: Spacing.two },
  importBtn: { backgroundColor: Colors.accent, borderRadius: 8, padding: Spacing.two, alignItems: 'center' },
  importBtnText: { color: '#0b0b0d', fontWeight: '700', fontSize: 13 },
  note: { color: Colors.textSecondary, fontSize: 12 },
  search: { backgroundColor: Colors.surfaceRaised, borderRadius: 8, padding: Spacing.two, color: Colors.text },
  filters: { flexGrow: 0 },
  chip: { backgroundColor: Colors.surfaceRaised, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipOn: { backgroundColor: Colors.accent },
  chipText: { color: Colors.text, fontSize: 12 },
  sampleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.one },
  playBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  playBtnText: { color: Colors.text, fontSize: 11 },
  sampleInfo: { flex: 1 },
  sampleName: { color: Colors.text, fontSize: 13 },
  sampleMeta: { color: Colors.textSecondary, fontSize: 11 },
  addBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#0b0b0d', fontSize: 16, fontWeight: '700' },
  editor: { backgroundColor: Colors.surfaceRaised, borderRadius: 8, padding: Spacing.two, gap: Spacing.two, marginBottom: Spacing.one },
  editField: { backgroundColor: Colors.surface, borderRadius: 6, padding: 8, color: Colors.text },
  editActions: { flexDirection: 'row', justifyContent: 'space-between' },
  deleteBtn: { backgroundColor: Colors.danger, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  deleteBtnText: { color: '#fff', fontSize: 12 },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  saveBtnText: { color: '#0b0b0d', fontSize: 12, fontWeight: '700' },
});
