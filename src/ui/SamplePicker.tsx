import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { C, font } from '../constants/theme';
import { allFolders, childFolders, countIn, nameOf, normPath } from '../lib/folders';
import { useStore } from '../lib/store';
import { samplesInFolder } from '../lib/voiceClip';
import { Chip, Txt } from './kit';

interface PickSample {
  id: string;
  name: string;
  folder?: string;
  addedAt: number;
}

/** Pick one Library sample by browsing the Library like its folder view: breadcrumb, sub-folders, then the samples. */
export function SamplePicker({ samples, value, onChange }: { samples: PickSample[]; value: string | null; onChange: (id: string) => void }) {
  const extra = useStore((st) => st.folders);
  const [path, setPath] = useState('');
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const usable = samples.filter((x) => x.folder !== 'AI Vocals');
  const folders = childFolders(allFolders(usable, extra), path).filter((f) => f !== 'AI Vocals');
  const here = searching ? samplesInFolder(samples, null, query) : samplesInFolder(samples, path, '').filter((x) => normPath(x.folder) === path);
  const parts = path ? path.split('/') : [];
  return (
    <View style={{ marginTop: 8, gap: 6 }}>
      <View style={s.crumbs}>
        <Chip variant={path === '' ? 'on' : 'ghost'} onPress={() => setPath('')} textStyle={{ fontSize: 12 }}>
          Hauptebene
        </Chip>
        {parts.map((p, i) => (
          <Chip key={i} variant={i === parts.length - 1 ? 'on' : 'ghost'} onPress={() => setPath(parts.slice(0, i + 1).join('/'))} textStyle={{ fontSize: 12 }}>
            {p}
          </Chip>
        ))}
      </View>
      <TextInput style={s.search} placeholder="Name suchen (in allen Ordnern)" placeholderTextColor={C.dim} value={query} onChangeText={setQuery} />
      <ScrollView style={s.list} nestedScrollEnabled>
        {!searching &&
          folders.map((f) => (
            <Pressable key={f} style={s.folder} onPress={() => setPath(f)} accessibilityLabel={`Ordner ${nameOf(f)}`}>
              <Txt style={s.rowName} numberOfLines={1}>{`📁 ${nameOf(f)}`}</Txt>
              <Txt style={s.rowFolder}>{countIn(usable, f).total}</Txt>
            </Pressable>
          ))}
        {here.map((x) => (
          <Pressable key={x.id} style={[s.row, value === x.id && s.rowOn]} onPress={() => onChange(x.id)} accessibilityLabel={x.name}>
            <Txt style={[s.rowName, value === x.id && s.on]} numberOfLines={2}>
              {x.name}
            </Txt>
            {searching && x.folder ? <Txt style={s.rowFolder} numberOfLines={1}>{x.folder}</Txt> : null}
          </Pressable>
        ))}
        {here.length === 0 && (searching || folders.length === 0) && <Txt style={s.empty}>Keine Samples hier.</Txt>}
      </ScrollView>
      {value && <Chip variant="on">{`✓ ${samples.find((x) => x.id === value)?.name ?? 'gewählt'}`}</Chip>}
    </View>
  );
}

const s = StyleSheet.create({
  crumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  folder: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  drop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: '#1d1d22', borderWidth: 1, borderColor: '#34343a', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  dropText: { color: C.text, fontSize: 13, flexShrink: 1 },
  menu: { maxHeight: 220, backgroundColor: '#1d1d22', borderWidth: 1, borderColor: '#34343a', borderRadius: 12 },
  item: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  itemText: { color: C.text, fontSize: 13 },
  on: { color: C.accent },
  search: { color: C.text, ...font(400), fontSize: 14, paddingVertical: 6, paddingHorizontal: 2, outlineWidth: 0 },
  list: { maxHeight: 300, borderWidth: 1, borderColor: C.line, borderRadius: 12 },
  row: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  rowOn: { backgroundColor: '#23261a' },
  rowName: { color: C.text, fontSize: 13 },
  rowFolder: { color: C.dim, fontSize: 11, marginTop: 1 },
  empty: { color: C.muted, fontSize: 12, padding: 12 },
});
