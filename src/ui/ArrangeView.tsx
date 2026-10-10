import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, ScrollView, StyleSheet, View, type GestureResponderEvent, type ViewStyle } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { C, RULER_H, font, layout } from '../constants/theme';
import { engine } from '../audio/engine';
import { clipFades, dbToGain, projectEndBars, snapBars } from '../audio/timing';
import { placeSample, setCursor } from '../lib/actions';
import { addClip, createTrack, editClip, mapTrack, removeClip, updateClip, type ClipEdit } from '../lib/project';
import { getState, setState, updateProject, useStore } from '../lib/store';
import type { Clip, Note, Track } from '../types';
import { Fader } from './Fader';
import { usePlayhead, useSmall } from './hooks';
import { Plus } from './icons';
import { Mono, MsButton, Txt } from './kit';
import { tapX } from './events';
import { Waveform } from './Waveform';

const ADD_ROW_H = 44;
const BOTTOM_PAD = 170;
export const MIN_ZOOM = 8;
export const MAX_ZOOM = 240;

const touchDistance = (t: { pageX: number; pageY: number }[]) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);

/** Touch target around each loop handle (the visible handle stays 2px wide like the original). */
const LOOP_GRIP = 24;
/** Mouse/trackpad: clips drag straight away. Touch: a clip must be selected first, so swiping over clips still scrolls. */
const FINE_POINTER = Platform.OS === 'web' && typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;
/** Web-only style keys RN's types don't know. */
const web = (style: Record<string, string>) => (Platform.OS === 'web' ? (style as ViewStyle) : undefined);

