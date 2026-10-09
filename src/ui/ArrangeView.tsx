import { memo, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { C, RULER_H, font, layout } from '../constants/theme';
import { engine } from '../audio/engine';
import { projectEndBars } from '../audio/timing';
import { placeSample, setCursor } from '../lib/actions';
import { createTrack, mapTrack } from '../lib/project';
import { setState, updateProject, useStore } from '../lib/store';
import type { Clip, Track } from '../types';
import { Fader } from './Fader';
import { usePlayhead, useSmall } from './hooks';
import { Plus } from './icons';
import { Mono, MsButton, Txt } from './kit';
import { tapX } from './events';
import { Waveform } from './Waveform';

const ADD_ROW_H = 44;
const BOTTOM_PAD = 170;

const Grid = memo(function Grid({ zoom, totalBars, height }: { zoom: number; totalBars: number; height: number }) {
  const labelEvery = zoom >= 36 ? 1 : zoom >= 18 ? 4 : 8;
  const barStep = labelEvery === 1 ? 1 : 4;
  const lines: { x: number; strong: boolean }[] = [];
  if (zoom >= 32) for (let i = 0; i < totalBars * 4; i++) if (i % (barStep * 4) !== 0) lines.push({ x: (i * zoom) / 4, strong: false });
  for (let b = 0; b < totalBars; b += barStep) lines.push({ x: b * zoom, strong: true });
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { height }]}>
      {lines.map((l, i) => (
        <View key={i} style={[s.gridLine, { left: l.x, backgroundColor: l.strong ? '#24242a' : '#18181c' }]} />
      ))}
    </View>
  );
});

/** Drawn above the sticky headers' right border, like the original (it starts 1px left of the lanes). */
function Playhead({ zoom, headerW, scrollX }: { zoom: number; headerW: number; scrollX: Animated.Value }) {
  const pos = usePlayhead();
  return (
    <View pointerEvents="none" style={[s.playheadClip, { left: headerW - 1 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: Animated.multiply(scrollX, -1) }] }]}>
        <View style={[s.playhead, { left: pos * zoom }]} />
      </Animated.View>
    </View>
  );
}

