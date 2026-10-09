import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { Colors, Spacing } from '../constants/theme';
import { engine } from '../audio/engine';
import { projectEndBars, snapBars } from '../audio/timing';
import { placeSample, setCursor } from '../lib/actions';
import { createTrack, mapTrack } from '../lib/project';
import { setState, updateProject, useStore } from '../lib/store';
import type { Clip, SampleCategory, Track } from '../types';
import { usePlayhead } from './hooks';

const HEADER_W = 112;
const ROW_H = 60;

export function ArrangeView() {
  const project = useStore((s) => s.project);
  const zoom = useStore((s) => s.zoom);
  const samples = useStore((s) => s.samples);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const armedSampleId = useStore((s) => s.armedSampleId);
  const pos = usePlayhead();

  const totalBars = Math.max(64, Math.ceil(projectEndBars(project)) + 16);
  const width = totalBars * zoom;
  const grid = zoom >= 32 ? 0.25 : 1;
  const sampleById = useMemo(() => new Map(samples.map((s) => [s.id, s])), [samples]);
  const anySolo = project.tracks.some((t) => t.solo);
  const isEmpty = project.tracks.every((t) => t.clips.length === 0);

  const onLaneTap = (track: Track, e: GestureResponderEvent) => {
    const bar = Math.max(0, snapBars(e.nativeEvent.locationX / zoom, grid));
    setState({ selectedTrackId: track.id, selectedClipId: null });
    const armed = armedSampleId ? sampleById.get(armedSampleId) : undefined;
    if (armed) {
      void placeSample(armed, { trackId: track.id, bar: Math.floor(bar) });
      return;
    }
    if (!engine.playing) setCursor(Math.floor(bar));
  };

  const addTrack = (category: SampleCategory) =>
    updateProject((p) => ({ ...p, tracks: [...p.tracks, createTrack(category, p.sceneCount)] }), { reschedule: false });

  return (
    <ScrollView style={styles.outer}>
      <ScrollView horizontal>
        <View style={{ width: HEADER_W + width }}>
          <View style={styles.loopStrip}>
            <View
              style={[
                styles.loopRegion,
                {
                  left: HEADER_W + project.loop.start * zoom,
                  width: (project.loop.end - project.loop.start) * zoom,
                  opacity: project.loop.enabled ? 1 : 0.25,
                },
              ]}
            />
          </View>
          <View style={styles.ruler}>
            <View style={{ width: HEADER_W }} />
            <View style={{ width, height: 24 }}>
              {Array.from({ length: Math.ceil(totalBars / 4) }, (_, i) => i * 4).map((b) => (
                <Text key={b} style={[styles.rulerLabel, { left: b * zoom }]}>
                  {b + 1}
                </Text>
              ))}
            </View>
          </View>

          {project.tracks.map((track) => (
            <View key={track.id} style={styles.row}>
              <Pressable
                style={[styles.header, selectedTrackId === track.id && styles.headerSelected, selectedTrackId === track.id && styles.headerAccent]}
                onPress={() => setState({ selectedTrackId: track.id })}
              >
                <View style={styles.headerTop}>
                  <View style={[styles.dot, { backgroundColor: track.color, opacity: anySolo && !track.solo ? 0.3 : 1 }]} />
                  <Text style={styles.trackName} numberOfLines={1}>
                    {track.name}
                  </Text>
                </View>
                <View style={styles.msRow}>
                  <Pressable
                    style={[styles.ms, track.muted && styles.msOn]}
                    onPress={() => updateProject((p) => mapTrack(p, track.id, (t) => ({ ...t, muted: !t.muted })), { reschedule: false })}
                  >
                    <Text style={styles.msText}>M</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.ms, track.solo && styles.msOn]}
                    onPress={() => updateProject((p) => mapTrack(p, track.id, (t) => ({ ...t, solo: !t.solo })), { reschedule: false })}
                  >
                    <Text style={styles.msText}>S</Text>
                  </Pressable>
                </View>
              </Pressable>

              <Pressable
                style={[styles.lane, { width }, selectedTrackId === track.id && styles.laneSelected]}
                onPress={(e) => onLaneTap(track, e)}
              >
                {track.clips.map((clip) => (
                  <ClipView
                    key={clip.id}
                    clip={clip}
                    color={track.color}
                    name={sampleById.get(clip.sampleId)?.name ?? 'Sample fehlt'}
                    zoom={zoom}
                    selected={selectedClipId === clip.id}
                    onPress={() => setState({ selectedClipId: clip.id, selectedTrackId: track.id })}
                  />
                ))}
              </Pressable>
            </View>
          ))}

          <Pressable style={styles.addTrack} onPress={() => addTrack('other')}>
            <Text style={styles.addTrackText}>+ Spur</Text>
          </Pressable>

          <View style={[styles.playhead, { left: HEADER_W + pos * zoom }]} />
        </View>
      </ScrollView>
      {isEmpty && (
        <Text style={styles.emptyHint}>
          Öffne die Library und tippe auf ein Sample – es landet automatisch auf der passenden Spur (Kick, Top, Synth oder
          Vocals).
        </Text>
      )}
    </ScrollView>
  );
}

function ClipView({
  clip,
  color,
  name,
  zoom,
  selected,
  onPress,
}: {
  clip: Clip;
  color: string;
  name: string;
  zoom: number;
  selected: boolean;
  onPress: () => void;
}) {
  const w = Math.max(10, clip.length * zoom);
  return (
    <Pressable onPress={onPress} style={[styles.clip, { left: clip.start * zoom, width: w, backgroundColor: color }, selected && styles.clipSelected]}>
      <Text style={styles.clipName} numberOfLines={1}>
        {name.replace(/\.[a-z0-9]+$/i, '')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: Colors.background },
  loopStrip: { height: 4 },
  loopRegion: { position: 'absolute', top: 0, bottom: 0, backgroundColor: Colors.accent },
  ruler: { flexDirection: 'row', height: 24, backgroundColor: Colors.surface },
  rulerLabel: { position: 'absolute', top: 4, fontSize: 10, color: Colors.textSecondary },
  row: { flexDirection: 'row', height: ROW_H, borderBottomWidth: 1, borderBottomColor: Colors.border },
  header: {
    width: HEADER_W,
    padding: Spacing.one,
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  headerSelected: { backgroundColor: Colors.surfaceRaised },
  headerAccent: { borderLeftWidth: 3, borderLeftColor: Colors.accent },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  trackName: { color: Colors.text, fontSize: 12, flexShrink: 1 },
  msRow: { flexDirection: 'row', gap: 4 },
  ms: { width: 20, height: 18, borderRadius: 4, backgroundColor: Colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  msOn: { backgroundColor: Colors.accent },
  msText: { fontSize: 10, color: Colors.text, fontWeight: '700' },
  lane: { backgroundColor: Colors.background },
  laneSelected: { backgroundColor: Colors.surface },
  clip: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    borderRadius: 6,
    paddingHorizontal: 6,
    justifyContent: 'center',
  },
  clipSelected: { borderWidth: 2, borderColor: Colors.text },
  clipName: { fontSize: 10, color: '#0b0b0d', fontWeight: '600' },
  addTrack: { height: 36, justifyContent: 'center', paddingLeft: Spacing.two },
  addTrackText: { color: Colors.textSecondary, fontSize: 12 },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: Colors.accent },
  emptyHint: { padding: Spacing.four, color: Colors.textSecondary, fontSize: 13, textAlign: 'center' },
});
