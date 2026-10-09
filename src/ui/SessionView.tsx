import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { C, font, layout, mono } from '../constants/theme';
import { engine } from '../audio/engine';
import { placeSample, sceneToArrangement } from '../lib/actions';
import { setSlot } from '../lib/project';
import { errorText, getState, setState, toast, updateProject, useStore } from '../lib/store';
import { useEngine, useSmall } from './hooks';
import { Play, Stop, TimelineIcon } from './icons';
import { Btn, IconBtn, Spacer, Txt } from './kit';

const GAP = 6;

function PulseDot() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.2, duration: 800, useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: false }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);
  return <Animated.View style={[s.pulse, { opacity }]} />;
}

export function SessionView() {
  const project = useStore((st) => st.project);
  const samples = useStore((st) => st.samples);
  const armedSampleId = useStore((st) => st.armedSampleId);
  useEngine(() => engine.sessionVersion);
  const active = engine.activeSlots();
  const [editing, setEditing] = useState(false);
  const { slotW } = layout(useSmall());
  const sampleById = new Map(samples.map((x) => [x.id, x]));
  const armed = armedSampleId ? sampleById.get(armedSampleId) : undefined;

  const run = (p: Promise<unknown>) => void p.catch((e) => toast(errorText(e), 'error'));

  const onSlot = (trackId: string, scene: number) => {
    const track = project.tracks.find((t) => t.id === trackId)!;
    const slot = track.slots[scene];
    if (armed) {
      void placeSample(armed, { trackId, scene });
      setState({ armedSampleId: null });
      return;
    }
    if (!slot) {
      setState({ selectedTrackId: trackId, panel: 'library' });
      toast('Wähle ein Sample und tippe auf "+", danach auf den leeren Slot.');
      return;
    }
    if (editing) {
      updateProject((p) => setSlot(p, trackId, scene, null), { reschedule: false });
      return;
    }
    run(engine.launchSlot(getState().project, trackId, scene));
  };

  return (
    <ScrollView style={s.session} contentContainerStyle={{ padding: 12 }}>
      <View style={[s.row, { marginBottom: 10 }]}>
        <Txt style={s.hint}>{armed ? `Tippe auf einen Slot für „${armed.name}“` : 'Clips starten immer auf den nächsten Takt.'}</Txt>
        <Spacer />
        {armed && (
          <Btn small onPress={() => setState({ armedSampleId: null })}>
            Abbrechen
          </Btn>
        )}
        <Btn small kind={editing ? 'primary' : 'default'} onPress={() => setEditing(!editing)}>
          {editing ? 'Fertig' : 'Slots leeren'}
        </Btn>
      </View>

      <ScrollView horizontal>
        <View style={{ gap: GAP }}>
          <View style={s.gridRow}>
            <View style={{ width: 44 }} />
            {project.tracks.map((t) => (
              <View key={t.id} style={[s.head, { width: slotW, borderTopColor: t.color }]}>
                <Txt numberOfLines={1} style={s.headText}>
                  {t.name}
                </Txt>
                <IconBtn style={s.headStop} onPress={() => engine.stopTrack(t.id)}>
                  <Stop size={12} />
                </IconBtn>
              </View>
            ))}
          </View>

          {Array.from({ length: project.sceneCount }, (_, scene) => (
            <View key={scene} style={s.gridRow}>
              <Pressable style={s.sceneBtn} onPress={() => run(engine.launchScene(getState().project, scene))}>
                <View style={s.sceneCell}>
                  <Play size={14} color={C.muted} />
                </View>
                <View style={s.sceneCell}>
                  <Txt style={s.sceneNum}>{scene + 1}</Txt>
                </View>
              </Pressable>
              {project.tracks.map((t) => {
                const slot = t.slots[scene];
                const sample = slot ? sampleById.get(slot.sampleId) : undefined;
                const playing = active.get(t.id) === scene;
                return (
                  <Pressable
                    key={t.id}
                    style={[
                      s.slot,
                      { width: slotW },
                      slot && { borderStyle: 'solid', backgroundColor: editing ? '#3a3a40' : t.color },
                      armed && !slot && { borderColor: C.accent },
                      playing && s.slotPlaying,
                    ]}
                    onPress={() => onSlot(t.id, scene)}
                  >
                    <Txt
                      numberOfLines={2}
                      style={[
                        s.slotText,
                        slot && { color: editing ? '#fff' : '#111', ...font(600) },
                        armed && !slot && { color: C.accent },
                      ]}
                    >
                      {slot ? (sample?.name.replace(/\.[a-z0-9]+$/i, '') ?? 'Sample fehlt') : '+'}
                    </Txt>
                    {playing && <PulseDot />}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[s.row, { marginTop: 14 }]}>
        <Txt style={s.hint}>Szene ins Arrangement übernehmen (am Playhead):</Txt>
        {Array.from({ length: project.sceneCount }, (_, scene) =>
          project.tracks.some((t) => t.slots[scene]) ? (
            <Btn key={scene} small onPress={() => run(sceneToArrangement(scene))}>
              <TimelineIcon size={12} />
              {String(scene + 1)}
            </Btn>
          ) : null,
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  session: { flex: 1, minHeight: 0, backgroundColor: C.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  hint: { color: C.muted, fontSize: 12 },
  gridRow: { flexDirection: 'row', gap: GAP },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    height: 40,
    paddingLeft: 10,
    paddingRight: 8,
    borderRadius: 10,
    backgroundColor: C.panel,
    borderTopWidth: 3,
  },
  headText: { ...font(600), fontSize: 12, flexShrink: 1 },
  headStop: { minWidth: 26, height: 26, paddingHorizontal: 0 },
  sceneBtn: {
    width: 44,
    height: 52,
    borderRadius: 10,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.line,
  },
  // The original is a 2-row CSS grid (place-items: center): each row is half the button.
  sceneCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sceneNum: { ...mono(), fontSize: 11, color: C.muted },
  slot: {
    height: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: C.line,
    paddingVertical: 6,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  slotPlaying: { borderWidth: 2, borderColor: '#fff', paddingVertical: 5, paddingHorizontal: 9 },
  slotText: { fontSize: 11, color: C.dim },
  pulse: { position: 'absolute', right: 8, top: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: '#111' },
});
