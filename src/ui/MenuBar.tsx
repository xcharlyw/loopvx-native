import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { C, font, mono } from '../constants/theme';
import { shortcutText } from '../lib/keymap';
import { setState, useStore } from '../lib/store';
import { COMMANDS, MENU_GROUPS, isMac, type Command, type MenuGroup } from './commands';
import { Sheet } from './Sheet';
import { Txt } from './kit';

export const MENU_BAR_H = 30;

const inGroup = (g: MenuGroup) => COMMANDS.filter((c) => c.group === g);

function Item({ cmd, onDone }: { cmd: Command; onDone: () => void }) {
  // Read live state so items grey out when they do not apply (no clip selected ...).
  useStore((st) => `${st.selectedClipId}|${st.selectedTrackId}|${st.view}`);
  const enabled = !cmd.enabled || cmd.enabled();
  const key = cmd.keys?.[0];
  return (
    <Pressable
      accessibilityLabel={`Menü ${cmd.label}`}
      disabled={!enabled}
      onPress={() => {
        onDone();
        cmd.run();
      }}
      style={(st) => [s.item, (st as { hovered?: boolean }).hovered && enabled && s.itemHover]}
    >
      <Txt style={[s.itemText, !enabled && s.off]}>{cmd.label}</Txt>
      {key && <Txt style={[s.key, !enabled && s.off]}>{shortcutText(key, isMac())}</Txt>}
    </Pressable>
  );
}

/**
 * Live's menu bar (desktop): Datei, Bearbeiten, Erstellen, Ansicht, Optionen, Hilfe. Click opens a menu; while one is
 * open, moving over the next title switches to it, like a Mac menu bar.
 */
export function MenuBar() {
  const [open, setOpen] = useState<MenuGroup | null>(null);
  return (
    <View style={s.bar}>
      {open && <Pressable style={s.catcher} onPress={() => setOpen(null)} accessibilityLabel="Menü schließen" />}
      {MENU_GROUPS.map((g) => (
        <View key={g} style={{ zIndex: open ? (open === g ? 60 : 45) : 1 }}>
          <Pressable
            accessibilityLabel={`Menü ${g}`}
            onPress={() => setOpen(open === g ? null : g)}
            onHoverIn={() => open && setOpen(g)}
            style={[s.title, open === g && s.titleOn]}
          >
            <Txt style={[s.titleText, open === g && { color: C.accentInk }]}>{g}</Txt>
          </Pressable>
          {open === g && (
            <View style={s.drop}>
              {inGroup(g).map((cmd) => (
                <View key={cmd.id}>
                  {cmd.separator && <View style={s.sep} />}
                  <Item cmd={cmd} onDone={() => setOpen(null)} />
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

/** The same menus as one list, for a phone (☰ in the top bar). */
export function MenuPanel() {
  const close = () => setState({ panel: 'none' });
  return (
    <Sheet title="Menü">
      {MENU_GROUPS.map((g) => (
        <View key={g} style={{ marginBottom: 12 }}>
          <Txt style={s.groupTitle}>{g}</Txt>
          {inGroup(g).map((cmd) => (
            <View key={cmd.id}>
              <Item cmd={cmd} onDone={close} />
            </View>
          ))}
        </View>
      ))}
    </Sheet>
  );
}

/** Every shortcut, grouped like the menus (Hilfe → Tastenkürzel, or the ? key). */
export function ShortcutsPanel() {
  const mac = isMac();
  const groups: [string, Command[]][] = [...MENU_GROUPS.map((g) => [g, inGroup(g)] as [string, Command[]]), ['Weitere', COMMANDS.filter((c) => !c.group)]];
  return (
    <Sheet title="Tastenkürzel">
      <Txt style={s.hint}>Wie in Ableton Live 12. Wo der Browser eine Taste selbst belegt (⌘T neuer Tab), funktioniert die zweite Variante.</Txt>
      {groups.map(([g, list]) => (
        <View key={g} style={{ marginBottom: 12 }}>
          <Txt style={s.groupTitle}>{g}</Txt>
          {list
            .filter((c) => c.keys?.length)
            .map((c) => (
              <View key={c.id} style={s.row}>
                <Txt style={s.itemText}>{c.label}</Txt>
                <View style={s.keys}>
                  {c.keys!.map((k, i) => (
                    <Txt key={i} style={s.cap}>
                      {shortcutText(k, mac)}
                    </Txt>
                  ))}
                </View>
              </View>
            ))}
        </View>
      ))}
    </Sheet>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, height: MENU_BAR_H, backgroundColor: '#0a0a0c', borderBottomWidth: 1, borderBottomColor: C.lineSoft, zIndex: 50 },
  catcher: { position: 'fixed' as 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 },
  title: { paddingHorizontal: 10, height: 24, justifyContent: 'center', borderRadius: 6 },
  titleOn: { backgroundColor: C.accent },
  titleText: { ...font(500), fontSize: 13, color: C.text },
  drop: {
    position: 'absolute',
    top: 27,
    left: 0,
    minWidth: 270,
    paddingVertical: 6,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 24, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, marginHorizontal: 4 },
  itemHover: { backgroundColor: C.panel2 },
  itemText: { fontSize: 13, flex: 1 },
  key: { ...mono(), fontSize: 11, color: C.muted },
  off: { color: C.dim },
  sep: { height: 1, backgroundColor: C.lineSoft, marginVertical: 4, marginHorizontal: 8 },
  groupTitle: { ...font(700), fontSize: 11, color: C.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  hint: { color: C.muted, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  keys: { flexDirection: 'row', gap: 6 },
  cap: { ...mono(), fontSize: 11, color: C.text, backgroundColor: C.panel2, borderWidth: 1, borderColor: C.line, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
});
