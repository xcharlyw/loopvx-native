import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { engine } from '../audio/engine';
import { formatBarPosition } from '../audio/timing';
import { applyPreset, presetById, SUGGESTED_PRESET } from '../audio/presets';
import { isDrumWave } from '../audio/synth';
import { C, mono } from '../constants/theme';
import { exportMidiClip, togglePlay } from '../lib/actions';
import { noteName } from '../lib/midi';
import { DRUM_STYLES, generatePattern, isDrumStyle, KEY_NAMES, PATTERN_GROUPS, usesScale, type PatternStyle } from '../lib/patterns';
import { SCALES, scaleOf, type ScaleName } from '../lib/melody';
import { addNote, duplicateNote, findClip, findNote, mapTrack, noteIndexAt, quantizeNotes, trackSynth, transposeNotes, updateClip, updateNote } from '../lib/project';
import { discardLastHistory, recordHistory, setState, updateProject, useStore } from '../lib/store';
import { clampPitch, clampScroll, edgeScrollSpeed, GRIP_W, movedNote, noteHitAreas, resizedNote } from '../lib/noteDrag';
import type { Note } from '../types';
import { useDrag, web } from './drag';
import { tapX, tapY } from './events';
import { Fader } from './Fader';
import { Btn, Chip, Section, Txt } from './kit';
import { Sheet } from './Sheet';

const ROW_H = 22;
const STEP_W = 24; // one 16th note
const STEPS_PER_BAR = 16;
const KEYS_W = 44;
const ROWS = 25; // two octaves and the C above
const LENGTHS: { label: string; bars: number }[] = [
  { label: '1/16', bars: 1 / 16 },
  { label: '1/8', bars: 1 / 8 },
  { label: '1/4', bars: 1 / 4 },
  { label: '1/2', bars: 1 / 2 },
  { label: '1 Takt', bars: 1 },
];
const BLACK = new Set([1, 3, 6, 8, 10]);
const clampLow = (v: number) => Math.max(0, Math.min(127 - ROWS + 1, v));
const pct = (v: number) => `${Math.round(v * 100)} %`;
const lengthText = (bars: number) => LENGTHS.find((l) => Math.abs(l.bars - bars) < 1e-6)?.label ?? `${Math.round(bars * 64)}/64`;

/**
 * Lowest shown pitch. Empty clip: C1 (bass range), C2 for drum instruments (C3 in view). Otherwise the
 * grid starts just under the lowest note when the whole clip fits in two octaves (a trance lead spanning
 * 57..80 shows completely), else at the octave of the lowest note.
 */
function initialLow(notes: Note[], sampler = false): number {
  if (!notes.length) return sampler ? 48 : 36;
  const lowest = Math.min(...notes.map((n) => n.pitch));
  const highest = Math.max(...notes.map((n) => n.pitch));
  if (sampler) return clampLow(Math.floor(lowest / 12) * 12 - 12); // drums sit on C3: keep an octave below in view too
  if (highest - lowest <= ROWS - 3) return clampLow(lowest - 2);
  return clampLow(Math.floor(lowest / 12) * 12);
}

// The generator's last choice, kept while the app runs so every clip of a track lands in the same key.
let lastStyle: PatternStyle = 'rumble';
let lastDrum: PatternStyle = 'kick';
let lastRoot = 5; // F minor
let lastScale: ScaleName = 'minor';

/**
 * Step piano roll, two octaves at a time. Tap an empty cell to add a note (and hear it), tap a note to
 * select it: then move, lengthen, soften or duplicate it below the grid. "Radierer" removes notes by tap.
 */
