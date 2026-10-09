import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { C, font, mono } from '../constants/theme';
import { createProject } from '../lib/project';
import { errorText, getState, openProject, toast, updateProject, useStore } from '../lib/store';
import { signIn, signOut, useSession } from '../lib/supabase';
import { db } from '../storage/db';
import type { Project } from '../types';
import { Plus, Trash } from './icons';
import { confirmDestructive } from './confirm';
import { Btn, IconBtn, Section, Txt } from './kit';
import { Sheet } from './Sheet';

export function ProjectsPanel() {
  const current = useStore((st) => st.project);
  const [projects, setProjects] = useState<Project[]>([]);
  const session = useSession();

  const reload = async () => {
    const byId = new Map((await db.getProjects()).map((p) => [p.id, p]));
    const cur = getState().project;
    byId.set(cur.id, cur);
    setProjects([...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt));
  };

  useEffect(() => {
    void reload();
  }, []);

  const create = async () => {
    const p = createProject(`Projekt ${projects.length + 1}`, current.bpm, current.key);
    await db.putProject(p);
    await openProject(p);
  };

  const remove = async (p: Project) => {
    if (!(await confirmDestructive(`„${p.name}“ löschen?`))) return;
    await db.deleteProject(p.id);
    if (p.id === getState().project.id) await openProject(createProject());
    await reload();
  };

  return (
    <Sheet title="Projekte">
      <Section title="Aktuelles Projekt">
        <TextInput
          style={s.input}
          value={current.name}
          onChangeText={(name) => updateProject((p) => ({ ...p, name }), { reschedule: false })}
          accessibilityLabel="Projektname"
        />
        <View style={{ flexDirection: 'row' }}>
          <Btn kind="primary" onPress={() => void create()}>
            <Plus size={16} color={C.accentInk} />
            Neues Projekt
          </Btn>
        </View>
      </Section>

      <Section title="Alle Projekte">
        {projects.map((p) => (
          <View key={p.id} style={s.item}>
            <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => void openProject(p)}>
              <Txt numberOfLines={1} style={font(p.id === current.id ? 700 : 500)}>
                {p.name}
              </Txt>
              <Txt numberOfLines={1} style={s.meta}>
                {p.bpm} BPM · {p.key} · {new Date(p.updatedAt).toLocaleString('de-AT')}
              </Txt>
            </Pressable>
            <IconBtn onPress={() => void remove(p)} accessibilityLabel="Löschen">
              <Trash size={16} />
            </IconBtn>
          </View>
        ))}
      </Section>

      <Section title="Account & Cloud-Sync">
        {session ? (
          <View style={s.row}>
            <Txt numberOfLines={1} style={{ flex: 1, fontSize: 13 }}>
              {session.user.email}
            </Txt>
            <Btn small onPress={() => void signOut()}>
              Abmelden
            </Btn>
          </View>
        ) : (
          <>
            <Txt style={[s.note, { marginBottom: 13 }]}>
              Anmelden, um Projekte zwischen Handy und Desktop zu synchronisieren und AI-Vocals zu erzeugen.
            </Txt>
            <View style={{ flexDirection: 'row' }}>
              <Btn kind="primary" onPress={() => void signIn().catch((e) => toast(errorText(e), 'error'))}>
                Mit Google anmelden
              </Btn>
            </View>
          </>
        )}
      </Section>
    </Sheet>
  );
}

const s = StyleSheet.create({
  input: {
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
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  meta: { ...mono(), fontSize: 11, color: C.muted },
  note: { color: C.muted, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
