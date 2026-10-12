import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { C, font, mono } from '../constants/theme';
import { autoDetectTempos } from '../lib/actions';
import { browseChildren, driveCanRead, driveLinked, searchByName, type DriveFile } from '../lib/drive';
import { COMPUTERS_ID, VIRTUAL_ROOTS, browserEntries, collectAudio, isVirtualId, sizeText, summarizeImport, type ImportSummary } from '../lib/driveImport';
import { importDriveItems } from '../lib/driveImportRun';
import { errorText, getState, toast } from '../lib/store';
import { signIn } from '../lib/supabase';
import { Check } from './icons';
import { Btn, Chip, Txt } from './kit';

type Access = 'checking' | 'unlinked' | 'noread' | 'ok';
interface Crumb {
  id: string;
  name: string;
}
const ROOT: Crumb = { id: 'root', name: 'Mein Laufwerk' };

/**
 * Pick loops from the user's own Google Drive folders and copy them into the library: browse folders, tick files
 * or import a whole folder (with its sub-folders; the folder names help to sort samples into categories).
 * Needs the Drive read scope; without it the screen offers the sign-in that asks for it.
 */
export function DriveImport() {
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState<Access>('checking');
  const [stack, setStack] = useState<Crumb[]>([ROOT]);
  const [entries, setEntries] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, DriveFile>>({});
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  // A scanned folder waits here for a "Importieren" before anything is downloaded.
  const [plan, setPlan] = useState<{ name: string; items: { file: DriveFile; folder: string }[]; truncated: boolean; summary: ImportSummary } | null>(null);
  const [scanning, setScanning] = useState<number | null>(null);
  const stopRef = useRef(false);
  const here = stack[stack.length - 1];

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        if (!(await driveLinked())) return !cancelled && setAccess('unlinked');
        const canRead = await driveCanRead();
        if (!cancelled) setAccess(canRead ? 'ok' : 'noread');
      } catch (e) {
        if (!cancelled) {
          setAccess('unlinked');
          setError(errorText(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const load = async (folderId: string, search?: string) => {
    setLoading(true);
    setError(null);
    setSearched(!!search);
    try {
      setEntries(search ? await searchByName(search) : await browseChildren(folderId));
    } catch (e) {
      setError(errorText(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (open && access === 'ok') void load(here.id);
  }, [open, access, here.id]);

  const listed = browserEntries(entries);
  // At the top of Drive, "Computer" (My Mac ...) and "Mit mir geteilt" come first.
  const folders = stack.length === 1 && !searched ? [...VIRTUAL_ROOTS, ...listed.folders] : listed.folders;
  const audio = listed.audio;
  const pickedCount = Object.keys(picked).length;
  const importing = progress !== null || scanning !== null;

  const run = async (items: { file: DriveFile; folder: string }[], truncated = false) => {
    if (!items.length) {
      toast('Keine Audiodateien gefunden.');
      return;
    }
    setProgress({ done: 0, total: items.length, name: '' });
    try {
      stopRef.current = false;
      const result = await importDriveItems(items, (done, total, name) => setProgress({ done, total, name }), () => stopRef.current);
      const parts = [`${result.added.length} Datei(en) importiert`];
      if (result.stopped) parts.push('abgebrochen, ein erneuter Import macht dort weiter');
      if (result.skipped) parts.push(`${result.skipped} schon vorhanden`);
      if (result.failed.length) parts.push(`${result.failed.length} fehlgeschlagen`);
      const tops = [...new Set(result.added.map((x) => x.folder).filter(Boolean))];
      if (tops.length) parts.push(`Library-Ordner: ${tops.slice(0, 3).join(', ')}`);
      if (truncated) parts.push('Limit erreicht, den Rest in einem zweiten Durchgang importieren (schon importierte Dateien werden übersprungen)');
      toast(parts.join(' · '), result.failed.length ? 'error' : 'info');
      const tempos = await autoDetectTempos(result.added);
      if (tempos) toast(`Tempo bei ${tempos} Loop(s) automatisch erkannt`);
      setPicked({});
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setProgress(null);
    }
  };

  const importPicked = () => void run(Object.values(picked).map((file) => ({ file, folder: searched ? '' : stack.map((c) => c.name).slice(1).join('/') })));
  const importFolder = async (folder: Crumb, path: string) => {
    stopRef.current = false;
    setPlan(null);
    setScanning(0);
    try {
      const { items, truncated } = await collectAudio(browseChildren, folder.id, path, undefined, { onFile: setScanning, cancelled: () => stopRef.current });
      if (stopRef.current) return;
      if (!items.length) toast('Keine Audiodateien gefunden.');
      else setPlan({ name: folder.name, items, truncated, summary: summarizeImport(items, getState().samples) });
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setScanning(null);
    }
  };
  const startPlan = () => {
    if (!plan) return;
    const { items, truncated } = plan;
    setPlan(null);
    void run(items, truncated);
  };
  const togglePick = (f: DriveFile) =>
    setPicked((p) => {
      const next = { ...p };
      if (next[f.id]) delete next[f.id];
      else next[f.id] = f;
      return next;
    });

  if (!open) {
    return (
      <Btn small accessibilityLabel="Aus Google Drive importieren" onPress={() => setOpen(true)}>
        Aus Google Drive importieren
      </Btn>
    );
  }

  if (access === 'checking') return <Txt style={s.note}>Prüfe Drive-Zugriff …</Txt>;
  if (access !== 'ok') {
    return (
      <View style={{ gap: 10 }}>
        <Txt style={s.note}>
          {error ??
            (access === 'unlinked'
              ? 'Google Drive ist nicht verbunden. Melde dich mit Google an und erlaube den Drive-Zugriff.'
              : 'Für den Import braucht die App Lesezugriff auf dein Drive (nur Lesen, nur was du auswählst). Melde dich dafür einmal neu an und erlaube den Zugriff.')}
        </Txt>
        <View style={s.row}>
          <Btn kind="primary" small onPress={() => void signIn().catch((e) => toast(errorText(e), 'error'))}>
            {access === 'unlinked' ? 'Mit Google anmelden' : 'Drive-Zugriff erweitern'}
          </Btn>
          <Btn small onPress={() => setOpen(false)}>
            Schließen
          </Btn>
        </View>
      </View>
    );
  }

  return (
    <View style={s.box}>
      <View style={s.row}>
        <View style={{ flex: 1 }} />
        <Btn small onPress={() => setOpen(false)}>
          Schließen
        </Btn>
      </View>

      <TextInput
        style={s.search}
        placeholder="Im ganzen Drive suchen …"
        placeholderTextColor={C.dim}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => void load(here.id, query.trim() || undefined)}
        returnKeyType="search"
      />

      <View style={s.row}>
        <Btn small disabled={stack.length < 2} accessibilityLabel="Ordner zurück" onPress={() => setStack((st) => st.slice(0, -1))}>
          ◀
        </Btn>
        <Txt numberOfLines={1} style={s.path}>
          {stack.map((c) => c.name).join(' / ')}
        </Txt>
      </View>

      {loading && <Txt style={s.note}>Lade …</Txt>}
      {error && <Txt style={[s.note, { color: C.danger }]}>{error}</Txt>}
      {!loading && !error && !folders.length && !audio.length && (
        <Txt style={s.note}>
          Hier liegen keine Ordner oder Audiodateien.
        </Txt>
      )}
      {!loading && !error && here.id === COMPUTERS_ID && !entries.length && (
        <Txt style={s.note}>Keine Computer gefunden. Sie erscheinen hier, wenn „Google Drive für Desktop“ deinen Mac sichert (Ordner „Computer“ im Drive).</Txt>
      )}

      {stack.length > 1 && (
        <Btn small disabled={importing} accessibilityLabel="Diesen Ordner importieren" onPress={() => void importFolder(here, stack.map((c) => c.name).slice(1).join('/'))}>
          Diesen Ordner importieren (mit Unterordnern)
        </Btn>
      )}

      {folders.map((f) => (
        <View key={f.id} style={s.item}>
          <Pressable style={s.itemMain} accessibilityLabel={`Ordner ${f.name}`} onPress={() => setStack((st) => [...st, { id: f.id, name: f.name }])}>
            <Txt style={s.folderIcon}>▸</Txt>
            <Txt numberOfLines={1} style={s.itemName}>
              {f.name}
            </Txt>
          </Pressable>
          {!isVirtualId(f.id) && (
            <Chip onPress={() => void importFolder({ id: f.id, name: f.name }, [...stack.map((c) => c.name).slice(1), f.name].join('/'))} textStyle={{ fontSize: 11 }}>
              Importieren
            </Chip>
          )}
        </View>
      ))}

      {audio.length > 0 && (
        <View style={s.row}>
          <Chip onPress={() => setPicked(Object.fromEntries(audio.map((f) => [f.id, f])))} textStyle={{ fontSize: 11 }}>
            Alle wählen
          </Chip>
          {pickedCount > 0 && (
            <Chip onPress={() => setPicked({})} textStyle={{ fontSize: 11 }}>
              Keine
            </Chip>
          )}
        </View>
      )}
      {audio.map((f) => (
        <Pressable key={f.id} style={s.item} accessibilityLabel={`Datei ${f.name}`} accessibilityState={{ checked: !!picked[f.id] }} onPress={() => togglePick(f)}>
          <View style={[s.check, picked[f.id] && s.checkOn]}>{picked[f.id] && <Check size={12} color={C.accentInk} />}</View>
          <Txt numberOfLines={1} style={s.itemName}>
            {f.name}
          </Txt>
          <Txt style={s.meta}>{sizeText(f.size)}</Txt>
        </Pressable>
      ))}

      {scanning !== null && (
        <View style={s.row}>
          <Txt style={[s.note, { flex: 1 }]}>{`Suche Audiodateien … ${scanning} gefunden`}</Txt>
          <Btn small accessibilityLabel="Suche abbrechen" onPress={() => (stopRef.current = true)}>
            Abbrechen
          </Btn>
        </View>
      )}
      {plan && (
        <View style={s.plan}>
          <Txt style={s.planTitle}>{`„${plan.name}“: ${plan.summary.fresh} neue Datei(en)`}</Txt>
          <Txt style={s.note}>
            {[
              plan.summary.existing ? `${plan.summary.existing} schon in der Library` : null,
              plan.summary.bytes ? `${sizeText(String(plan.summary.bytes))} zu laden` : null,
              plan.truncated ? 'Limit erreicht, der Rest folgt im zweiten Durchgang' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Txt>
          {plan.summary.packs.length > 0 && (
            <Txt style={s.note}>
              {`Library-Ordner: ${plan.summary.packs
                .slice(0, 6)
                .map((p) => `${p.name} (${p.count})`)
                .join(', ')}${plan.summary.packs.length > 6 ? ` und ${plan.summary.packs.length - 6} weitere` : ''}`}
            </Txt>
          )}
          <View style={s.row}>
            <Btn kind="primary" small disabled={!plan.summary.fresh} accessibilityLabel="Import starten" onPress={startPlan}>
              {plan.summary.fresh ? `${plan.summary.fresh} importieren` : 'Nichts Neues'}
            </Btn>
            <Btn small accessibilityLabel="Import verwerfen" onPress={() => setPlan(null)}>
              Verwerfen
            </Btn>
          </View>
        </View>
      )}
      {progress !== null && (
        <View style={s.row}>
          <Txt style={[s.note, { flex: 1 }]}>
            {progress.total ? `Importiere ${Math.min(progress.done + 1, progress.total)} / ${progress.total}${progress.name ? ` · ${progress.name}` : ''}` : progress.name}
          </Txt>
          <Btn small accessibilityLabel="Import abbrechen" onPress={() => (stopRef.current = true)}>
            Abbrechen
          </Btn>
        </View>
      )}
      <Btn kind="primary" disabled={!pickedCount || importing} accessibilityLabel="Auswahl importieren" onPress={importPicked}>
        {pickedCount ? `${pickedCount} Datei(en) importieren` : 'Dateien antippen zum Auswählen'}
      </Btn>
      <Txt style={s.note}>Die Dateien werden kopiert, das Original in deinem Drive bleibt unverändert. Die Kopien liegen danach auch im LOOPVX-Ordner (Samples).</Txt>
    </View>
  );
}

const s = StyleSheet.create({
  box: { gap: 10 },
  plan: { gap: 6, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: C.accent },
  planTitle: { ...font(600), fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  note: { color: C.muted, fontSize: 12, lineHeight: 17 },
  path: { ...mono(), fontSize: 11, color: C.muted, flex: 1 },
  search: { height: 38, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, paddingHorizontal: 12, color: C.text, ...font(400), fontSize: 14, outlineWidth: 0 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  itemName: { flex: 1, fontSize: 13, minWidth: 0 },
  folderIcon: { color: C.accent, fontSize: 14, width: 14 },
  meta: { ...mono(), fontSize: 11, color: C.muted },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: C.accent, borderColor: C.accent },
});
