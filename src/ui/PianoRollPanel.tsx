import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { engine } from '../audio/engine';
import { C, mono } from '../constants/theme';
import { exportMidiClip } from '../lib/actions';
import { noteName } from '../lib/midi';
import { generatePattern, KEY_NAMES, PATTERN_STYLES, type PatternStyle } from '../lib/patterns';
import { findClip, toggleNote, trackSynth, updateClip } from '../lib/project';
import { updateProject, useStore } from '../lib/store';
import type { Note } from '../types';
import { tapX, tapY } from './events';
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

/** Lowest shown pitch: the octave of the clip's lowest note, else C1 (bass range) or C2 for a sample instrument (C3 in view). */
function initialLow(notes: Note[], sampler = false): number {
  if (!notes.length) return sampler ? 48 : 36;
  const lowest = Math.min(...notes.map((n) => n.pitch));
  return Math.max(0, Math.min(127 - ROWS + 1, Math.floor(lowest / 12) * 12));
}

// The generator's last choice, kept while the app runs so every clip of a track lands in the same key.
let lastStyle: PatternStyle = 'rumble';
let lastRoot = 5; // F minor

/** Tap a cell to add a note (and hear it), tap a note to remove it. Two octaves at a time. */
export function PianoRollPanel() {
  const project = useStore((st) => st.project);
  const selectedClipId = useStore((st) => st.selectedClipId);
  const found = selectedClipId ? findClip(project, selectedClipId) : null;
  const [low, setLow] = useState(() => initialLow(found?.clip.notes ?? [], found?.track.synth?.wave === 'sample'));
  const [noteLen, setNoteLen] = useState(1 / 16);
  const [style, setStyle] = useState(lastStyle);
  const [root, setRoot] = useState(lastRoot);

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

  const onTap = (e: Parameters<typeof tapX>[0]) => {
    const step = Math.floor(tapX(e) / STEP_W);
    const row = Math.floor(tapY(e) / ROW_H);
    if (step < 0 || step >= steps || row < 0 || row >= ROWS) return;
    const pitch = pitchAtRow(row);
    const start = step / STEPS_PER_BAR;
    const next = toggleNote(notes, pitch, start, Math.min(noteLen, clip.length - start));
    if (next.length > notes.length) void engine.previewNote(trackSynth(track), pitch);
    updateProject((p) => updateClip(p, clip.id, { notes: next }));
  };

  const generate = () => {
    lastStyle = style;
    lastRoot = root;
    const next = generatePattern(style, { root, bars: clip.length, seed: Math.floor(Math.random() * 2 ** 31) });
    updateProject((p) => updateClip(p, clip.id, { notes: next }));
    setLow(initialLow(next));
  };
  const shiftKey = (by: number) => setRoot((r) => (r + by + 12) % 12);

  return (
    <Sheet title="Piano Roll">
      <View style={s.toolbar}>
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
        <ScrollView horizontal style={{ flex: 1 }}>
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
                  />
                ))}
            </Svg>
            <Pressable accessibilityLabel="Notenraster" onPress={onTap} style={StyleSheet.absoluteFill} />
          </View>
        </ScrollView>
      </View>

      <Section title="Pattern-Generator" style={{ marginTop: 14 }}>
        <View style={s.toolbar}>
          {PATTERN_STYLES.map((p) => (
            <Chip key={p.id} variant={style === p.id ? 'on' : 'ghost'} onPress={() => setStyle(p.id)}>
              {p.label}
            </Chip>
          ))}
        </View>
        <View style={[s.toolbar, { marginTop: 10 }]}>
          <Btn small onPress={() => shiftKey(-1)} accessibilityLabel="Tonart tiefer">
            ◀
          </Btn>
          <Txt style={s.key2}>{`${KEY_NAMES[root]}-Moll`}</Txt>
          <Btn small onPress={() => shiftKey(1)} accessibilityLabel="Tonart höher">
            ▶
          </Btn>
          <Btn small kind="primary" onPress={generate}>
            Würfeln
          </Btn>
        </View>
        <Txt style={[s.note, { marginTop: 8 }]}>Ersetzt die Noten des Clips. Gefällt es nicht: nochmal würfeln oder rückgängig machen.</Txt>
      </Section>

      <Section title="Clip" style={{ marginTop: 14 }}>
        <Txt style={s.note}>{`${notes.length} ${notes.length === 1 ? 'Note' : 'Noten'} · ${clip.length} ${clip.length === 1 ? 'Takt' : 'Takte'} · Instrument der Spur „${track.name}“`}</Txt>
        <View style={[s.toolbar, { marginTop: 10 }]}>
          <Btn small onPress={() => void exportMidiClip(clip, track.name)}>
            Als .mid exportieren
          </Btn>
          {notes.length > 0 && (
            <Btn small kind="danger" onPress={() => updateProject((p) => updateClip(p, clip.id, { notes: [] }))}>
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
});