export function ArrangeView() {
  const project = useStore((st) => st.project);
  const zoom = useStore((st) => st.zoom);
  const samples = useStore((st) => st.samples);
  const selectedTrackId = useStore((st) => st.selectedTrackId);
  const selectedClipId = useStore((st) => st.selectedClipId);
  const armedSampleId = useStore((st) => st.armedSampleId);
  const small = useSmall();
  const { headerW, rowH } = layout(small);
  const [viewportH, setViewportH] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;

  const totalBars = Math.max(64, Math.ceil(projectEndBars(project)) + 16);
  const width = totalBars * zoom;
  const labelEvery = zoom >= 36 ? 1 : zoom >= 18 ? 4 : 8;
  const sampleById = useMemo(() => new Map(samples.map((x) => [x.id, x])), [samples]);
  const isEmpty = project.tracks.every((t) => t.clips.length === 0);
  const anySolo = project.tracks.some((t) => t.solo);
  const bodyH = Math.max(viewportH, project.tracks.length * rowH + ADD_ROW_H + BOTTOM_PAD);

  const onLaneTap = (track: Track, e: GestureResponderEvent) => {
    const bar = Math.max(0, tapX(e) / zoom);
    setState({ selectedTrackId: track.id, selectedClipId: null });
    const armed = armedSampleId ? sampleById.get(armedSampleId) : undefined;
    if (armed) {
      void placeSample(armed, { trackId: track.id, bar: Math.floor(bar) });
      return;
    }
    if (!engine.playing) setCursor(Math.floor(bar));
  };

  const loop = project.loop;

  return (
    <View style={s.arrange}>
      <View style={s.rulerRow}>
        <View style={[s.corner, { width: headerW }]} />
        <View style={s.rulerClip}>
          <Animated.View style={{ width, height: RULER_H, transform: [{ translateX: Animated.multiply(scrollX, -1) }] }}>
            <Pressable style={StyleSheet.absoluteFill} onPress={(e) => setCursor(Math.floor(Math.max(0, tapX(e) / zoom)))} />
            {Array.from({ length: Math.ceil(totalBars / labelEvery) }, (_, i) => i * labelEvery).map((b) => (
              <View key={b} pointerEvents="none" style={[s.rulerLabel, { left: b * zoom }]}>
                <Mono style={s.rulerText}>{b + 1}</Mono>
              </View>
            ))}
            <View
              pointerEvents="none"
              style={[
                s.loopRegion,
                { left: loop.start * zoom, width: (loop.end - loop.start) * zoom },
                !loop.enabled && s.loopRegionOff,
              ]}
            />
            <View pointerEvents="none" style={[s.loopHandle, { left: loop.start * zoom - 1 }]} />
            <View pointerEvents="none" style={[s.loopHandle, { left: loop.end * zoom - 1 }]} />
          </Animated.View>
        </View>
      </View>

      <View style={{ flex: 1 }} onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}>
        <ScrollView contentContainerStyle={{ flexDirection: 'row', height: bodyH }}>
          <View style={{ width: headerW }}>
            {project.tracks.map((track) => {
              const selected = selectedTrackId === track.id;
              return (
                <Pressable
                  key={track.id}
                  style={[s.trackHeader, { height: rowH }, small && s.trackHeaderSm, selected && s.trackHeaderSelected]}
                  onPress={() => setState({ selectedTrackId: track.id })}
                >
                  <View style={s.trackTitle}>
                    <View style={[s.dot, { backgroundColor: track.color, opacity: anySolo && !track.solo ? 0.3 : 1 }]} />
                    <Txt numberOfLines={1} style={s.trackName}>
                      {track.name}
                    </Txt>
                  </View>
                  <View style={s.trackControls}>
                    <MsButton
                      label="M"
                      on={track.muted}
                      onPress={() => updateProject((p) => mapTrack(p, track.id, (t) => ({ ...t, muted: !t.muted })), { reschedule: false })}
                    />
                    <MsButton
                      label="S"
                      on={track.solo}
                      onPress={() => updateProject((p) => mapTrack(p, track.id, (t) => ({ ...t, solo: !t.solo })), { reschedule: false })}
                    />
                    {!small && (
                      <Fader
                        value={track.volume}
                        max={1.5}
                        onChange={(v) => updateProject((p) => mapTrack(p, track.id, (t) => ({ ...t, volume: v })), { reschedule: false })}
                      />
                    )}
                  </View>
                </Pressable>
              );
            })}
            <View style={[s.trackHeader, { height: ADD_ROW_H }]}>
              <Pressable
                style={s.addTrack}
                onPress={() => updateProject((p) => ({ ...p, tracks: [...p.tracks, createTrack('other', p.sceneCount)] }), { reschedule: false })}
              >
                <Plus size={14} color={C.dim} />
                <Txt style={s.addTrackText}>Spur</Txt>
              </Pressable>
            </View>
          </View>

          <Animated.ScrollView
            horizontal
            style={{ flex: 1 }}
            scrollEventThrottle={16}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: Platform.OS !== 'web' })}
          >
            <View style={{ width, height: bodyH }}>
              <Grid zoom={zoom} totalBars={totalBars} height={bodyH} />
              {project.tracks.map((track) => (
                <Pressable
                  key={track.id}
                  style={[s.lane, { width, height: rowH }, selectedTrackId === track.id && s.laneSelected]}
                  onPress={(e) => onLaneTap(track, e)}
                >
                  {track.clips.map((clip) => {
                    const sample = sampleById.get(clip.sampleId);
                    return (
                      <ClipView
                        key={clip.id}
                        clip={clip}
                        color={track.color}
                        name={sample?.name ?? 'Sample fehlt'}
                        zoom={zoom}
                        height={rowH - 1 - 12}
                        projectBpm={project.bpm}
                        sampleBpm={sample?.bpm}
                        selected={selectedClipId === clip.id}
                        onPress={() => setState({ selectedClipId: clip.id, selectedTrackId: track.id })}
                      />
                    );
                  })}
                </Pressable>
              ))}
              {isEmpty && (
                <View pointerEvents="none" style={[s.emptyHint, { left: 0.4 * (headerW + width) - 140, top: 0.45 * (bodyH + RULER_H) - RULER_H - 42 }]}>
                  <Txt style={s.emptyText}>
                    Öffne die <Txt style={[s.emptyText, font(700)]}>Library</Txt>, verbinde deinen Drive-Ordner und tippe auf ein Sample.
                    {'\n'}Es landet automatisch auf der passenden Spur: Kick, Top, Synth oder Vocals.
                  </Txt>
                </View>
              )}
            </View>
          </Animated.ScrollView>
          <Playhead zoom={zoom} headerW={headerW} scrollX={scrollX} />
        </ScrollView>
      </View>
    </View>
  );
}

