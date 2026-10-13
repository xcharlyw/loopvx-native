import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, ScrollView, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { C, RULER_H, font, layout, mono } from '../constants/theme';
import { engine } from '../audio/engine';
import { clipFades, dbToGain, projectEndBars, snapBars } from '../audio/timing';
import { loopSelection, placeSample, setCursor } from '../lib/actions';
import { applyGroupEdit, clipsInRange, groupEdit } from '../lib/clipgroup';
import { addMarker } from '../lib/markers';
import { createMidiTrack, createTrack, mapTrack, trackKind, type ClipEdit } from '../lib/project';
import { getState, selectedClipIds, setClipSelection, setState, updateProject, useStore } from '../lib/store';
import type { Clip, Note, Track } from '../types';
import { AUTO_ORDER, deviceAutoParams, laneOf, paramDef } from '../lib/automation';
import type { AutoParam } from '../types';
import { AutomationCurve } from './AutomationCurve';
import { Fader } from './Fader';
import { usePlayhead, useSmall } from './hooks';
import { Plus } from './icons';
import { Mono, MsButton, Txt } from './kit';
import { tapX } from './events';
import { useDrag, web, type DragPhase } from './drag';
import { Waveform } from './Waveform';

const ADD_ROW_H = 44;
const MARKER_H = 20;
/** Height of an open automation lane under a track (Ableton-style: the curve sits right below the clips). */
const LANE_H = 76;
const BOTTOM_PAD = 170;
export const MIN_ZOOM = 8;
export const MAX_ZOOM = 240;

const touchDistance = (t: { pageX: number; pageY: number }[]) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);

