import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { C, font, mono } from '../constants/theme';
import { db } from '../storage/db';
import { libraryDuplicates, usedSampleIds } from '../lib/duplicates';
import { deleteSample } from '../lib/samples';
import { allFolders, canMoveFolder, samplesUnder, withoutFolder, childFolders, countIn, dissolveFolder, flattenFolders, moveFolder, freeName, hasNesting, join, nameError, nameOf, parentOf, prettyPath, renameFolder } from '../lib/folders';
import { getState, removeSamples, setFolders, toast, upsertSamples, useStore } from '../lib/store';
import { runLoadMissing } from '../lib/sync';
import { confirmDestructive } from './confirm';
import { Btn, Chip, Txt } from './kit';
import { rowDomId } from './browser/keys';

/** Make a folder (it exists empty until samples are put in); the one place that checks names and duplicates. Returns its path, or null with a toast. */
export function addFolder(parent: string, name: string): string | null {
  const err = nameError(name);
  if (err) {
    toast(err, 'error');
    return null;
  }
  const path = join(parent, name.trim());
  const { samples, folders } = getState();
  if (allFolders(samples, folders).includes(path)) {
    toast('Diesen Ordner gibt es schon.', 'error');
    return null;
  }
  setFolders([...folders, path]);
  return path;
}

