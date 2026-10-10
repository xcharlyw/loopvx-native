import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { APP_NAME } from '../config';
import { C, font, mono } from '../constants/theme';
import { engine } from '../audio/engine';
import { formatBarPosition, formatClock, secondsPerBar } from '../audio/timing';
import { setCursor, togglePlay } from '../lib/actions';
import { KEYS } from '../lib/project';
import { setState, updateProject, useStore } from '../lib/store';
import { useEngine, usePlayhead, useSmall } from './hooks';
import { Export, LibraryIcon, LoopIcon, More, Play, Rewind, SelectArrow, Stop } from './icons';
import { IconBtn, Mono, Pill, PillGroup, Spacer, Txt, iconColor } from './kit';

function Position({ small }: { small: boolean }) {
  const bpm = useStore((s) => s.project.bpm);
  const pos = usePlayhead();
  return (
    <Pill style={small && sm.pill}>
      {!small && <Mono>{formatClock(pos * secondsPerBar(bpm))}</Mono>}
      <Mono>{formatBarPosition(pos)}</Mono>
    </Pill>
  );
}

function KeyPicker({ small }: { small: boolean }) {
  const key = useStore((s) => s.project.key);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pill style={small && sm.pill} onPress={() => setOpen(true)}>
        <View style={s.select}>
          <Mono numberOfLines={1} style={{ paddingLeft: 4, maxWidth: (small ? 78 : 96) - 14 }}>
            {key}
          </Mono>
          <SelectArrow />
        </View>
      </Pill>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.menuBackdrop} onPress={() => setOpen(false)}>
          <View style={s.menu}>
            <ScrollView>
              {KEYS.map((k) => (
                <Pressable
                  key={k}
                  style={[s.menuItem, k === key && s.menuItemOn]}
                  onPress={() => {
                    updateProject((p) => ({ ...p, key: k }), { reschedule: false });
                    setOpen(false);
                  }}
                >
                  <Mono style={k === key && { color: C.accent }}>{k}</Mono>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export function TopBar() {
  const project = useStore((s) => s.project);
  const playing = useEngine(() => engine.playing);
  const small = useSmall();
  const [bpmText, setBpmText] = useState<string | null>(null);

  const commitBpm = () => {
    const v = Number(bpmText?.replace(',', '.'));
    if (bpmText !== null && v >= 60 && v <= 220) updateProject((p) => ({ ...p, bpm: Math.round(v * 10) / 10 }));
    setBpmText(null);
  };

  const [brand, accent] = [APP_NAME.slice(0, -2), APP_NAME.slice(-2)];

  return (
    <View style={[s.bar, small && sm.bar]}>
      <Txt style={s.logo}>
        {brand}
        <Txt style={[s.logo, { color: C.accent, paddingHorizontal: 0 }]}>{accent}</Txt>
      </Txt>
      <Pill style={small && sm.pill} accessibilityLabel="Projekte" onPress={() => setState({ panel: 'projects' })}>
        <Txt numberOfLines={1} style={{ maxWidth: small ? 96 : 160 }}>
          {project.name}
        </Txt>
        <More size={16} />
      </Pill>

      {small && (
        <>
          <Spacer />
          <Pill style={sm.pill} accessibilityLabel="Exportieren" onPress={() => setState({ panel: 'export' })}>
            <Export size={16} />
          </Pill>
          <Pill style={sm.pill} accessibilityLabel="Sample-Library" onPress={() => setState({ panel: 'library' })}>
            <LibraryIcon size={16} />
          </Pill>
          <View style={s.break} />
        </>
      )}

      <PillGroup>
        {!small && (
          <IconBtn accessibilityLabel="Zum Anfang" onPress={() => setCursor(0)}>
            <Rewind size={16} />
          </IconBtn>
        )}
        <IconBtn accessibilityLabel="Play / Stop" onPress={() => void togglePlay()}>{playing ? <Stop size={16} /> : <Play size={16} />}</IconBtn>
        <IconBtn accessibilityLabel="Loop" onPress={() => updateProject((p) => ({ ...p, loop: { ...p.loop, enabled: !p.loop.enabled } }))}>
          <LoopIcon size={16} color={iconColor(project.loop.enabled)} />
        </IconBtn>
      </PillGroup>

      <Position small={small} />

      <Pill style={small && sm.pill}>
        <TextInput
          style={[s.bpmInput, small && { width: 34 }]}
          inputMode="decimal"
          value={bpmText ?? String(project.bpm)}
          onFocus={() => setBpmText(String(project.bpm))}
          onChangeText={setBpmText}
          onBlur={commitBpm}
          onSubmitEditing={commitBpm}
          selectTextOnFocus
        />
        <Mono style={s.muted}>BPM</Mono>
        {!small && <Mono style={s.muted}>4/4</Mono>}
      </Pill>

      <KeyPicker small={small} />

      {!small && (
        <>
          <Spacer />
          <Pill accessibilityLabel="Exportieren" onPress={() => setState({ panel: 'export' })}>
            <Export size={16} />
            <Txt>Export</Txt>
          </Pill>
          <Pill accessibilityLabel="Sample-Library" onPress={() => setState({ panel: 'library' })}>
            <LibraryIcon size={16} />
            <Txt>Library</Txt>
          </Pill>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.lineSoft,
    backgroundColor: C.bg,
    zIndex: 5,
  },
  logo: { ...font(700), fontSize: 20, letterSpacing: 1.2, paddingLeft: 2, paddingRight: 6 },
  break: { flexBasis: '100%', height: 0 },
  muted: { color: C.muted },
  select: { flexDirection: 'row', alignItems: 'center' },
  bpmInput: {
    width: 46,
    paddingVertical: 1,
    paddingLeft: 2,
    paddingRight: 1,
    textAlign: 'right',
    color: C.text,
    ...mono(),
    fontSize: 13,
    letterSpacing: 0.26,
    outlineWidth: 0,
  },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  menu: {
    width: 200,
    maxHeight: 420,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingVertical: 6,
  },
  menuItem: { paddingHorizontal: 14, paddingVertical: 8 },
  menuItemOn: { backgroundColor: C.panel2 },
});

const sm = StyleSheet.create({
  bar: { paddingVertical: 8, paddingHorizontal: 8, gap: 6 },
  pill: { paddingHorizontal: 10, gap: 4 },
});
