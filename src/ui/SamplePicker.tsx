import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { C, font } from '../constants/theme';
import { samplesInFolder, sourceFolders } from '../lib/voiceClip';
import { Chip, Txt } from './kit';

interface PickSample {
  id: string;
  name: string;
  folder?: string;
  addedAt: number;
}

/** Pick one Library sample by browsing its folders (folder dropdown, name search, full names). */
export function SamplePicker({ samples, value, onChange }: { samples: PickSample[]; value: string | null; onChange: (id: string) => void }) {
  const [folder, setFolder] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const folders = sourceFolders(samples);
  const total = folders.reduce((n, f) => n + f.count, 0);
  const list = samplesInFolder(samples, folder, query);
  const label = folder === null ? `Alle Ordner (${total})` : `${folder === '' ? 'Ohne Ordner' : folder} (${folders.find((f) => f.path === folder)?.count ?? 0})`;
  const choose = (f: string | null) => {
    setFolder(f);
    setOpen(false);
  };
  return (
    <View style={{ marginTop: 8, gap: 6 }}>
      <Pressable style={s.drop} onPress={() => setOpen(!open)} accessibilityLabel="Library-Ordner wählen">
        <Txt style={s.dropText} numberOfLines={1}>
          {`📁 ${label}`}
        </Txt>
        <Txt style={s.dropText}>{open ? '▴' : '▾'}</Txt>
      </Pressable>
      {open && (
        <ScrollView style={s.menu} nestedScrollEnabled>
          <Pressable style={s.item} onPress={() => choose(null)}>
            <Txt style={[s.itemText, folder === null && s.on]}>{`Alle Ordner (${total})`}</Txt>
          </Pressable>
          {folders.map((f) => (
            <Pressable key={f.path || '-'} style={s.item} onPress={() => choose(f.path)}>
              <Txt style={[s.itemText, folder === f.path && s.on]} numberOfLines={1}>{`${f.path === '' ? 'Ohne Ordner' : f.path} (${f.count})`}</Txt>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <TextInput style={s.search} placeholder="Name suchen (in allen Ordnern)" placeholderTextColor={C.dim} value={query} onChangeText={setQuery} />
      <ScrollView style={s.list} nestedScrollEnabled>
        {list.length === 0 && <Txt style={s.empty}>Keine Samples hier.</Txt>}
        {list.map((x) => (
          <Pressable key={x.id} style={[s.row, value === x.id && s.rowOn]} onPress={() => onChange(x.id)} accessibilityLabel={x.name}>
            <Txt style={[s.rowName, value === x.id && s.on]} numberOfLines={2}>
              {x.name}
            </Txt>
            {(query.trim() !== '' || folder === null) && x.folder ? <Txt style={s.rowFolder} numberOfLines={1}>{x.folder}</Txt> : null}
          </Pressable>
        ))}
      </ScrollView>
      {value && <Chip variant="on">{`✓ ${samples.find((x) => x.id === value)?.name ?? 'gewählt'}`}</Chip>}
    </View>
  );
}

const s = StyleSheet.create({
  drop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: '#1d1d22', borderWidth: 1, borderColor: '#34343a', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  dropText: { color: C.text, fontSize: 13, flexShrink: 1 },
  menu: { maxHeight: 220, backgroundColor: '#1d1d22', borderWidth: 1, borderColor: '#34343a', borderRadius: 12 },
  item: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  itemText: { color: C.text, fontSize: 13 },
  on: { color: C.accent },
  search: { color: C.text, ...font(400), fontSize: 14, paddingVertical: 6, paddingHorizontal: 2, outlineWidth: 0 },
  list: { maxHeight: 220, borderWidth: 1, borderColor: C.line, borderRadius: 12 },
  row: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  rowOn: { backgroundColor: '#23261a' },
  rowName: { color: C.text, fontSize: 13 },
  rowFolder: { color: C.dim, fontSize: 11, marginTop: 1 },
  empty: { color: C.muted, fontSize: 12, padding: 12 },
});