/** Where you are: "Library › Loops › Kicks", each part tappable, "Auswählen", and ⋯ for the folder tools (new folder, duplicates …). */
export function FolderBar({ path, setPath, selecting, onSelecting }: { path: string; setPath: (p: string) => void; selecting: boolean; onSelecting: (on: boolean) => void }) {
  const [naming, setNaming] = useState<string | null>(null);
  const [tools, setTools] = useState(false);
  const parts = path ? path.split('/') : [];
  const samples = useStore((st) => st.samples);
  const extra = useStore((st) => st.folders);
  const nested = hasNesting(samples, extra);
  const flatten = async () => {
    const ok = await confirmDestructive('Alle Ordnerpfade kürzen?', 'Jedes Sample behält nur den letzten Ordnernamen („Loops/Kicks“ wird „Kicks“). Ordner mit gleichem Namen werden zusammengelegt. Es wird nichts gelöscht.', 'Kürzen');
    if (!ok) return;
    const r = flattenFolders(samples, extra);
    setFolders(r.extra);
    await upsertSamples(r.changed);
    setPath('');
    toast(r.changed.length ? `${r.changed.length} Sample(s) in flache Ordner gelegt` : 'Die Ordner waren schon flach.');
  };
  const dedupe = async () => {
    const projects = await db.getProjects();
    const groups = libraryDuplicates(samples, usedSampleIds([...projects, getState().project]));
    const drop = groups.flatMap((g) => g.drop);
    if (!groups.length) {
      toast('Keine Duplikate gefunden (gleicher Dateiname).');
      return;
    }
    const pinned = groups.reduce((n, g) => n + g.pinned.length, 0);
    if (!drop.length) {
      toast(`${groups.length} doppelte Datei(en), aber alle Kopien werden in Projekten benutzt. Nichts entfernt.`);
      return;
    }
    const names = groups.slice(0, 4).map((g) => g.keep.name).join(', ');
    const ok = await confirmDestructive(
      `${drop.length} Duplikat(e) entfernen?`,
      `Gleicher Dateiname, z. B. ${names}. Je Datei bleibt eine Kopie (die, die ein Projekt benutzt, sonst die älteste). Entfernt werden nur Kopien, die kein Projekt spielt${pinned ? `; ${pinned} benutzte Kopie(n) bleiben` : ''}. Die Kopien verschwinden auch aus deinem Drive-Ordner LOOPVX, die Originaldateien in deinen Drive-Sample-Ordnern bleiben unangetastet.`,
      'Entfernen',
    );
    if (!ok) return;
    await removeSamples(drop, deleteSample);
    toast(`${drop.length} Duplikat(e) entfernt`);
  };
  const create = () => {
    if (naming === null) return;
    const made = addFolder(path, naming);
    if (made) {
      setNaming(null);
      setPath(made);
    }
  };
  return (
    <View style={s.bar}>
      <View style={s.crumbRow}>
        <View style={s.crumbs}>
          <Pressable accessibilityLabel="Hauptebene" onPress={() => setPath('')} hitSlop={4}>
            <Txt style={[s.crumb, path === '' && s.crumbOn]}>Library</Txt>
          </Pressable>
          {parts.map((p, i) => (
            <View key={i} style={s.crumbPart}>
              <Txt style={s.crumbSep}>›</Txt>
              <Pressable accessibilityLabel={`Ordner ${p}`} onPress={() => setPath(parts.slice(0, i + 1).join('/'))} hitSlop={4}>
                <Txt numberOfLines={1} style={[s.crumb, i === parts.length - 1 && s.crumbOn]}>
                  {p}
                </Txt>
              </Pressable>
            </View>
          ))}
        </View>
        <View style={{ flex: 1 }} />
        <Pressable accessibilityLabel={selecting ? 'Auswahl beenden' : 'Samples auswählen'} onPress={() => onSelecting(!selecting)} style={[s.tool, selecting && s.toolOn]}>
          <Txt style={[s.toolText, selecting && { color: C.accentInk }]}>{selecting ? 'Fertig' : 'Auswählen'}</Txt>
        </Pressable>
        <Pressable accessibilityLabel="Ordner-Werkzeuge" onPress={() => setTools(!tools)} style={[s.tool, tools && s.toolOn]}>
          <Txt style={[s.toolText, tools && { color: C.accentInk }]}>⋯</Txt>
        </Pressable>
      </View>
      {tools && (
        <View style={s.crumbs}>
          <Btn small accessibilityLabel="Neuer Ordner" onPress={() => setNaming(naming === null ? freeName(allFolders(getState().samples, getState().folders), path) : null)}>
            + Neuer Ordner
          </Btn>
          {nested && (
            <Btn small accessibilityLabel="Alle Ordnerpfade kürzen" onPress={() => void flatten()}>
              Pfade kürzen
            </Btn>
          )}
          <Btn small accessibilityLabel="Duplikate suchen" onPress={() => void dedupe()}>
            Duplikate
          </Btn>
          <Btn small accessibilityLabel="Fehlende Samples laden" onPress={() => void runLoadMissing()}>
            Fehlende laden
          </Btn>
        </View>
      )}
      {naming !== null && (
        <View style={s.crumbs}>
          <TextInput style={s.input} autoFocus value={naming} onChangeText={setNaming} onSubmitEditing={create} selectTextOnFocus placeholder="Ordnername" placeholderTextColor={C.dim} accessibilityLabel="Ordnername" />
          <Btn small kind="primary" onPress={create}>
            Anlegen
          </Btn>
        </View>
      )}
    </View>
  );
}