interface Drag {
  clipId: string;
  mode: ClipEdit;
  dx: number;
  dy: number;
}

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
  const hScroll = useRef<ScrollView>(null);
  const scrollLeft = useRef(0);
  useEffect(() => {
    const id = scrollX.addListener(({ value }) => {
      scrollLeft.current = value;
    });
    return () => scrollX.removeListener(id);
  }, [scrollX]);

  // Two-finger pinch zooms the timeline around the point between the fingers.
  const pinch = useRef<{ dist: number; zoom: number; focalBar: number; focalX: number } | null>(null);
  const onTouchStart = (e: GestureResponderEvent) => {
    const t = e.nativeEvent.touches;
    if (t.length !== 2) return;
    const focalX = (t[0].pageX + t[1].pageX) / 2 - headerW;
    pinch.current = { dist: touchDistance(t), zoom, focalX, focalBar: (scrollLeft.current + focalX) / zoom };
  };
  const onTouchMove = (e: GestureResponderEvent) => {
    const t = e.nativeEvent.touches;
    const p = pinch.current;
    if (!p || t.length !== 2) return;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (p.zoom * touchDistance(t)) / p.dist));
    if (Math.abs(next - getState().zoom) < 0.5) return;
    setState({ zoom: next });
    requestAnimationFrame(() => hScroll.current?.scrollTo({ x: Math.max(0, p.focalBar * next - p.focalX), animated: false }));
  };
  const onTouchEnd = (e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length < 2) pinch.current = null;
  };

  const totalBars = Math.max(64, Math.ceil(projectEndBars(project)) + 16);
  const width = totalBars * zoom;
  const labelEvery = zoom >= 36 ? 1 : zoom >= 18 ? 4 : 8;
  const sampleById = useMemo(() => new Map(samples.map((x) => [x.id, x])), [samples]);
  const isEmpty = project.tracks.every((t) => t.clips.length === 0);
  const anySolo = project.tracks.some((t) => t.solo);
  const bodyH = Math.max(viewportH, project.tracks.length * rowH + ADD_ROW_H + BOTTOM_PAD);

  const grid = zoom >= 32 ? 0.25 : 1;
  const [drag, setDrag] = useState<Drag | null>(null);
  const trackDelta = (index: number, dy: number) =>
    Math.max(-index, Math.min(project.tracks.length - 1 - index, Math.round(dy / rowH)));

  const onClipDrag = (clip: Clip, index: number, mode: ClipEdit, dx: number, dy: number, phase: DragPhase) => {
    if (phase === 'move') {
      setState({ selectedClipId: clip.id, selectedTrackId: project.tracks[index].id });
      setDrag({ clipId: clip.id, mode, dx, dy });
      return;
    }
    setDrag(null);
    if (phase === 'cancel') return;
    const edit = editClip(clip, mode, dx / zoom, grid);
    const target = project.tracks[index + (mode === 'move' ? trackDelta(index, dy) : 0)];
    if (target && target.id !== project.tracks[index].id) {
      updateProject((p) => addClip(removeClip(p, clip.id), target.id, { ...clip, ...edit }));
      setState({ selectedTrackId: target.id });
    } else {
      updateProject((p) => updateClip(p, clip.id, edit));
    }
  };

  const onClipTap = (clip: Clip, track: Track, e: GestureResponderEvent) => {
    // A second tap on a selected MIDI clip opens its notes.
    if (clip.notes && selectedClipId === clip.id) {
      setState({ panel: 'piano' });
      return;
    }
    setState({ selectedClipId: clip.id, selectedTrackId: track.id });
    // Like clicking into a clip in Ableton: the playhead jumps there, ready for Split.
    if (!engine.playing) setCursor(Math.max(0, snapBars(clip.start + tapX(e) / zoom, grid)));
  };

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

  // Loop handles: drag start/end along the ruler, snapped to whole bars, one undo step per drag.
  const [loopDrag, setLoopDrag] = useState<{ edge: 'start' | 'end'; dx: number } | null>(null);
  const movedLoop = (edge: 'start' | 'end', dx: number) => {
    const l = project.loop;
    const bar = Math.round((edge === 'start' ? l.start : l.end) + dx / zoom);
    return edge === 'start' ? { ...l, enabled: true, start: Math.max(0, Math.min(bar, l.end - 1)) } : { ...l, enabled: true, end: Math.max(bar, l.start + 1) };
  };
  const onLoopDrag = (edge: 'start' | 'end', dx: number, phase: DragPhase) => {
    if (phase === 'move') {
      setLoopDrag({ edge, dx });
      return;
    }
    setLoopDrag(null);
    if (phase === 'cancel') return;
    const next = movedLoop(edge, dx);
    const l = project.loop;
    if (next.start !== l.start || next.end !== l.end || next.enabled !== l.enabled) updateProject((p) => ({ ...p, loop: next }));
  };
  const loopStartDrag = useDrag('start', true, (dx, _dy, phase) => onLoopDrag('start', dx, phase));
  const loopEndDrag = useDrag('start', true, (dx, _dy, phase) => onLoopDrag('end', dx, phase));
  const loop = loopDrag ? movedLoop(loopDrag.edge, loopDrag.dx) : project.loop;

  return (
    <View style={[s.arrange, web({ userSelect: 'none' })]}>
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
            {(['start', 'end'] as const).map((edge) => (
              <View
                key={edge}
                {...(edge === 'start' ? loopStartDrag : loopEndDrag)}
                accessibilityLabel={edge === 'start' ? 'Loop-Start' : 'Loop-Ende'}
                style={[s.loopGrip, { left: loop[edge] * zoom - LOOP_GRIP / 2 }, web({ cursor: 'ew-resize', touchAction: 'none' })]}
              >
                <View pointerEvents="none" style={[s.loopHandle, { left: LOOP_GRIP / 2 - 1 }, loopDrag?.edge === edge && s.loopHandleActive]} />
              </View>
            ))}
          </Animated.View>
        </View>
      </View>

      <View
        style={[{ flex: 1 }, web({ touchAction: 'pan-x pan-y' })]} // the browser must not zoom the page on a pinch
        onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <ScrollView scrollEnabled={!drag} contentContainerStyle={{ flexDirection: 'row', height: bodyH }}>
          <View style={{ width: headerW }}>
            {project.tracks.map((track) => {
              const selected = selectedTrackId === track.id;
              return (
                <Pressable
                  key={track.id}
                  style={[s.trackHeader, { height: rowH }, small && s.trackHeaderSm, selected && s.trackHeaderSelected]}
                  onPress={() => setState({ selectedTrackId: track.id })}
                  onLongPress={() => setState({ selectedTrackId: track.id, selectedClipId: null, panel: 'track' })}
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
            ref={hScroll}
            horizontal
            scrollEnabled={!drag}
            style={{ flex: 1 }}
            scrollEventThrottle={16}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: Platform.OS !== 'web' })}
          >
            <View style={{ width, height: bodyH }}>
              <Grid zoom={zoom} totalBars={totalBars} height={bodyH} />
              {project.tracks.map((track, index) => (
                <Pressable
                  key={track.id}
                  style={[
                    s.lane,
                    { width, height: rowH },
                    selectedTrackId === track.id && s.laneSelected,
                    drag && track.clips.some((c) => c.id === drag.clipId) && { zIndex: 3 },
                  ]}
                  onPress={(e) => onLaneTap(track, e)}
                >
                  {track.clips.map((clip) => {
                    const sample = sampleById.get(clip.sampleId);
                    const dragging = drag?.clipId === clip.id ? drag : null;
                    const shown = dragging ? { ...clip, ...editClip(clip, dragging.mode, dragging.dx / zoom, grid) } : clip;
                    return (
                      <ClipView
                        key={clip.id}
                        clip={shown}
                        color={track.color}
                        name={clip.notes ? `MIDI · ${clip.notes.length} ${clip.notes.length === 1 ? 'Note' : 'Noten'}` : (sample?.name ?? 'Sample fehlt')}
                        zoom={zoom}
                        height={rowH - 1 - 12}
                        projectBpm={project.bpm}
                        sampleBpm={sample?.bpm}
                        selected={selectedClipId === clip.id}
                        dragging={!!dragging}
                        liftY={dragging?.mode === 'move' ? trackDelta(index, dragging.dy) * rowH : 0}
                        onTap={(e) => onClipTap(clip, track, e)}
                        onDrag={(mode, dx, dy, phase) => onClipDrag(clip, index, mode, dx, dy, phase)}
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

type DragPhase = 'move' | 'end' | 'cancel';

/** A MIDI clip's notes in miniature, scaled to the pitch range they use (at least an octave). */
function MidiPreview({ notes, width, height, zoom }: { notes: Note[]; width: number; height: number; zoom: number }) {
  if (!notes.length || width <= 0 || height <= 0) return null;
  const lo = Math.min(...notes.map((n) => n.pitch));
  const hi = Math.max(lo + 11, Math.max(...notes.map((n) => n.pitch)));
  const rowH = height / (hi - lo + 1);
  return (
    <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 16 }} pointerEvents="none">
      {notes.map((n, i) => (
        <Rect
          key={i}
          x={n.start * zoom}
          y={(hi - n.pitch) * rowH}
          width={Math.max(2, n.length * zoom - 1)}
          height={Math.max(2, rowH - 1)}
          rx={1}
          fill="rgba(0,0,0,0.6)"
        />
      ))}
    </Svg>
  );
}

/** The responder system's touch record (present on native and react-native-web, missing from RN's event type). */
interface TouchHistory {
  indexOfSingleActiveTouch: number;
  touchBank: ({ startPageX: number; startPageY: number; currentPageX: number; currentPageY: number } | undefined)[];
}

/** Pan gesture that reports its offset; `claim` decides whether it takes over the touch. */
function useDrag(claim: 'start' | 'move', enabled: boolean, onDrag: (dx: number, dy: number, phase: DragPhase) => void) {
  const latest = useRef({ enabled, onDrag });
  latest.current = { enabled, onDrag };
  // The gesture's dx/dy restart at 0 when it takes over mid-move; add back the distance travelled before that.
  const lead = useRef({ dx: 0, dy: 0 });
  return useMemo(
    () =>
      PanResponder.create({
        onPanResponderGrant: (e) => {
          const history = (e as unknown as { touchHistory: TouchHistory }).touchHistory;
          const touch = history.touchBank[history.indexOfSingleActiveTouch];
          lead.current = touch ? { dx: touch.currentPageX - touch.startPageX, dy: touch.currentPageY - touch.startPageY } : { dx: 0, dy: 0 };
        },
        // Edge handles take the touch at once; the clip body only once it moves, so a tap still reaches its Pressable.
        onStartShouldSetPanResponder: () => claim === 'start' && latest.current.enabled,
        onMoveShouldSetPanResponderCapture: (_, g) =>
          claim === 'move' && latest.current.enabled && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 6),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => latest.current.onDrag(lead.current.dx + g.dx, lead.current.dy + g.dy, 'move'),
        onPanResponderRelease: (_, g) => latest.current.onDrag(lead.current.dx + g.dx, lead.current.dy + g.dy, 'end'),
        onPanResponderTerminate: () => latest.current.onDrag(0, 0, 'cancel'),
      }).panHandlers,
    [claim],
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
  dragging: boolean;
  /** Vertical offset while dragging the clip to another track. */
  liftY: number;
  onTap: (e: GestureResponderEvent) => void;
  onDrag: (mode: ClipEdit, dx: number, dy: number, phase: DragPhase) => void;
}

function ClipView({ clip, color, name, zoom, height, projectBpm, sampleBpm, selected, dragging, liftY, onTap, onDrag }: ClipViewProps) {
  const w = Math.max(6, clip.length * zoom);
  const fades = clipFades(clip);
  const editable = selected || FINE_POINTER;
  const body = useDrag('move', editable, (dx, dy, phase) => onDrag('move', dx, dy, phase));
  const startEdge = useDrag('start', editable, (dx, dy, phase) => onDrag('start', dx, dy, phase));
  const endEdge = useDrag('start', editable, (dx, dy, phase) => onDrag('end', dx, dy, phase));
  return (
    <View
      {...body}
      style={[
        s.clip,
        { left: clip.start * zoom, width: w, backgroundColor: color, transform: [{ translateY: liftY }] },
        dragging && s.clipDragging,
        web({ touchAction: editable ? 'none' : 'auto', cursor: dragging ? 'grabbing' : 'grab' }),
      ]}
    >
      <Pressable onPress={onTap} style={StyleSheet.absoluteFill}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {clip.notes ? (
            <MidiPreview notes={clip.notes} width={w - 2} height={height - 2 - 16} zoom={zoom} />
          ) : (
            <Waveform
              sampleId={clip.sampleId}
              width={w - 2}
              height={height - 2 - 16}
              zoom={zoom}
              projectBpm={projectBpm}
              sampleBpm={sampleBpm}
              offsetPx={clip.offset * zoom}
              gain={dbToGain(clip.gainDb ?? 0)}
              fadeInPx={fades.fadeIn * zoom}
              fadeOutPx={fades.fadeOut * zoom}
            />
          )}
          {(fades.fadeIn > 0 || fades.fadeOut > 0) && (
            <Svg width={w - 2} height={height - 2} style={StyleSheet.absoluteFill}>
              {fades.fadeIn > 0 && <Path d={`M0 ${height - 2}L${fades.fadeIn * zoom} 0`} stroke="rgba(0,0,0,0.55)" strokeWidth={1.5} />}
              {fades.fadeOut > 0 && <Path d={`M${w - 2 - fades.fadeOut * zoom} 0L${w - 2} ${height - 2}`} stroke="rgba(0,0,0,0.55)" strokeWidth={1.5} />}
            </Svg>
          )}
          <Txt numberOfLines={1} style={s.clipName}>
            {name.replace(/\.[a-z0-9]+$/i, '')}
          </Txt>
        </View>
      </Pressable>
      <View {...startEdge} style={[s.clipEdge, { left: 0 }, web({ cursor: 'ew-resize' })]}>
        {selected && <View pointerEvents="none" style={[s.clipResize, { left: 4, right: undefined }]} />}
      </View>
      <View {...endEdge} style={[s.clipEdge, { right: 0 }, web({ cursor: 'ew-resize' })]}>
        <View pointerEvents="none" style={s.clipResize} />
      </View>
      {selected && <View pointerEvents="none" style={s.clipSelected} />}
    </View>
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
  loopHandleActive: { width: 4, height: RULER_H, marginLeft: -1 },
  loopGrip: { position: 'absolute', top: 0, width: LOOP_GRIP, height: RULER_H },
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
  clipEdge: { position: 'absolute', top: 0, bottom: 0, width: 14 },
  clipDragging: { opacity: 0.85, zIndex: 3 },
  clipSelected: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 2, borderColor: '#fff', borderRadius: 7 },
  playheadClip: { position: 'absolute', top: 0, bottom: 0, right: 0, overflow: 'hidden', zIndex: 2 },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: C.accent },
  emptyHint: { position: 'absolute', width: 280 },
  emptyText: { color: C.dim, textAlign: 'center', lineHeight: 21 },
});
