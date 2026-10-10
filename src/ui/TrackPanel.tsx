import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { engine } from '../audio/engine';
import { SAMPLER_PRESET } from '../audio/synth';
import { C, font, mono } from '../constants/theme';
import { createMidiClipOnTrack, deleteSelectedTrack, importMidiToTrack } from '../lib/actions';
import { DEFAULT_SYNTH, MAX_TRACK_NAME, TRACK_COLORS, mapTrack, renameTrack, trackSynth } from '../lib/project';
import type { SynthSettings } from '../types';
import { getState, setState, updateProject, useStore } from '../lib/store';
import { confirmDestructive } from './confirm';
import { Fader } from './Fader';
import { Plus, Trash } from './icons';
import { Btn, Chip, Section, Txt } from './kit';
import { Sheet } from './Sheet';

/** Rename, recolour or delete the selected track. Saves as you type; leaving the field empty restores the old name. */
export function TrackPanel() {
  const track = useStore((st) => st.project.tracks.find((t) => t.id === st.selectedTrackId));
  const samples = useStore((st) => st.samples);
  const [draft, setDraft] = useState<string | null>(null);
  if (!track) {
    return (
      <Sheet title="Spur">
        <Txt style={s.note}>Tippe im Arrangement auf eine Spur, um sie umzubenennen.</Txt>
      </Sheet>
    );
  }
  const trackId = track.id;
  const synth = trackSynth(track);
  /** Synth knobs: a drag is one undo step, and changes are heard on the next notes. */
  const setSynth = (patch: Partial<SynthSettings>) =>
    updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, synth: { ...trackSynth(t), ...patch } })), { merge: true });
  const value = draft ?? track.name;
  const isSampler = synth.wave === 'sample';
  /** Switching between oscillator and sample also swaps in sensible settings for the other kind. */
  const pickWave = (wave: SynthSettings['wave']) => {
    if (wave === synth.wave) return;
    if (wave === 'sample') setSynth({ ...SAMPLER_PRESET, sampleId: synth.sampleId ?? samples[0]?.id });
    else if (isSampler) setSynth({ ...DEFAULT_SYNTH, wave, sampleId: synth.sampleId });
    else setSynth({ wave });
  };

  const change = (text: string) => {
    setDraft(text);
    // The name updates live (it is what the headers and the mixer show); empty only while typing.
    updateProject((p) => renameTrack(p, trackId, text), { reschedule: false });
  };
  const finish = () => {
    if (!value.trim()) updateProject((p) => renameTrack(p, trackId, track.name || 'Spur'), { reschedule: false });
    else if (value !== value.trim()) updateProject((p) => renameTrack(p, trackId, value.trim()), { reschedule: false });
    setDraft(null);
    setState({ panel: 'none' });
  };

  const remove = async () => {
    await deleteSelectedTrack(confirmDestructive);
    if (!getState().project.tracks.some((t) => t.id === trackId)) setState({ panel: 'none' });
  };

  return (
    <Sheet title="Spur bearbeiten">
      <Section title="Name">
        <TextInput
          style={s.input}
          value={value}
          maxLength={MAX_TRACK_NAME}
          selectTextOnFocus
          returnKeyType="done"
          onChangeText={change}
          onBlur={() => {
            if (!value.trim()) updateProject((p) => renameTrack(p, trackId, 'Spur'), { reschedule: false });
          }}
          onSubmitEditing={finish}
          accessibilityLabel="Spurname"
        />
        <Txt style={s.note}>Tipp: Ein langer Druck auf den Spurnamen öffnet diese Ansicht auch direkt.</Txt>
      </Section>

      <Section title="Farbe">
        <View style={s.swatches}>
          {TRACK_COLORS.map((color) => (
            <Pressable
              key={color}
              accessibilityLabel={`Farbe ${color}`}
              accessibilityState={{ selected: track.color === color }}
              onPress={() => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, color })), { reschedule: false })}
              style={[s.swatch, { backgroundColor: color }, track.color === color && s.swatchOn]}
            />
          ))}
        </View>
      </Section>

      <Section title="MIDI">
        <Txt style={[s.note, { marginTop: 0, marginBottom: 10 }]}>
          MIDI-Clips spielen das Instrument dieser Spur. Noten setzt du in der Piano Roll (Clip zweimal antippen).
        </Txt>
        <View style={s.buttons}>
          <Btn small kind="primary" onPress={() => createMidiClipOnTrack(trackId)}>
            <Plus size={14} color={C.accentInk} />
            MIDI-Clip am Playhead
          </Btn>
          <Btn small onPress={() => void importMidiToTrack(trackId)}>
            .mid importieren
          </Btn>
        </View>
      </Section>

      <Section title="Instrument">
        <View style={s.swatches}>
          {WAVES.map((w) => (
            <Chip key={w.wave} variant={synth.wave === w.wave ? 'on' : 'ghost'} onPress={() => pickWave(w.wave)}>
              {w.label}
            </Chip>
          ))}
        </View>
        {isSampler && (
          <>
            <Txt style={[s.note, { marginTop: 12 }]}>
              {samples.length
                ? 'Das Sample klingt auf C3 im Original, jede andere Note spielt es höher oder tiefer. Ideal für Drums: eine Spur pro Sound (Kick, Clap, Hat), Noten auf C3.'
                : 'Lade zuerst ein Sample in die Bibliothek (z. B. eine Kick oder einen Hat).'}
            </Txt>
            <ScrollView style={s.sampleList} nestedScrollEnabled>
              {samples.map((x) => (
                <Pressable
                  key={x.id}
                  accessibilityLabel={`Instrument-Sample ${x.name}`}
                  accessibilityState={{ selected: synth.sampleId === x.id }}
                  onPress={() => {
                    setSynth({ sampleId: x.id });
                    void engine.previewNote({ ...synth, sampleId: x.id }, 60);
                  }}
                  style={[s.sampleRow, synth.sampleId === x.id && s.sampleRowOn]}
                >
                  <Txt numberOfLines={1} style={[s.sampleName, synth.sampleId === x.id && { color: C.accent }]}>
                    {x.name.replace(/\.[a-z0-9]+$/i, '')}
                  </Txt>
                </Pressable>
              ))}
            </ScrollView>
            {synth.sampleId && !samples.some((x) => x.id === synth.sampleId) && <Txt style={[s.note, { color: C.danger }]}>Das gewählte Sample ist nicht mehr in der Bibliothek.</Txt>}
            <View style={[s.swatches, { marginTop: 10 }]}>
              <Chip variant={synth.oneShot ? 'on' : 'ghost'} onPress={() => setSynth({ oneShot: true })}>
                Ganz abspielen
              </Chip>
              <Chip variant={synth.oneShot ? 'ghost' : 'on'} onPress={() => setSynth({ oneShot: false })}>
                Notenlänge
              </Chip>
            </View>
          </>
        )}
        <Param label="Filter" value={Math.log10(synth.cutoff)} min={Math.log10(80)} max={Math.log10(16000)} text={hz(synth.cutoff)} onChange={(v) => setSynth({ cutoff: Math.round(10 ** v) })} />
        <Param label="Resonanz" value={synth.resonance} min={0.5} max={15} text={synth.resonance.toFixed(1)} onChange={(v) => setSynth({ resonance: Math.round(v * 10) / 10 })} />
        <Param label="Attack" value={synth.attack} min={0.001} max={1} text={sec(synth.attack)} onChange={(v) => setSynth({ attack: v })} />
        <Param label="Decay" value={synth.decay} min={0.01} max={1.5} text={sec(synth.decay)} onChange={(v) => setSynth({ decay: v })} />
        <Param label="Sustain" value={synth.sustain} min={0} max={1} text={`${Math.round(synth.sustain * 100)} %`} onChange={(v) => setSynth({ sustain: v })} />
        <Param label="Release" value={synth.release} min={0.005} max={2} text={sec(synth.release)} onChange={(v) => setSynth({ release: v })} />
        <View style={[s.buttons, { marginTop: 10 }]}>
          <Btn small onPress={() => void engine.previewNote(synth, isSampler ? 60 : 48)}>
            {isSampler ? 'Anhören (C3)' : 'Anhören (C2)'}
          </Btn>
          <Btn small onPress={() => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, synth: undefined })))}>
            Zurücksetzen
          </Btn>
        </View>
      </Section>

      <Section title="Spur">
        <View style={{ flexDirection: 'row' }}>
          <Btn kind="danger" onPress={() => void remove()}>
            <Trash size={16} color={C.danger} />
            Spur löschen
          </Btn>
        </View>
      </Section>
    </Sheet>
  );
}

