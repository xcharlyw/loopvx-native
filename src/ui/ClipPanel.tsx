import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { engine } from '../audio/engine';
import { sampleLengthBars } from '../audio/timing';
import { BEATS_PER_BAR } from '../config';
import { C, font, mono } from '../constants/theme';
import { exportMidiClip, scaleSelectedClip, setSampleBpm, setSampleWarp } from '../lib/actions';
import { findClip, updateClip } from '../lib/project';
import { setState, updateProject, useStore } from '../lib/store';
import type { Clip } from '../types';
import { Fader } from './Fader';
import { Btn, Chip, Section, Txt } from './kit';
import { Sheet } from './Sheet';

const STRETCH_BARS = [1, 2, 4, 8, 16];
const FADES = [0, 0.25, 0.5, 1, 2, 4];

const fmtBars = (bars: number) => (bars === 0.25 ? '¼' : bars === 0.5 ? '½' : String(bars));

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/** Length and tempo of the selected clip: Ableton's clip view, reduced to what a phone needs. */
export function ClipPanel() {
  const project = useStore((st) => st.project);
  const samples = useStore((st) => st.samples);
  const selectedClipId = useStore((st) => st.selectedClipId);
  const [bpmText, setBpmText] = useState<string | null>(null);

  const found = selectedClipId ? findClip(project, selectedClipId) : null;
  if (found?.clip.notes) return <MidiClipSheet clip={found.clip} trackName={found.track.name} />;
  const sample = found ? samples.find((x) => x.id === found.clip.sampleId) : undefined;
  if (!found || !sample) {
    return (
      <Sheet title="Clip">
        <Txt style={s.note}>Tippe im Arrangement auf einen Clip, um Länge und Tempo zu bearbeiten.</Txt>
      </Sheet>
    );
  }

  const stretch = sample.warp === 'stretch';

  const duration = sample.duration ?? engine.getBuffer(sample.id)?.duration;
  const loopBars = duration ? sampleLengthBars(duration, project.bpm, sample.bpm) : undefined;

  const commitBpm = () => {
    const v = Number(bpmText?.replace(',', '.'));
    setBpmText(null);
    if (bpmText !== null && v >= 40 && v <= 300) void setSampleBpm(sample, Math.round(v * 100) / 100);
  };
  const bpmFor = (bars: number) => Math.round(((bars * BEATS_PER_BAR * 60) / (duration ?? 1)) * 100) / 100;
  const stretchTo = (bars: number) => {
    if (duration) void setSampleBpm(sample, bpmFor(bars));
  };
  // At most an octave either way (half to double speed): beyond that re-pitching only sounds broken.
  const sensible = STRETCH_BARS.filter((bars) => {
    const rate = project.bpm / bpmFor(bars);
    return rate >= 0.5 && rate <= 2;
  });
  const choices = sensible.length ? sensible : STRETCH_BARS;

  return (
    <Sheet title="Clip">
      <Txt numberOfLines={1} style={s.name}>
        {sample.name.replace(/\.[a-z0-9]+$/i, '')}
      </Txt>

      <LengthSection clip={found.clip} />

      <LevelSection clip={found.clip} />

      <Section title="Tempo (Warp)">
        <View style={s.row}>
          <Txt style={{ flex: 1 }}>Original-Tempo</Txt>
          <TextInput
            style={s.input}
            value={bpmText ?? (sample.bpm ? fmt(sample.bpm) : '')}
            placeholder="–"
            placeholderTextColor={C.dim}
            keyboardType="decimal-pad"
            onFocus={() => setBpmText(sample.bpm ? fmt(sample.bpm) : '')}
            onChangeText={setBpmText}
            onBlur={commitBpm}
            onSubmitEditing={commitBpm}
            accessibilityLabel="Original-Tempo in BPM"
          />
          <Txt style={s.unit}>BPM</Txt>
        </View>
        <Txt style={s.note}>
          {!sample.bpm
            ? 'Kein Tempo gesetzt: das Sample läuft in Originalgeschwindigkeit.'
            : `Wird von ${fmt(sample.bpm)} auf ${fmt(project.bpm)} BPM gezogen (${fmt((project.bpm / sample.bpm) * 100)} % Tempo).`}
        </Txt>

        <Txt style={[s.label, { marginTop: 14 }]}>Modus</Txt>
        <View style={s.chips}>
          <Chip variant={stretch ? 'ghost' : 'on'} onPress={() => void setSampleWarp(sample, 'repitch')}>
            Re-Pitch
          </Chip>
          <Chip variant={stretch ? 'on' : 'ghost'} onPress={() => void setSampleWarp(sample, 'stretch')}>
            Tonhöhe halten
          </Chip>
        </View>
        <Txt style={s.note}>
          {stretch
            ? 'Wie „Complex“ in Ableton: nur das Tempo ändert sich, die Tonhöhe bleibt. Ideal für Vocals und Melodien.'
            : 'Wie „Re-Pitch“ in Ableton: Tempo und Tonhöhe ändern sich zusammen. Klingt bei Drums am natürlichsten.'}
        </Txt>

        <Txt style={[s.label, { marginTop: 14 }]}>Strecken auf</Txt>
        <View style={s.chips}>
          {choices.map((bars) => (
            <Chip key={bars} variant={loopBars === bars && sample.bpm ? 'on' : 'ghost'} onPress={() => stretchTo(bars)}>
              {bars === 1 ? '1 Takt' : `${bars} Takte`}
            </Chip>
          ))}
        </View>
        <Txt style={s.note}>
          {duration
            ? `Das ganze Sample (${fmt(duration)} s) passt dann genau auf so viele Takte im Projekttempo. Ideal, wenn ein AI-Vocal nicht im Takt sitzt.`
            : 'Spiel den Clip einmal ab, dann ist seine Länge bekannt.'}
        </Txt>
        {sample.bpm !== undefined && (
          <View style={[s.row, { marginTop: 10 }]}>
            <Btn small onPress={() => void setSampleBpm(sample, undefined)}>
              Nicht warpen
            </Btn>
          </View>
        )}
        <Txt style={[s.note, { marginTop: 10 }]}>Gilt für alle Clips dieses Samples.</Txt>
      </Section>
    </Sheet>
  );
}