export function PianoRollPanel() {
  const project = useStore((st) => st.project);
  const selectedClipId = useStore((st) => st.selectedClipId);
  const found = selectedClipId ? findClip(project, selectedClipId) : null;
  const [low, setLow] = useState(() => initialLow(found?.clip.notes ?? [], !!found?.track.synth && isDrumWave(found.track.synth.wave)));
  const [noteLen, setNoteLen] = useState(1 / 16);
  const [dragging, setDragging] = useState(false);
  /** What the drag handlers need at the moment of the gesture (they are created once, the state moves on). */
  const live = useRef<{ notes: Note[]; selIndex: number; clipId: string; clipLength: number; low: number; high: number; contentWidth: number; hear: (pitch: number) => void } | null>(null);
  /**
   * The running gesture: the notes as they were when it began, so every move is computed from the start,
   * plus the finger and the visible area for auto-scroll. `dx`/`dy` are the finger's offset on screen; the
   * distance the grid has scrolled since the start is added, so the note stays under the finger.
   */
  const gesture = useRef<{
    mode: 'move' | 'resize';
    notes: Note[];
    index: number;
    base: Note;
    last: Note;
    recorded: boolean;
    scrollStart: number;
    dx: number;
    dy: number;
    fingerX?: number;
    viewLeft?: number;
    viewRight?: number;
    tickAt: number;
  } | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const viewRef = useRef<View>(null);
  const scrollX = useRef(0);
  const viewW = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTicker = () => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
  };
  useEffect(() => stopTicker, []);
  const [tool, setTool] = useState<'draw' | 'erase'>('draw');
  /** The selected note, by identity (pitch and start): stays valid across undo and re-sorting. */
  const [sel, setSel] = useState<{ pitch: number; start: number } | null>(null);

  /** Put the dragged note where the finger is now (including what the grid scrolled since the start). */
  const applyDrag = () => {
    const g = gesture.current;
    const c = live.current;
    if (!g || !c) return;
    const dx = g.dx + (scrollX.current - g.scrollStart);
    const patch = g.mode === 'move' ? movedNote(g.base, dx, g.dy, STEP_W, ROW_H) : resizedNote(g.base, dx, STEP_W);
    if (patch.pitch !== undefined) patch.pitch = clampPitch(patch.pitch, c.low, c.high);
    const r = updateNote(g.notes, g.index, patch, c.clipLength);
    const l = g.last;
    if (r.note.pitch === l.pitch && Math.abs(r.note.start - l.start) < 1e-9 && Math.abs(r.note.length - l.length) < 1e-9) return;
    if (!g.recorded) {
      recordHistory(); // the whole drag is one undo step, however long it takes
      g.recorded = true;
    }
    if (r.note.pitch !== l.pitch) c.hear(r.note.pitch);
    g.last = r.note;
    setSel({ pitch: r.note.pitch, start: r.note.start });
    updateProject((p) => updateClip(p, c.clipId, { notes: r.notes }), { record: false });
  };

  /** Every frame of a drag: near an edge of the visible grid, scroll it (the finger may be holding still). */
  const autoScroll = () => {
    const g = gesture.current;
    const c = live.current;
    if (!g || !c || g.fingerX === undefined || g.viewLeft === undefined || g.viewRight === undefined) return;
    const now = Date.now();
    const dt = Math.min(50, now - g.tickAt);
    g.tickAt = now;
    const speed = edgeScrollSpeed(g.fingerX, g.viewLeft, g.viewRight);
    if (!speed) return;
    const next = clampScroll(scrollX.current + (speed * dt) / 1000, c.contentWidth, viewW.current);
    if (next === scrollX.current) return;
    scrollX.current = next;
    scrollRef.current?.scrollTo({ x: next, animated: false });
    applyDrag();
  };

  const drag = (mode: 'move' | 'resize', dx: number, dy: number, phase: 'move' | 'end' | 'cancel', at?: { x: number; y: number }) => {
    const c = live.current;
    if (!c) return;
    if (phase !== 'move') {
      const g = gesture.current;
      // Dragged out and back to where it began: nothing changed, so there is nothing to undo either.
      if (g?.recorded && g.last.pitch === g.base.pitch && Math.abs(g.last.start - g.base.start) < 1e-9 && Math.abs(g.last.length - g.base.length) < 1e-9) discardLastHistory();
      stopTicker();
      gesture.current = null;
      setDragging(false);
      return;
    }
    let g = gesture.current;
    if (!g) {
      if (c.selIndex < 0) return;
      const base = c.notes[c.selIndex];
      g = gesture.current = { mode, notes: c.notes, index: c.selIndex, base, last: base, recorded: false, scrollStart: scrollX.current, dx: 0, dy: 0, tickAt: Date.now() };
      setDragging(true);
      // Where the visible grid is on screen, to tell when the finger is at its edge.
      viewRef.current?.measureInWindow((x, _y, w) => {
        if (gesture.current) {
          gesture.current.viewLeft = x;
          gesture.current.viewRight = x + w;
        }
      });
      stopTicker();
      ticker.current = setInterval(autoScroll, 16);
    }
    g.dx = dx;
    g.dy = dy;
    if (at) g.fingerX = at.x;
    applyDrag();
  };
  const moveDrag = useDrag('start', true, (dx, dy, phase, at) => drag('move', dx, dy, phase, at));
  const resizeDrag = useDrag('start', true, (dx, _dy, phase, at) => drag('resize', dx, 0, phase, at));
  const sampler = !!found?.track.synth && isDrumWave(found.track.synth.wave); // drum styles, C3 centred
  const [picked, setStyle] = useState(sampler ? lastDrum : lastStyle);
  // The instrument may change while the roll is open: drum styles only for sample instruments.
  const style = sampler === isDrumStyle(picked) ? picked : sampler ? lastDrum : lastStyle;
  const [root, setRoot] = useState(lastRoot);
  const [scale, setScale] = useState<ScaleName>(lastScale);

  if (!found?.clip.notes) {
    return (
      <Sheet title="Piano Roll">
        <Txt style={s.note}>Wähle einen MIDI-Clip aus. Einen neuen legst du über „Spur bearbeiten“ an.</Txt>
      </Sheet>
    );
  }
  const { clip, track } = found;
  const notes = clip.notes ?? [];
  const steps = Math.round(clip.length * STEPS_PER_BAR);
  const width = steps * STEP_W;
  const height = ROWS * ROW_H;
  const high = low + ROWS - 1;
  const pitchAtRow = (row: number) => high - row;
  const selIndex = sel ? findNote(notes, sel.pitch, sel.start) : -1;
  const selected = selIndex >= 0 ? notes[selIndex] : null;
  const setNotes = (next: Note[], opts: { merge?: boolean } = {}) => updateProject((p) => updateClip(p, clip.id, { notes: next }), opts);
  const hear = (pitch: number) => void engine.previewNote(trackSynth(track), pitch);
  live.current = { notes, selIndex, clipId: clip.id, clipLength: clip.length, low, high, contentWidth: steps * STEP_W, hear };

  const onTap = (e: Parameters<typeof tapX>[0]) => {
    const step = Math.floor(tapX(e) / STEP_W);
    const row = Math.floor(tapY(e) / ROW_H);
    if (step < 0 || step >= steps || row < 0 || row >= ROWS) return;
    const pitch = pitchAtRow(row);
    const start = step / STEPS_PER_BAR;
    const hit = noteIndexAt(notes, pitch, start);
    if (hit >= 0) {
      if (tool === 'erase') {
        if (selected === notes[hit]) setSel(null);
        setNotes(notes.filter((_, i) => i !== hit));
      } else {
        setSel({ pitch, start: notes[hit].start });
        hear(pitch);
      }
      return;
    }
    if (tool === 'erase') return;
    const note: Note = { pitch, start, length: Math.min(noteLen, clip.length - start), velocity: 0.8 };
    setSel({ pitch, start });
    hear(pitch);
    setNotes(addNote(notes, note));
  };

  /** Change the selected note; the grid follows it when it leaves the visible octaves. */
  const edit = (patch: Partial<Note>, opts: { merge?: boolean; hear?: boolean } = {}) => {
    if (!selected) return;
    const r = updateNote(notes, selIndex, patch, clip.length);
    setSel({ pitch: r.note.pitch, start: r.note.start });
    if (r.note.pitch < low || r.note.pitch > high) setLow(clampLow(r.note.pitch - 12));
    if (opts.hear && r.note.pitch !== selected.pitch) hear(r.note.pitch);
    setNotes(r.notes, { merge: opts.merge });
  };
  const removeSelected = () => {
    if (!selected) return;
    setSel(null);
    setNotes(notes.filter((_, i) => i !== selIndex));
  };
  const duplicateSelected = () => {
    const d = duplicateNote(notes, selIndex, clip.length);
    if (!d) return;
    setSel({ pitch: d.note.pitch, start: d.note.start });
    setNotes(d.notes);
  };
  const playClip = () => {
    if (!engine.playing) setState({ cursor: clip.start });
    void togglePlay();
  };

  const generate = () => {
    if (isDrumStyle(style)) lastDrum = style;
    else lastStyle = style;
    lastRoot = root;
    lastScale = scale;
    const next = generatePattern(style, { root, bars: clip.length, seed: Math.floor(Math.random() * 2 ** 31), scale });
    updateProject((p) => updateClip(p, clip.id, { notes: next }));
    setLow(initialLow(next, sampler));
    setSel(null);
  };
  const shiftKey = (by: number) => setRoot((r) => (r + by + 12) % 12);
  /** The preset that suits the chosen style, unless the track plays a sample or already has it. */
  const suggestion = presetById(SUGGESTED_PRESET[style]);
  const offerSuggestion = !!suggestion && track.synth?.wave !== 'sample' && track.synth?.preset !== suggestion.id && !(sampler && !isDrumStyle(style));
  const loadSuggestion = () => {
    if (!suggestion) return;
    updateProject((p) => mapTrack(p, track.id, (t) => applyPreset(t, suggestion)));
    void engine.previewNote(suggestion.synth, suggestion.note);
  };

  return (
    <Sheet title="Piano Roll">
      <View style={s.toolbar}>
        <Chip variant={tool === 'draw' ? 'on' : 'ghost'} onPress={() => setTool('draw')}>
          Zeichnen
        </Chip>
        <Chip variant={tool === 'erase' ? 'on' : 'ghost'} onPress={() => setTool('erase')}>
          Radierer
        </Chip>
        <Btn small onPress={playClip}>
          Abspielen / Stop
        </Btn>
      </View>
      <View style={[s.toolbar, { marginTop: 8 }]}>
        <Txt style={s.range}>Neue Note</Txt>
        {LENGTHS.map((l) => (
          <Chip key={l.label} variant={noteLen === l.bars ? 'on' : 'ghost'} onPress={() => setNoteLen(l.bars)}>
            {l.label}
          </Chip>
        ))}
      </View>
      <View style={[s.toolbar, { marginTop: 8 }]}>
        <Btn small onPress={() => setLow((v) => Math.min(127 - ROWS + 1, v + 12))}>
          Oktave ▲
        </Btn>
        <Btn small onPress={() => setLow((v) => Math.max(0, v - 12))}>
          Oktave ▼
        </Btn>
        <Txt style={s.range}>{`${noteName(low)}–${noteName(high)}`}</Txt>
      </View>

      <View style={s.roll}>
        <View style={{ width: KEYS_W }}>
          {Array.from({ length: ROWS }, (_, row) => {
            const pitch = pitchAtRow(row);
            const black = BLACK.has(pitch % 12);
            return (
              <View key={row} style={[s.key, black && s.keyBlack]}>
                {pitch % 12 === 0 && <Txt style={s.keyText}>{noteName(pitch)}</Txt>}
              </View>
            );
          })}
        </View>
        <View ref={viewRef} style={{ flex: 1 }} onLayout={(e) => (viewW.current = e.nativeEvent.layout.width)}>
        <ScrollView
          ref={scrollRef}
          horizontal
          style={{ flex: 1 }}
          scrollEnabled={!dragging}
          scrollEventThrottle={16}
          onScroll={(e) => {
            // While dragging we drive the offset ourselves; a late scroll event must not set it back.
            if (!gesture.current) scrollX.current = e.nativeEvent.contentOffset.x;
          }}
        >
          <View style={{ width, height }}>
            <Svg width={width} height={height}>
              {Array.from({ length: ROWS }, (_, row) =>
                BLACK.has(pitchAtRow(row) % 12) ? <Rect key={`r${row}`} x={0} y={row * ROW_H} width={width} height={ROW_H} fill="#141417" /> : null,
              )}
              {Array.from({ length: ROWS + 1 }, (_, row) => (
                <Line key={`h${row}`} x1={0} x2={width} y1={row * ROW_H} y2={row * ROW_H} stroke="#1f1f24" strokeWidth={1} />
              ))}
              {Array.from({ length: steps + 1 }, (_, step) => (
                <Line
                  key={`v${step}`}
                  x1={step * STEP_W}
                  x2={step * STEP_W}
                  y1={0}
                  y2={height}
                  stroke={step % STEPS_PER_BAR === 0 ? '#3a3a42' : step % 4 === 0 ? '#2a2a30' : '#1c1c21'}
                  strokeWidth={step % STEPS_PER_BAR === 0 ? 2 : 1}
                />
              ))}
              {notes
                .filter((n) => n.pitch >= low && n.pitch <= high)
                .map((n, i) => (
                  <Rect
                    key={i}
                    x={n.start * STEPS_PER_BAR * STEP_W + 1}
                    y={(high - n.pitch) * ROW_H + 2}
                    width={Math.max(4, n.length * STEPS_PER_BAR * STEP_W - 2)}
                    height={ROW_H - 4}
                    rx={3}
                    fill={track.color}
                    opacity={0.5 + 0.5 * n.velocity}
                    stroke={n === selected ? '#fff' : 'none'}
                    strokeWidth={n === selected ? 2 : 0}
                  />
                ))}
            </Svg>
            <Pressable accessibilityLabel="Notenraster" onPress={onTap} style={StyleSheet.absoluteFill} />
            {selected && tool === 'draw' && selected.pitch >= low && selected.pitch <= high && (() => {
              const x = selected.start * STEPS_PER_BAR * STEP_W;
              const w = Math.max(4, selected.length * STEPS_PER_BAR * STEP_W);
              const top = (high - selected.pitch) * ROW_H;
              const hit = noteHitAreas(x, w, width);
              return (
                <>
                  <View
                    {...moveDrag}
                    accessibilityLabel="Note verschieben"
                    style={[s.noteHit, { left: hit.move.left, top: top - 4, width: hit.move.width, height: ROW_H + 8 }, web({ touchAction: 'none', cursor: 'grab' })]}
                  />
                  <View
                    {...resizeDrag}
                    accessibilityLabel="Notenlänge ziehen"
                    style={[s.noteGrip, { left: hit.grip.left, width: hit.grip.width, top: top - 9, alignItems: hit.gripInside ? 'center' : 'flex-start', paddingLeft: hit.gripInside ? 0 : 4 }, web({ touchAction: 'none', cursor: 'ew-resize' })]}
                  >
                    <View pointerEvents="none" style={s.gripBar} />
                  </View>
                </>
              );
            })()}
          </View>
        </ScrollView>
        </View>
      </View>

      <Section title="Note" style={{ marginTop: 14 }}>
        {selected ? (
          <>
            <Txt style={s.value}>{`${noteName(selected.pitch)} · ${formatBarPosition(selected.start)} · ${lengthText(selected.length)} · Anschlag ${pct(selected.velocity)}`}</Txt>
            <Txt style={[s.note, { marginTop: 6 }]}>Im Raster ziehen: Note bewegen. Weißen Griff am Ende ziehen: Länge ändern.</Txt>
            <Txt style={[s.sub, { marginTop: 10 }]}>Verschieben</Txt>
            <View style={s.toolbar}>
              <Btn small accessibilityLabel="Note früher" onPress={() => edit({ start: selected.start - 1 / STEPS_PER_BAR })}>
                ◀ 1/16
              </Btn>
              <Btn small accessibilityLabel="Note später" onPress={() => edit({ start: selected.start + 1 / STEPS_PER_BAR })}>
                1/16 ▶
              </Btn>
              <Btn small accessibilityLabel="Note höher" onPress={() => edit({ pitch: selected.pitch + 1 }, { hear: true })}>
                ▲ Halbton
              </Btn>
              <Btn small accessibilityLabel="Note tiefer" onPress={() => edit({ pitch: selected.pitch - 1 }, { hear: true })}>
                ▼ Halbton
              </Btn>
              <Btn small accessibilityLabel="Note eine Oktave höher" onPress={() => edit({ pitch: selected.pitch + 12 }, { hear: true })}>
                ▲ Oktave
              </Btn>
              <Btn small accessibilityLabel="Note eine Oktave tiefer" onPress={() => edit({ pitch: selected.pitch - 12 }, { hear: true })}>
                ▼ Oktave
              </Btn>
            </View>
            <Txt style={[s.sub, { marginTop: 12 }]}>Länge</Txt>
            <View style={s.toolbar}>
              {LENGTHS.map((l) => (
                <Chip key={l.label} variant={Math.abs(selected.length - l.bars) < 1e-6 ? 'on' : 'ghost'} onPress={() => edit({ length: l.bars })}>
                  {l.label}
                </Chip>
              ))}
            </View>
            <View style={[s.toolbar, { marginTop: 12, flexWrap: 'nowrap' }]}>
              <Txt style={{ width: 74, fontSize: 13 }}>Anschlag</Txt>
              <Fader value={selected.velocity} min={0.05} max={1} onChange={(v) => edit({ velocity: Math.round(v * 100) / 100 }, { merge: true })} />
              <Txt style={[s.value, { width: 52, textAlign: 'right' }]}>{pct(selected.velocity)}</Txt>
            </View>
            <View style={[s.toolbar, { marginTop: 12 }]}>
              <Btn small onPress={duplicateSelected}>
                Duplizieren
              </Btn>
              <Btn small kind="danger" onPress={removeSelected}>
                Löschen
              </Btn>
              <Btn small onPress={() => setSel(null)}>
                Fertig
              </Btn>
            </View>
          </>
        ) : (
          <Txt style={s.note}>
            {tool === 'erase'
              ? 'Radierer: Tippe eine Note an, um sie zu löschen.'
              : 'Tippe eine leere Zelle, um eine Note zu setzen. Tippe eine Note an, um sie auszuwählen: dann kannst du sie im Raster ziehen, am Griff verlängern oder unten leiser machen.'}
          </Txt>
        )}
      </Section>

      <Section title="Pattern-Generator" style={{ marginTop: 14 }}>
        {sampler ? (
          <View style={s.toolbar}>
            {DRUM_STYLES.map((p) => (
              <Chip key={p.id} variant={style === p.id ? 'on' : 'ghost'} onPress={() => setStyle(p.id)}>
                {p.label}
              </Chip>
            ))}
          </View>
        ) : (
          PATTERN_GROUPS.map((g, i) => (
            <View key={g.label} style={{ marginTop: i ? 10 : 0 }}>
              <Txt style={s.sub}>{g.label}</Txt>
              <View style={s.toolbar}>
                {g.styles.map((p) => (
                  <Chip key={p.id} variant={style === p.id ? 'on' : 'ghost'} onPress={() => setStyle(p.id)}>
                    {p.label}
                  </Chip>
                ))}
              </View>
            </View>
          ))
        )}
        {usesScale(style) && (
          <View style={{ marginTop: 12 }}>
            <Txt style={s.sub}>Tonleiter</Txt>
            <View style={s.toolbar}>
              {SCALES.map((sc) => (
                <Chip key={sc.id} variant={scale === sc.id ? 'on' : 'ghost'} onPress={() => setScale(sc.id)}>
                  {sc.label}
                </Chip>
              ))}
            </View>
          </View>
        )}
        <View style={[s.toolbar, { marginTop: 12 }]}>
          {!isDrumStyle(style) && (
            <>
              <Btn small onPress={() => shiftKey(-1)} accessibilityLabel="Tonart tiefer">
                ◀
              </Btn>
              <Txt style={s.key2}>{usesScale(style) ? `${KEY_NAMES[root]} ${scaleOf(scale).label}` : `${KEY_NAMES[root]}-Moll`}</Txt>
              <Btn small onPress={() => shiftKey(1)} accessibilityLabel="Tonart höher">
                ▶
              </Btn>
            </>
          )}
          <Btn small kind="primary" onPress={generate}>
            Würfeln
          </Btn>
        </View>
        <Txt style={[s.note, { marginTop: 8 }]}>Ersetzt die Noten des Clips. Gefällt es nicht: nochmal würfeln oder rückgängig machen. Melodie, Reese, Pad und Rave-Stabs folgen der Tonleiter und einer Akkordfolge.</Txt>
        {offerSuggestion && suggestion && (
          <View style={[s.toolbar, { marginTop: 10 }]}>
            <Txt style={[s.note, { flex: 1 }]}>{`Passender Sound: ${suggestion.name}`}</Txt>
            <Btn small onPress={loadSuggestion}>
              Sound laden
            </Btn>
          </View>
        )}
      </Section>

      <Section title="Clip" style={{ marginTop: 14 }}>
        <Txt style={s.note}>{`${notes.length} ${notes.length === 1 ? 'Note' : 'Noten'} · ${clip.length} ${clip.length === 1 ? 'Takt' : 'Takte'} · Instrument der Spur „${track.name}“`}</Txt>
        {notes.length > 0 && (
          <>
            <Txt style={[s.sub, { marginTop: 10 }]}>Alle Noten transponieren</Txt>
            <View style={s.toolbar}>
              {[-12, -1, 1, 12].map((by) => (
                <Btn key={by} small accessibilityLabel={`Alle Noten ${by > 0 ? '+' : ''}${by}`} onPress={() => setNotes(transposeNotes(notes, by))}>
                  {`${by > 0 ? '+' : '−'}${Math.abs(by)}`}
                </Btn>
              ))}
              <Btn small onPress={() => setNotes(quantizeNotes(notes))}>
                Auf Raster
              </Btn>
            </View>
          </>
        )}
        <View style={[s.toolbar, { marginTop: 10 }]}>
          <Btn small onPress={() => void exportMidiClip(clip, track.name)}>
            Als .mid exportieren
          </Btn>
          {notes.length > 0 && (
            <Btn small kind="danger" onPress={() => {
              setSel(null);
              setNotes([]);
            }}>
              Alle Noten löschen
            </Btn>
          )}
        </View>
      </Section>
    </Sheet>
  );
}

const s = StyleSheet.create({
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  range: { ...mono(), fontSize: 12, color: C.muted, marginLeft: 4 },
  roll: { flexDirection: 'row', marginTop: 12, borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: 'hidden', backgroundColor: C.bg },
  key: { height: ROW_H, justifyContent: 'center', paddingLeft: 6, backgroundColor: '#1d1d22', borderBottomWidth: 1, borderBottomColor: '#141417' },
  keyBlack: { backgroundColor: '#101013' },
  keyText: { ...mono(), fontSize: 10, color: C.muted },
  key2: { ...mono(), fontSize: 13, minWidth: 64, textAlign: 'center' },
  note: { color: C.muted, fontSize: 12, lineHeight: 17 },
  value: { ...mono(), fontSize: 13 },
  // Touch targets over the selected note: the body moves it, the strip at its right edge changes its length.
  noteHit: { position: 'absolute' },
  noteGrip: { position: 'absolute', width: GRIP_W, height: ROW_H + 18, alignItems: 'center', justifyContent: 'center' },
  gripBar: { width: 4, height: ROW_H - 4, borderRadius: 2, backgroundColor: '#fff' },
  sub: { color: C.muted, fontSize: 13, marginBottom: 8 },
});