/** The folders directly inside the current one, with their sample counts and a small menu (rename, take apart). */
export function FolderRows({ path, setPath, selected }: { path: string; setPath: (p: string) => void; /** The folder the browser's arrow keys are on. */ selected?: string | null }) {
  const samples = useStore((st) => st.samples);
  const extra = useStore((st) => st.folders);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const folders = childFolders(allFolders(samples, extra), path);

  const rename = async () => {
    if (!renaming) return;
    const err = nameError(renaming.value);
    if (err) return toast(err, 'error');
    const to = join(parentOf(renaming.path), renaming.value.trim());
    if (to === renaming.path) return setRenaming(null);
    const r = renameFolder(samples, extra, renaming.path, to);
    setFolders(r.extra);
    await upsertSamples(r.changed);
    if (path === renaming.path || path.startsWith(renaming.path + '/')) setPath(to + path.slice(renaming.path.length));
    setRenaming(null);
    setMenu(null);
  };
  const move = async (folder: string, target: string) => {
    const r = moveFolder(samples, extra, folder, target);
    setMoving(null);
    setMenu(null);
    if (!r) return;
    setFolders(r.extra);
    await upsertSamples(r.changed);
    if (path === folder || path.startsWith(folder + '/')) setPath(r.to + path.slice(folder.length));
    toast(`„${nameOf(folder)}“ nach „${target ? prettyPath(target) : 'Hauptebene'}“ verschoben`);
  };
  const remove = async (folder: string) => {
    const doomed = samplesUnder(samples, folder);
    const ok = await confirmDestructive(
      `Ordner „${nameOf(folder)}“ löschen?`,
      doomed.length
        ? `Der Ordner mit allen Unterordnern und den ${doomed.length} Sample(s) darin wird gelöscht, auch aus deinem Drive-Ordner LOOPVX. Clips in Projekten, die diese Samples nutzen, werden stumm. Das lässt sich nicht rückgängig machen. (Zum Behalten der Samples: „Auflösen“.)`
        : 'Der leere Ordner wird entfernt.',
      'Löschen',
    );
    if (!ok) return;
    setFolders(withoutFolder(extra, folder));
    await removeSamples(doomed, deleteSample);
    if (path === folder || path.startsWith(folder + '/')) setPath(parentOf(folder));
    setMenu(null);
    toast(doomed.length ? `Ordner „${nameOf(folder)}“ und ${doomed.length} Sample(s) gelöscht` : `Ordner „${nameOf(folder)}“ gelöscht`);
  };
  const dissolve = async (folder: string) => {
    const { total } = countIn(samples, folder);
    const ok = await confirmDestructive(`Ordner „${nameOf(folder)}“ auflösen?`, total ? `Die ${total} Sample(s) darin rücken eine Ebene nach oben. Es wird nichts gelöscht.` : 'Der leere Ordner wird entfernt.', 'Auflösen');
    if (!ok) return;
    const r = dissolveFolder(samples, extra, folder);
    setFolders(r.extra);
    await upsertSamples(r.changed);
    if (path === folder || path.startsWith(folder + '/')) setPath(parentOf(folder));
    setMenu(null);
  };

  return (
    <>
      {moving && <FolderPicker title={`Ordner „${nameOf(moving)}“ verschieben nach …`} exclude={moving} onPick={(target) => void move(moving, target)} onClose={() => setMoving(null)} />}
      {folders.map((f) => {
        const { total } = countIn(samples, f);
        return (
          <View key={f} nativeID={rowDomId(`f:${f}`)} style={[s.folder, selected === f && s.folderOn]}>
            <View style={s.folderMain}>
              {renaming?.path === f ? (
                <>
                  <TextInput style={[s.input, { flex: 1 }]} autoFocus value={renaming.value} onChangeText={(value) => setRenaming({ path: f, value })} onSubmitEditing={() => void rename()} selectTextOnFocus accessibilityLabel="Neuer Name" />
                  <Btn small kind="primary" onPress={() => void rename()}>
                    OK
                  </Btn>
                </>
              ) : (
                <>
                  <Pressable accessibilityLabel={`Ordner ${nameOf(f)} öffnen`} style={s.folderOpen} onPress={() => setPath(f)}>
                    <Txt style={s.chevron}>▸</Txt>
                    <Txt style={s.folderIcon}>▤</Txt>
                    <Txt numberOfLines={1} style={s.folderName}>
                      {nameOf(f)}
                    </Txt>
                    <Txt style={s.count}>{total}</Txt>
                  </Pressable>
                  <Pressable accessibilityLabel={`Ordner ${nameOf(f)} verwalten`} style={s.more} onPress={() => setMenu(menu === f ? null : f)}>
                    <Txt style={s.moreText}>⋯</Txt>
                  </Pressable>
                </>
              )}
            </View>
            {menu === f && !renaming && (
              <View style={s.crumbs}>
                <Chip onPress={() => setRenaming({ path: f, value: nameOf(f) })} textStyle={{ fontSize: 12 }}>
                  Umbenennen
                </Chip>
                <Chip onPress={() => setMoving(f)} textStyle={{ fontSize: 12 }}>
                  Verschieben
                </Chip>
                <Chip onPress={() => void dissolve(f)} textStyle={{ fontSize: 12 }}>
                  Auflösen
                </Chip>
                <Chip onPress={() => void remove(f)} textStyle={{ fontSize: 12, color: C.danger }}>
                  Löschen
                </Chip>
              </View>
            )}
          </View>
        );
      })}
    </>
  );
}

