import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors, Spacing } from '../constants/theme';
import { engine } from '../audio/engine';
import { placeSample, sceneToArrangement } from '../lib/actions';
import { setSlot } from '../lib/project';
import { errorText, getState, setState, toast, updateProject, useStore } from '../lib/store';
import { useEngine } from './hooks';

const SLOT_W = 96;
const SCENE_COL_W = 44;

export function SessionView() {
  const project = useStore((s) => s.project);
  const samples = useStore((s) => s.samples);
  const armedSampleId = useStore((s) => s.armedSampleId);
  useEngine(() => engine.sessionVersion);
  const active = engine.activeSlots();
  const [editing, setEditing] = useState(false);
  const sampleById = new Map(samples.map((s) => [s.id, s]));
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
    <ScrollView style={styles.outer}>
      <View style={styles.toolbar}>
        <Text style={styles.hint}>{armed ? `Tippe auf einen Slot für „${armed.name}"` : 'Clips starten immer auf den nächsten Takt.'}</Text>
        {armed && (
          <Pressable style={styles.btn} onPress={() => setState({ armedSampleId: null })}>
            <Text style={styles.btnText}>Abbrechen</Text>
          </Pressable>
        )}
        <Pressable style={[styles.btn, editing && styles.btnPrimary]} onPress={() => setEditing(!editing)}>
          <Text style={styles.btnText}>{editing ? 'Fertig' : 'Slots leeren'}</Text>
        </Pressable>
      </View>

      <ScrollView horizontal>
        <View>
          <View style={styles.headRow}>
            <View style={{ width: SCENE_COL_W }} />
            {project.tracks.map((t) => (
              <View key={t.id} style={[styles.sessionHead, { borderTopColor: t.color }]}>
                <Text style={styles.sessionHeadText} numberOfLines={1}>
                  {t.name}
                </Text>
                <Pressable style={styles.stopTrackBtn} onPress={() => engine.stopTrack(t.id)}>
                  <Text style={styles.stopTrackText}>■</Text>
                </Pressable>
              </View>
            ))}
          </View>

          {Array.from({ length: project.sceneCount }, (_, scene) => (
            <View key={scene} style={styles.sceneRow}>
              <Pressable style={styles.sceneBtn} onPress={() => run(engine.launchScene(getState().project, scene))}>
                <Text style={styles.sceneBtnText}>▶ {scene + 1}</Text>
              </Pressable>
              {project.tracks.map((t) => {
                const slot = t.slots[scene];
                const sample = slot ? sampleById.get(slot.sampleId) : undefined;
                const playing = active.get(t.id) === scene;
                return (
                  <Pressable
                    key={t.id}
                    style={[
                      styles.slot,
                      slot && { backgroundColor: editing ? Colors.surfaceRaised : t.color },
                      playing && styles.slotPlaying,
                      armed && !slot && styles.slotArmed,
                    ]}
                    onPress={() => onSlot(t.id, scene)}
                  >
                    <Text style={[styles.slotText, slot && !editing && { color: '#0b0b0d' }]} numberOfLines={2}>
                      {slot ? (sample?.name.replace(/\.[a-z0-9]+$/i, '') ?? 'Sample fehlt') : '+'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.toolbar}>
        <Text style={styles.hint}>Szene ins Arrangement übernehmen (am Playhead):</Text>
        {Array.from({ length: project.sceneCount }, (_, scene) =>
          project.tracks.some((t) => t.slots[scene]) ? (
            <Pressable key={scene} style={styles.btn} onPress={() => run(sceneToArrangement(scene))}>
              <Text style={styles.btnText}>→ {scene + 1}</Text>
            </Pressable>
          ) : null,
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: Colors.background, padding: Spacing.two },
  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.one, marginBottom: Spacing.two },
  hint: { color: Colors.textSecondary, fontSize: 12, flexShrink: 1 },
  btn: { backgroundColor: Colors.surfaceRaised, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  btnPrimary: { backgroundColor: Colors.accent },
  btnText: { color: Colors.text, fontSize: 12 },
  headRow: { flexDirection: 'row' },
  sessionHead: {
    width: SLOT_W,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderTopWidth: 2,
    backgroundColor: Colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sessionHeadText: { color: Colors.text, fontSize: 12, flex: 1 },
  stopTrackBtn: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  stopTrackText: { color: Colors.textSecondary, fontSize: 10 },
  sceneRow: { flexDirection: 'row' },
  sceneBtn: { width: SCENE_COL_W, height: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, borderRightWidth: 1, borderBottomWidth: 1, borderColor: Colors.border },
  sceneBtnText: { color: Colors.textSecondary, fontSize: 10 },
  slot: {
    width: SLOT_W,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    padding: 4,
  },
  slotPlaying: { borderColor: Colors.accent, borderWidth: 2 },
  slotArmed: { backgroundColor: Colors.surfaceRaised },
  slotText: { color: Colors.textSecondary, fontSize: 11, textAlign: 'center' },
});