/** Touch target around each loop handle (the visible handle stays 2px wide like the original). */
const LOOP_GRIP = 24;
/** Mouse/trackpad: clips drag straight away. Touch: a clip must be selected first, so swiping over clips still scrolls. */
const FINE_POINTER = Platform.OS === 'web' && typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;

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
  const selectionKey = useStore((st) => selectedClipIds(st).join(','));
  const selection = useMemo(() => (selectionKey ? selectionKey.split(',') : []), [selectionKey]);
  const multiSelect = useStore((st) => st.multiSelect);
  const autoMode = useStore((st) => st.autoMode);
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
  // Open automation lanes: which parameter's curve shows under which track.
  const [lanes, setLanes] = useState<Record<string, AutoParam>>({});
  const openLanes = autoMode ? 0 : project.tracks.filter((t) => lanes[t.id]).length;
  const bodyH = Math.max(viewportH, project.tracks.length * rowH + openLanes * LANE_H + ADD_ROW_H + BOTTOM_PAD);
  const toggleLane = (t: Track) =>
    setLanes((m) => {
      const next = { ...m };
      if (next[t.id]) delete next[t.id];
      else next[t.id] = t.automation?.[0]?.param ?? 'filter';
      return next;
    });
  // Tapping the lane header steps through the track's parameters, then the knobs of its devices.
  const cycleLane = (t: Track) =>
    setLanes((m) => {
      const choices: AutoParam[] = [...AUTO_ORDER, ...deviceAutoParams(t).map((d) => d.param)];
      return { ...m, [t.id]: choices[(choices.indexOf(m[t.id] ?? overlayParam(t, m)) + 1) % choices.length] };
    });
  // Automation mode: the curve shown over a track's clips (the open lane's, else the first one it has, else volume).
  const overlayParam = (t: Track, m: Record<string, AutoParam> = lanes): AutoParam => m[t.id] ?? t.automation?.find((l) => l.points.length)?.param ?? 'volume';

  const grid = zoom >= 32 ? 0.25 : 1;
  const [drag, setDrag] = useState<Drag | null>(null);
  // The release of a drag also arrives as a press: it must not shrink a multi-selection to the dragged clip.
  const dragEndedAt = useRef(0);
  const lastTap = useRef<{ id: string; at: number }>({ id: '', at: 0 });

  // Rubber band: dragging on empty timeline selects the clips it touches (mouse always; touch in multi-select mode,
  // where the finger would otherwise scroll). Coordinates are in the timeline content (bars x track rows).
  const contentRef = useRef<View>(null);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const bandOrigin = useRef<{ px: number; py: number } | null>(null);
  const live = useRef({ zoom, rowH, project, lanes, on: FINE_POINTER || multiSelect });
  live.current = { zoom, rowH, project, lanes: autoMode ? {} : lanes, on: (FINE_POINTER || multiSelect) && !autoMode };
  const rowAt = (y: number) => {
    const { project: p, rowH: h, lanes: open } = live.current;
    let top = 0;
    for (let i = 0; i < p.tracks.length; i++) {
      const bottom = top + h + (open[p.tracks[i].id] ? LANE_H : 0);
      if (y < bottom) return i;
      top = bottom;
    }
    return p.tracks.length - 1;
  };
  const bandHandlers = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => live.current.on && (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (_, g) => {
          bandOrigin.current = null;
          contentRef.current?.measure((_x, _y, _w, _h, px, py) => {
            bandOrigin.current = { px, py };
            setBand({ x0: g.x0 - px, y0: g.y0 - py, x1: g.x0 - px, y1: g.y0 - py });
          });
        },
        onPanResponderMove: (_, g) => {
          const o = bandOrigin.current;
          if (o) setBand((b) => (b ? { ...b, x1: g.moveX - o.px, y1: g.moveY - o.py } : b));
        },
        onPanResponderRelease: () => {
          setBand((b) => {
            if (b) {
              const z = live.current.zoom;
              const ids = clipsInRange(live.current.project, b.x0 / z, b.x1 / z, rowAt(b.y0), rowAt(b.y1));
              setClipSelection(ids[0] ?? null, ids.slice(1));
            }
            return null;
          });
          dragEndedAt.current = Date.now();
        },
        onPanResponderTerminate: () => setBand(null),
      }).panHandlers,
    [],
  );
  const trackDelta = (index: number, dy: number) =>
    Math.max(-index, Math.min(project.tracks.length - 1 - index, Math.round(dy / rowH)));

  const onClipDrag = (clip: Clip, index: number, mode: ClipEdit, dx: number, dy: number, phase: DragPhase) => {
    if (phase === 'move') {
      // Dragging a clip of the selection drags the whole selection; any other clip becomes the selection.
      if (!selection.includes(clip.id)) setClipSelection(clip.id);
      setState({ selectedTrackId: project.tracks[index].id });
      setDrag({ clipId: clip.id, mode, dx, dy });
      return;
    }
    setDrag(null);
    dragEndedAt.current = Date.now();
    if (phase === 'cancel') return;
    // An audio clip cannot sit on a MIDI track and the other way round: the group changes tracks only if every clip fits.
    const result = groupEdit(project, selection, clip.id, mode, dx / zoom, mode === 'move' ? trackDelta(index, dy) : 0, grid);
    updateProject((p) => applyGroupEdit(p, result));
    if (result.shift) setState({ selectedTrackId: project.tracks[index + result.shift].id });
  };
  // While a drag runs, every clip of the group is shown where it would land.
  const preview = drag ? groupEdit(project, selection, drag.clipId, drag.mode, drag.dx / zoom, drag.mode === 'move' ? trackDelta(project.tracks.findIndex((t) => t.clips.some((c) => c.id === drag.clipId)), drag.dy) : 0, grid) : null;

  const onClipTap = (clip: Clip, track: Track, e: GestureResponderEvent) => {
    if (Date.now() - dragEndedAt.current < 350) return;
    // A quick double tap loops the clip (or the selection it belongs to), like Ctrl/Cmd+L.
    const last = lastTap.current;
    lastTap.current = { id: clip.id, at: Date.now() };
    if (last.id === clip.id && Date.now() - last.at < 320) {
      if (!selection.includes(clip.id)) setClipSelection(clip.id);
      loopSelection();
      return;
    }
    // Multi-selection: Shift/Cmd/Ctrl-click, or the multi-select mode (touch): a tap adds or removes the clip.
    const ne = e.nativeEvent as unknown as { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean };
    if (multiSelect || ne.shiftKey || ne.metaKey || ne.ctrlKey) {
      const current = selectedClipIds(getState());
      const next = current.includes(clip.id) ? current.filter((id) => id !== clip.id) : [...current, clip.id];
      setClipSelection(next[0] ?? null, next.slice(1));
      setState({ selectedTrackId: track.id });
      return;
    }
    // A second tap on a selected MIDI clip opens its notes.
    if (clip.notes && selectedClipId === clip.id && selection.length === 1) {
      setState({ panel: 'piano' });
      return;
    }
    setClipSelection(clip.id);
    setState({ selectedTrackId: track.id });
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

      {/* Markers (locators): tap = jump there, long press = edit; long press on the empty strip = a new marker there. */}
      <View style={s.markerRow}>
        <Pressable accessibilityLabel="Marker an der Abspielposition setzen" onPress={() => updateProject((p) => addMarker(p, getState().cursor), { reschedule: false })} style={[s.corner, s.markerCorner, { width: headerW }]}>
          <Txt style={s.markerAdd}>+ Marker</Txt>
        </Pressable>
        <View style={s.rulerClip}>
          <Animated.View style={{ width, height: MARKER_H, transform: [{ translateX: Animated.multiply(scrollX, -1) }] }}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onLongPress={(e) => updateProject((p) => addMarker(p, Math.floor(Math.max(0, tapX(e) / zoom))), { reschedule: false })}
            />
            {(project.markers ?? []).map((m) => (
              <Pressable
                key={m.id}
                accessibilityLabel={`Marker ${m.name}`}
                onPress={() => setCursor(m.bar)}
                onLongPress={() => setState({ panel: 'markers' })}
                style={[s.marker, { left: m.bar * zoom }]}
              >
                <Txt numberOfLines={1} style={s.markerText}>
                  {m.name}
                </Txt>
              </Pressable>
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
              const laneParam = lanes[track.id];
              return (
                <Fragment key={track.id}>
                <Pressable
                  style={[s.trackHeader, { height: rowH }, small && s.trackHeaderSm, selected && s.trackHeaderSelected]}
                  onPress={() => setState({ selectedTrackId: track.id })}
                  onLongPress={() => setState({ selectedTrackId: track.id, selectedClipId: null, panel: 'track' })}
                >
                  <View style={s.trackTitle}>
                    <View style={[s.dot, trackKind(track) === 'midi' && s.dotMidi, { backgroundColor: track.color, opacity: anySolo && !track.solo ? 0.3 : 1 }]} />
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
                    <Pressable
                      accessibilityLabel={`Geräte von ${track.name}`}
                      onPress={() => setState({ selectedTrackId: track.id, selectedClipId: null, devicesFor: 'track', panel: 'devices' })}
                      style={[s.fxBtn, !!track.devices?.length && s.fxBtnOn]}
                    >
                      <Txt style={[s.fxText, !!track.devices?.length && { color: C.accentInk }]}>{track.devices?.length ? `FX${track.devices.length}` : 'FX'}</Txt>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Automation von ${track.name}`}
                      accessibilityState={{ selected: !!laneParam }}
                      onPress={() => (autoMode ? cycleLane(track) : toggleLane(track))}
                      style={[s.fxBtn, (!!laneParam || !!track.automation?.length) && s.fxBtnOn]}
                    >
                      <Txt style={[s.fxText, (!!laneParam || !!track.automation?.length) && { color: C.accentInk }]}>A</Txt>
                    </Pressable>
                    {autoMode && !small ? (
                      <Pressable accessibilityLabel={`Automations-Parameter von ${track.name}`} onPress={() => cycleLane(track)} style={s.autoChip}>
                        <Txt numberOfLines={1} style={s.autoChipText}>{`${paramDef(track, overlayParam(track)).label} ▾`}</Txt>
                      </Pressable>
                    ) : !small && !autoMode && (
                      <Fader
                        value={track.volume}
                        max={1.5}
                        onChange={(v) => updateProject((p) => mapTrack(p, track.id, (t) => ({ ...t, volume: v })), { reschedule: false })}
                      />
                    )}
                  </View>
                </Pressable>
                {laneParam && !autoMode && (
                  <Pressable accessibilityLabel={`Parameter der Automation von ${track.name}`} onPress={() => cycleLane(track)} style={[s.laneHeader, { height: LANE_H }]}>
                    <Txt style={s.laneParam}>{`${paramDef(track, laneParam).label} ▾`}</Txt>
                    <Txt style={s.laneHint}>{laneOf(track, laneParam).length ? `${laneOf(track, laneParam).length} Punkte` : 'tippen: Parameter'}</Txt>
                  </Pressable>
                )}
                </Fragment>
              );
            })}
            <View style={[s.trackHeader, { height: ADD_ROW_H, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
              <Pressable
                style={s.addTrack}
                accessibilityLabel="Audio-Spur hinzufügen"
                onPress={() => updateProject((p) => ({ ...p, tracks: [...p.tracks, createTrack('other', p.sceneCount)] }), { reschedule: false })}
              >
                <Plus size={12} color={C.dim} />
                <Txt style={s.addTrackText}>Audio</Txt>
              </Pressable>
              <Pressable
                style={s.addTrack}
                accessibilityLabel="MIDI-Spur hinzufügen"
                onPress={() => updateProject((p) => ({ ...p, tracks: [...p.tracks, createMidiTrack(p.sceneCount)] }), { reschedule: false })}
              >
                <Plus size={12} color={C.accent} />
                <Txt style={[s.addTrackText, { color: C.accent }]}>MIDI</Txt>
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
            <View ref={contentRef} {...bandHandlers} style={{ width, height: bodyH }}>
              <Grid zoom={zoom} totalBars={totalBars} height={bodyH} />
              {band && (
                <View
                  pointerEvents="none"
                  style={[s.band, { left: Math.min(band.x0, band.x1), top: Math.min(band.y0, band.y1), width: Math.abs(band.x1 - band.x0), height: Math.abs(band.y1 - band.y0) }]}
                />
              )}
              {project.tracks.map((track, index) => (
                <Fragment key={track.id}>
                <Pressable
                  style={[
                    s.lane,
                    { width, height: rowH },
                    selectedTrackId === track.id && s.laneSelected,
                    preview && track.clips.some((c) => preview.clips.has(c.id)) && { zIndex: 3 },
                  ]}
                  onPress={(e) => onLaneTap(track, e)}
                >
                  {track.clips.map((clip) => {
                    const sample = sampleById.get(clip.sampleId);
                    const moved = preview?.clips.get(clip.id);
                    const dragging = moved && drag ? drag : null;
                    const shown = moved ?? clip;
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
                        selected={selection.includes(clip.id)}
                        dragging={!!dragging}
                        liftY={dragging?.mode === 'move' && preview ? preview.shift * rowH : 0}
                        onTap={(e) => onClipTap(clip, track, e)}
                        onDrag={(mode, dx, dy, phase) => onClipDrag(clip, index, mode, dx, dy, phase)}
                      />
                    );
                  })}
                  {autoMode && <TrackCurve track={track} param={overlayParam(track)} zoom={zoom} width={width} height={rowH - 1} totalBars={totalBars} />}
                </Pressable>
                {lanes[track.id] && !autoMode && <LaneRow track={track} param={lanes[track.id]} zoom={zoom} width={width} totalBars={totalBars} />}
                </Fragment>
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


/** A MIDI clip's notes in miniature, scaled to the pitch range they use (at least an octave). */
/** The automation lane under a track: the whole arrangement at the arrangement's zoom, so a point sits right under the bar it belongs to. */
function LaneRow({ track, param, zoom, width, totalBars }: { track: Track; param: AutoParam; zoom: number; width: number; totalBars: number }) {
  const [sel, setSel] = useState<number | null>(null);
  return (
    <View style={[s.lane, { width, height: LANE_H }]}>
      <AutomationCurve track={track} param={param} start={0} span={totalBars} width={width} height={LANE_H - 1} selected={sel} onSelect={setSel} grid={zoom >= 36 ? 1 : zoom >= 18 ? 4 : 8} labels={false} />
    </View>
  );
}

/** Automation mode: the curve over the track's own clips, like Ableton's automation lanes in the track (A). */
function TrackCurve({ track, param, zoom, width, height, totalBars }: { track: Track; param: AutoParam; zoom: number; width: number; height: number; totalBars: number }) {
  const [sel, setSel] = useState<number | null>(null);
  return (
    <View style={s.trackCurve}>
      <AutomationCurve track={track} param={param} start={0} span={totalBars} width={width} height={height} selected={sel} onSelect={setSel} grid={zoom >= 36 ? 1 : zoom >= 18 ? 4 : 8} labels={false} overlay />
    </View>
  );
}

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
  band: { position: 'absolute', zIndex: 8, borderWidth: 1, borderColor: C.accent, backgroundColor: 'rgba(198,255,61,0.10)' },
  markerRow: { flexDirection: 'row', height: MARKER_H, zIndex: 5 },
  markerCorner: { justifyContent: 'center', paddingLeft: 10 },
  markerAdd: { ...font(600), fontSize: 10, color: C.muted },
  marker: { position: 'absolute', top: 2, height: MARKER_H - 4, maxWidth: 140, paddingHorizontal: 5, borderLeftWidth: 2, borderLeftColor: C.accent, backgroundColor: 'rgba(198,255,61,0.12)', borderTopRightRadius: 4, borderBottomRightRadius: 4, justifyContent: 'center' },
  markerText: { ...font(600), fontSize: 10, color: C.accent },
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
  fxBtn: { minWidth: 22, height: 24, paddingHorizontal: 2, borderRadius: 7, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  fxBtnOn: { backgroundColor: C.accent, borderColor: C.accent },
  fxText: { ...mono(), fontSize: 9, color: C.muted },
  autoChip: { flexShrink: 1, minWidth: 0, height: 20, paddingHorizontal: 6, borderRadius: 4, borderWidth: 1, borderColor: C.accent, justifyContent: 'center' },
  autoChipText: { ...font(600), fontSize: 10, color: C.accent },
  trackCurve: { position: 'absolute', left: 0, top: 0, zIndex: 5 },
  /** MIDI tracks get a square dot, audio tracks a round one. */
  dotMidi: { borderRadius: 2 },
  trackControls: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  addTrack: { flexDirection: 'row', alignItems: 'center', gap: 2, height: ADD_ROW_H },
  addTrackText: { color: C.dim, fontSize: 11 },
  laneHeader: { paddingHorizontal: 10, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: C.lineSoft, backgroundColor: 'rgba(198,255,61,0.04)' },
  laneParam: { ...font(600), fontSize: 12, color: C.accent },
  laneHint: { ...font(400), fontSize: 10, color: C.muted, marginTop: 2 },
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