/** A MIDI clip: length, level, and the way into its notes. */
function MidiClipSheet({ clip, trackName }: { clip: Clip; trackName: string }) {
  const count = clip.notes?.length ?? 0;
  return (
    <Sheet title="MIDI-Clip">
      <Txt numberOfLines={1} style={s.name}>{`${count} ${count === 1 ? 'Note' : 'Noten'} · Instrument „${trackName}“`}</Txt>
      <View style={[s.row, { flexWrap: 'wrap', marginBottom: 6 }]}>
        <Btn kind="primary" onPress={() => setState({ panel: 'piano' })}>
          Piano Roll öffnen
        </Btn>
        <Btn onPress={() => void exportMidiClip(clip, trackName)}>.mid exportieren</Btn>
      </View>
      <LengthSection clip={clip} />
      <LevelSection clip={clip} />
    </Sheet>
  );
}

function LengthSection({ clip }: { clip: Clip }) {
  return (
    <Section title="Länge">
      <View style={s.row}>
        <Txt style={[s.value, { flex: 1 }]}>{`${fmt(clip.length)} Takte`}</Txt>
        <Btn small onPress={() => scaleSelectedClip(0.5)}>
          ½
        </Btn>
        <Btn small onPress={() => scaleSelectedClip(2)}>
          ×2
        </Btn>
      </View>
      <Txt style={s.note}>Ränder des Clips ziehen kürzt oder verlängert ihn, die Schere teilt ihn an der Abspielposition.</Txt>
    </Section>
  );
}

/** Clip gain and fades; gain fader drags merge into one undo step but are heard right away. */
function LevelSection({ clip }: { clip: Clip }) {
  const gainDb = clip.gainDb ?? 0;
  const setClip = (patch: Partial<Clip>, merge = false) => updateProject((p) => updateClip(p, clip.id, patch), { merge });
  return (
    <Section title="Lautstärke & Fades">
      <View style={s.row}>
        <Txt style={{ width: 92 }}>Clip-Gain</Txt>
        <Fader value={gainDb} min={-24} max={6} onChange={(v) => setClip({ gainDb: Math.round(v * 2) / 2 }, true)} />
        <Txt style={[s.value, { width: 64, textAlign: 'right' }]}>{`${gainDb > 0 ? '+' : ''}${fmt(gainDb)} dB`}</Txt>
      </View>
      {gainDb !== 0 && (
        <View style={[s.row, { marginTop: 8 }]}>
          <Btn small onPress={() => setClip({ gainDb: 0 })}>
            Auf 0 dB
          </Btn>
        </View>
      )}
      {(['fadeIn', 'fadeOut'] as const).map((key) => (
        <View key={key}>
          <Txt style={[s.label, { marginTop: 14 }]}>{key === 'fadeIn' ? 'Fade-In' : 'Fade-Out'}</Txt>
          <View style={s.chips}>
            {FADES.filter((bars) => bars <= clip.length).map((bars) => (
              <Chip key={bars} variant={(clip[key] ?? 0) === bars ? 'on' : 'ghost'} onPress={() => setClip({ [key]: bars })}>
                {bars === 0 ? 'Aus' : `${fmtBars(bars)} ${bars <= 1 ? 'Takt' : 'Takte'}`}
              </Chip>
            ))}
          </View>
        </View>
      ))}
    </Section>
  );
}

const s = StyleSheet.create({
  name: { ...font(600), fontSize: 14, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  value: { ...mono(), fontSize: 13 },
  label: { color: C.muted, fontSize: 13 },
  unit: { ...mono(), fontSize: 12, color: C.muted },
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  input: {
    width: 76,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panel,
    paddingHorizontal: 10,
    color: C.text,
    ...mono(),
    fontSize: 13,
    textAlign: 'right',
    outlineWidth: 0,
  },
});