const WAVES: { wave: SynthSettings['wave']; label: string }[] = [
  { wave: 'sawtooth', label: 'Saw' },
  { wave: 'square', label: 'Square' },
  { wave: 'triangle', label: 'Triangle' },
  { wave: 'sine', label: 'Sine' },
  { wave: 'sample', label: 'Sample' },
];

const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')} kHz` : `${Math.round(v)} Hz`);
const sec = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2).replace('.', ',')} s`);

function Param({ label, value, min, max, text, onChange }: { label: string; value: number; min: number; max: number; text: string; onChange: (v: number) => void }) {
  return (
    <View style={s.param}>
      <Txt style={s.paramLabel}>{label}</Txt>
      <Fader value={value} min={min} max={max} onChange={onChange} />
      <Txt style={s.paramValue}>{text}</Txt>
    </View>
  );
}

const s = StyleSheet.create({
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  param: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  paramLabel: { width: 74, fontSize: 13 },
  paramValue: { ...mono(), width: 62, fontSize: 12, color: C.muted, textAlign: 'right' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: '#fff' },
  input: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panel,
    paddingHorizontal: 12,
    marginBottom: 8,
    color: C.text,
    ...font(400),
    fontSize: 14,
    outlineWidth: 0,
  },
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  sampleList: { maxHeight: 176, marginTop: 8, borderWidth: 1, borderColor: C.line, borderRadius: 10 },
  sampleRow: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line },
  sampleRowOn: { backgroundColor: 'rgba(198,255,61,0.08)' },
  sampleName: { fontSize: 13 },
});