/** "Move to ...": every folder as a choice, the top level, or a new folder made on the spot. */
export function FolderPicker({ count, title, exclude, onPick, onClose }: { count?: number; title?: string; exclude?: string; onPick: (folder: string) => void; onClose: () => void }) {
  const samples = useStore((st) => st.samples);
  const extra = useStore((st) => st.folders);
  const [naming, setNaming] = useState<string | null>(null);
  // For a folder being moved: not itself, not its own sub-folders, not where it already is.
  const all = allFolders(samples, extra).filter((f) => !exclude || canMoveFolder(exclude, f));
  const create = () => {
    if (naming === null) return;
    const made = addFolder('', naming);
    if (made) onPick(made);
  };
  return (
    <View style={s.picker}>
      <View style={s.crumbs}>
        <Txt style={s.pickerTitle}>{title ?? `${count ?? 0} Sample(s) verschieben nach …`}</Txt>
        <View style={{ flex: 1 }} />
        <Btn small onPress={onClose}>
          Abbrechen
        </Btn>
      </View>
      <View style={s.crumbs}>
        {(!exclude || canMoveFolder(exclude, '')) && (
          <Chip onPress={() => onPick('')} textStyle={{ fontSize: 12 }}>
            Hauptebene
          </Chip>
        )}
        {all.map((f) => (
          <Chip key={f} onPress={() => onPick(f)} textStyle={{ fontSize: 12 }}>
            {prettyPath(f)}
          </Chip>
        ))}
        <Chip variant="on" onPress={() => setNaming(naming === null ? freeName(all, '') : null)} textStyle={{ fontSize: 12 }}>
          + Neuer Ordner
        </Chip>
      </View>
      {naming !== null && (
        <View style={s.crumbs}>
          <TextInput style={s.input} autoFocus value={naming} onChangeText={setNaming} onSubmitEditing={create} selectTextOnFocus accessibilityLabel="Name des neuen Ordners" />
          <Btn small kind="primary" onPress={create}>
            Anlegen und verschieben
          </Btn>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  crumbs: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 1, minWidth: 0 },
  bar: { gap: 6, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  crumbRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  crumbPart: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  crumb: { ...font(600), fontSize: 12, color: C.muted },
  crumbOn: { color: C.text },
  crumbSep: { fontSize: 12, color: C.dim },
  tool: { height: 24, minWidth: 28, paddingHorizontal: 8, borderRadius: 5, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  toolOn: { backgroundColor: C.accent, borderColor: C.accent },
  toolText: { ...font(600), fontSize: 11, color: C.text },
  input: { height: 34, minWidth: 160, flexGrow: 1, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, paddingHorizontal: 10, color: C.text, ...font(400), fontSize: 14, outlineWidth: 0 },
  folder: { borderBottomWidth: 1, borderBottomColor: C.lineSoft, paddingVertical: 1, paddingHorizontal: 8, gap: 6 },
  folderOn: { backgroundColor: 'rgba(198,255,61,0.08)' },
  folderMain: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  folderOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, minWidth: 0 },
  chevron: { color: C.dim, fontSize: 11, width: 10 },
  folderIcon: { color: '#d8b45a', fontSize: 12 },
  folderName: { ...font(500), fontSize: 12.5, flex: 1, minWidth: 0 },
  count: { ...mono(), fontSize: 10.5, color: C.muted },
  more: { width: 26, height: 24, borderRadius: 5, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 13, color: C.text },
  picker: { gap: 8, padding: 10, borderWidth: 1, borderColor: C.accent, borderRadius: 12, backgroundColor: '#111114', marginBottom: 8 },
  pickerTitle: { ...font(700), fontSize: 13 },
});