interface ClipViewProps {
  clip: Clip;
  color: string;
  name: string;
  zoom: number;
  height: number;
  projectBpm: number;
  sampleBpm?: number;
  selected: boolean;
  onPress: () => void;
}

function ClipView({ clip, color, name, zoom, height, projectBpm, sampleBpm, selected, onPress }: ClipViewProps) {
  const w = Math.max(6, clip.length * zoom);
  return (
    <Pressable onPress={onPress} style={[s.clip, { left: clip.start * zoom, width: w, backgroundColor: color }]}>
      <Waveform
        sampleId={clip.sampleId}
        width={w - 2}
        height={height - 2 - 16}
        zoom={zoom}
        projectBpm={projectBpm}
        sampleBpm={sampleBpm}
        offsetPx={clip.offset * zoom}
      />
      <Txt numberOfLines={1} style={s.clipName}>
        {name.replace(/\.[a-z0-9]+$/i, '')}
      </Txt>
      <View pointerEvents="none" style={s.clipResize} />
      {selected && <View pointerEvents="none" style={s.clipSelected} />}
    </Pressable>
  );
}

const s = StyleSheet.create({
  arrange: { flex: 1, minHeight: 0, backgroundColor: C.bg2 },
  rulerRow: { flexDirection: 'row', height: RULER_H, zIndex: 5 },
  corner: { backgroundColor: C.bg, borderRightWidth: 1, borderBottomWidth: 1, borderColor: C.lineSoft },
  rulerClip: { flex: 1, overflow: 'hidden', backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  rulerLabel: { position: 'absolute', top: 6, height: 22, paddingLeft: 4, borderLeftWidth: 1, borderLeftColor: C.line },
  rulerText: { fontSize: 11, color: C.dim, letterSpacing: 0 },
  loopRegion: {
    position: 'absolute',
    top: 0,
    height: 6,
    backgroundColor: 'rgba(198,255,61,0.55)',
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  loopRegionOff: { backgroundColor: 'rgba(139,139,147,0.35)' },
  loopHandle: { position: 'absolute', top: 0, width: 2, height: 12, backgroundColor: C.accent },
  gridLine: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  trackHeader: {
    backgroundColor: C.bg,
    borderRightWidth: 1,
    borderRightColor: C.lineSoft,
    borderBottomWidth: 1,
    borderBottomColor: C.lineSoft,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    justifyContent: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 10,
  },
  trackHeaderSm: { paddingLeft: 8, paddingRight: 6 },
  trackHeaderSelected: { backgroundColor: C.bg2, borderLeftColor: C.accent },
  trackTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, overflow: 'hidden' },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  trackName: { ...font(600), fontSize: 13, flexShrink: 1 },
  trackControls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addTrack: { flexDirection: 'row', alignItems: 'center', gap: 8, height: ADD_ROW_H },
  addTrackText: { color: C.dim, fontSize: 13 },
  lane: { borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  laneSelected: { backgroundColor: 'rgba(255,255,255,0.015)' },
  clip: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.35)',
  },
  clipName: {
    position: 'absolute',
    top: 3,
    left: 6,
    right: 14,
    fontSize: 11,
    ...font(600),
    color: 'rgba(0,0,0,0.75)',
  },
  clipResize: {
    position: 'absolute',
    right: 4,
    top: '35%',
    height: '30%',
    width: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  clipSelected: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 2, borderColor: '#fff', borderRadius: 7 },
  playheadClip: { position: 'absolute', top: 0, bottom: 0, right: 0, overflow: 'hidden', zIndex: 2 },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: C.accent },
  emptyHint: { position: 'absolute', width: 280 },
  emptyText: { color: C.dim, textAlign: 'center', lineHeight: 21 },
});
