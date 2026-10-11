import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { engine } from '../audio/engine';
import { applyInstrument, applyPreset, PRESET_CATEGORIES, presetById, PRESETS, type PresetCategory } from '../audio/presets';
import { KICK_PRESET, NOISE_PRESET, SAMPLER_PRESET } from '../audio/synth';
import { C, font, mono } from '../constants/theme';
import { DEFAULT_SYNTH, mapTrack, trackSynth } from '../lib/project';
import { updateProject, useStore } from '../lib/store';
import type { OscWave, SynthSettings } from '../types';
import { hz, Param, pct, sec } from './Param';
import { Btn, Chip, Section, Txt } from './kit';
import { Sheet } from './Sheet';

type Kind = 'synth' | 'sample' | 'kick' | 'noise';
const kindOf = (wave: SynthSettings['wave']): Kind => (wave === 'sample' ? 'sample' : wave === 'kick' ? 'kick' : wave === 'noise' ? 'noise' : 'synth');
const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'synth', label: 'Synth' },
  { kind: 'sample', label: 'Sample' },
  { kind: 'kick', label: 'Kick' },
  { kind: 'noise', label: 'Noise / Hat' },
];
const WAVES: { wave: OscWave; label: string }[] = [
  { wave: 'sawtooth', label: 'Saw' },
  { wave: 'square', label: 'Square' },
  { wave: 'triangle', label: 'Triangle' },
  { wave: 'sine', label: 'Sine' },
];
const UNISON = [1, 2, 3, 5, 7];
const OCTAVES = [-2, -1, 0, 1, 2];
const FILTERS: { type: NonNullable<SynthSettings['filterType']>; label: string }[] = [
  { type: 'lowpass', label: 'Lowpass' },
  { type: 'highpass', label: 'Highpass' },
  { type: 'bandpass', label: 'Bandpass' },
];
/** LFO speeds in cycles per bar (the label says the same in words). */
const LFO_RATES: { rate: number; label: string }[] = [
  { rate: 0.25, label: '¼' },
  { rate: 0.5, label: '½' },
  { rate: 1, label: '1×' },
  { rate: 2, label: '2×' },
  { rate: 4, label: '4×' },
  { rate: 8, label: '8×' },
  { rate: 16, label: '16×' },
];
const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

/**
 * The sound of the selected track, Ableton-style: a preset browser by category on top, below it an
 * editor for the synth (two oscillators, unison, sub, noise, filter with envelope, tempo LFO, ADSR).
 * Every change is heard on the next notes; a drag is one undo step.
 */
export function InstrumentPanel() {
  const track = useStore((st) => st.project.tracks.find((t) => t.id === st.selectedTrackId));
  const samples = useStore((st) => st.samples);
  const [category, setCategory] = useState<PresetCategory | null>(null);
  if (!track) {
    return (
      <Sheet title="Sound">
        <Txt style={s.note}>Wähle im Arrangement eine Spur aus.</Txt>
      </Sheet>
    );
  }
  const trackId = track.id;
  const synth = trackSynth(track);
  const kind = kindOf(synth.wave);
  const current = presetById(synth.preset);
  const shown = category ?? current?.category ?? 'Bass';

  /** Knobs: a drag is one undo step. */
  const set = (patch: Partial<SynthSettings>) => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, synth: { ...trackSynth(t), ...patch } })), { merge: true });
  const setB = (patch: Partial<NonNullable<SynthSettings['oscB']>>) => {
    const b = synth.oscB ?? { wave: 'sawtooth' as OscWave, octave: 0, detune: 0, level: 0.7 };
    set({ oscB: { ...b, ...patch } });
  };
  const hear = (s: SynthSettings, pitch: number) => void engine.previewNote(s, pitch);

  const pickPreset = (id: string) => {
    const preset = presetById(id);
    if (!preset) return;
    updateProject((p) => mapTrack(p, trackId, (t) => applyPreset(t, preset)));
    hear(preset.synth, preset.note);
  };
  const pickKind = (k: Kind) => {
    if (k === kind) return;
    const sampleId = synth.sampleId;
    const next: SynthSettings =
      k === 'synth' ? { ...DEFAULT_SYNTH, sampleId }
      : k === 'sample' ? { ...DEFAULT_SYNTH, ...SAMPLER_PRESET, sampleId: sampleId ?? samples[0]?.id } as SynthSettings
      : k === 'kick' ? { ...DEFAULT_SYNTH, ...KICK_PRESET, sampleId } as SynthSettings
      : ({ ...DEFAULT_SYNTH, ...NOISE_PRESET, sampleId } as SynthSettings);
    updateProject((p) => mapTrack(p, trackId, (t) => applyInstrument(t, next)));
    hear(next, 60);
  };
  const b = synth.oscB;

  return (
    <Sheet title="Sound">
      <Txt numberOfLines={1} style={s.current}>
        {current ? `${current.name} · ${track.name}` : `${track.synth ? 'Eigener Sound' : 'Standard-Synth'} · ${track.name}`}
      </Txt>

      <Section title="Presets">
        <View style={s.chips}>
          {PRESET_CATEGORIES.map((c) => (
            <Chip key={c} variant={shown === c ? 'on' : 'ghost'} onPress={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </View>
        <View style={s.list}>
          {PRESETS.filter((p) => p.category === shown).map((p) => (
            <Pressable key={p.id} accessibilityLabel={`Preset ${p.name}`} accessibilityState={{ selected: synth.preset === p.id }} onPress={() => pickPreset(p.id)} style={[s.row, synth.preset === p.id && s.rowOn]}>
              <Txt style={[s.rowName, synth.preset === p.id && { color: C.accent }]}>{p.name}</Txt>
              <Txt numberOfLines={1} style={s.rowHint}>
                {p.hint}
              </Txt>
            </Pressable>
          ))}
        </View>
      </Section>

      <Section title="Instrument-Typ">
        <View style={s.chips}>
          {KINDS.map((k) => (
            <Chip key={k.kind} variant={kind === k.kind ? 'on' : 'ghost'} onPress={() => pickKind(k.kind)}>
              {k.label}
            </Chip>
          ))}
        </View>
        {kind === 'sample' && (
          <>
            <Txt style={[s.note, { marginTop: 12 }]}>
              {samples.length ? 'Das Sample klingt auf C3 im Original, jede andere Note spielt es höher oder tiefer. Ideal für Drums: eine Spur pro Sound, Noten auf C3.' : 'Lade zuerst ein Sample in die Bibliothek (z. B. eine Kick oder einen Hat).'}
            </Txt>
            <ScrollView style={s.sampleList} nestedScrollEnabled>
              {samples.map((x) => (
                <Pressable
                  key={x.id}
                  accessibilityLabel={`Instrument-Sample ${x.name}`}
                  accessibilityState={{ selected: synth.sampleId === x.id }}
                  onPress={() => {
                    set({ sampleId: x.id });
                    hear({ ...synth, sampleId: x.id }, 60);
                  }}
                  style={[s.sampleRow, synth.sampleId === x.id && s.rowOn]}
                >
                  <Txt numberOfLines={1} style={[s.rowName, synth.sampleId === x.id && { color: C.accent }]}>
                    {x.name.replace(/\.[a-z0-9]+$/i, '')}
                  </Txt>
                </Pressable>
              ))}
            </ScrollView>
            {synth.sampleId && !samples.some((x) => x.id === synth.sampleId) && <Txt style={[s.note, { color: C.danger }]}>Das gewählte Sample ist nicht mehr in der Bibliothek.</Txt>}
            <View style={[s.chips, { marginTop: 10 }]}>
              <Chip variant={synth.oneShot ? 'on' : 'ghost'} onPress={() => set({ oneShot: true })}>
                Ganz abspielen
              </Chip>
              <Chip variant={synth.oneShot ? 'ghost' : 'on'} onPress={() => set({ oneShot: false })}>
                Notenlänge
              </Chip>
            </View>
          </>
        )}
        {(kind === 'kick' || kind === 'noise') && (
          <Txt style={[s.note, { marginTop: 12 }]}>
            {kind === 'kick' ? 'Synthetische Kick: auf C3 sitzt der Bauch bei 50 Hz. Länge über Decay, Härte über Drive bei den Effekten.' : 'Rauschen durch einen Highpass: kurzer Decay = Hi-Hat, längerer Decay und tieferer Filter = Snare.'}
          </Txt>
        )}
      </Section>

      {kind === 'synth' && (
        <>
          <Section title="Oszillator A">
            <View style={s.chips}>
              {WAVES.map((w) => (
                <Chip key={w.wave} variant={synth.wave === w.wave ? 'on' : 'ghost'} onPress={() => set({ wave: w.wave })}>
                  {w.label}
                </Chip>
              ))}
            </View>
            <Txt style={[s.sub, { marginTop: 14 }]}>Unison (verstimmte Kopien)</Txt>
            <View style={s.chips}>
              {UNISON.map((n) => (
                <Chip key={n} variant={(synth.unison ?? 1) === n ? 'on' : 'ghost'} onPress={() => set({ unison: n, spread: n > 1 && !synth.spread ? 20 : synth.spread })}>
                  {String(n)}
                </Chip>
              ))}
            </View>
            {(synth.unison ?? 1) > 1 && <Param label="Spread" value={synth.spread ?? 0} min={0} max={100} text={`${Math.round(synth.spread ?? 0)} ct`} onChange={(v) => set({ spread: Math.round(v) })} />}
          </Section>

          <Section title="Oszillator B">
            <View style={s.chips}>
              <Chip variant={b ? 'ghost' : 'on'} onPress={() => set({ oscB: undefined })}>
                Aus
              </Chip>
              {WAVES.map((w) => (
                <Chip key={w.wave} variant={b?.wave === w.wave ? 'on' : 'ghost'} onPress={() => setB({ wave: w.wave })}>
                  {w.label}
                </Chip>
              ))}
            </View>
            {b && (
              <>
                <Txt style={[s.sub, { marginTop: 14 }]}>Oktave</Txt>
                <View style={s.chips}>
                  {OCTAVES.map((o) => (
                    <Chip key={o} variant={b.octave === o ? 'on' : 'ghost'} onPress={() => setB({ octave: o })}>
                      {signed(o)}
                    </Chip>
                  ))}
                </View>
                <Param label="Verstimmung" value={b.detune} min={-50} max={50} text={`${signed(Math.round(b.detune))} ct`} onChange={(v) => setB({ detune: Math.round(v) })} />
                <Param label="Pegel" value={b.level} min={0} max={1} text={pct(b.level)} onChange={(v) => setB({ level: Math.round(v * 100) / 100 })} />
              </>
            )}
          </Section>

          <Section title="Sub & Rauschen">
            <Param label="Sub" value={synth.sub ?? 0} min={0} max={1} text={pct(synth.sub ?? 0)} onChange={(v) => set({ sub: Math.round(v * 100) / 100 })} />
            <Param label="Rauschen" value={synth.noise ?? 0} min={0} max={1} text={pct(synth.noise ?? 0)} onChange={(v) => set({ noise: Math.round(v * 100) / 100 })} />
          </Section>
        </>
      )}

      {kind !== 'sample' && (
        <Section title="Filter">
          {kind === 'synth' && (
            <View style={[s.chips, { marginBottom: 4 }]}>
              {FILTERS.map((f) => (
                <Chip key={f.type} variant={(synth.filterType ?? 'lowpass') === f.type ? 'on' : 'ghost'} onPress={() => set({ filterType: f.type })}>
                  {f.label}
                </Chip>
              ))}
            </View>
          )}
          <Param label={kind === 'noise' ? 'Highpass' : 'Cutoff'} value={Math.log10(synth.cutoff)} min={Math.log10(40)} max={Math.log10(16000)} text={hz(synth.cutoff)} onChange={(v) => set({ cutoff: Math.round(10 ** v) })} />
          <Param label="Resonanz" value={synth.resonance} min={0.5} max={20} text={synth.resonance.toFixed(1)} onChange={(v) => set({ resonance: Math.round(v * 10) / 10 })} />
          {kind === 'synth' && (
            <>
              <Param label="Filter-Env" value={synth.filterEnv ?? 0} min={0} max={5} text={synth.filterEnv ? `${(synth.filterEnv).toFixed(1).replace('.', ',')} Okt.` : 'Aus'} onChange={(v) => set({ filterEnv: Math.round(v * 10) / 10 })} />
              {!!synth.filterEnv && <Param label="Env-Decay" value={synth.filterDecay ?? 0.25} min={0.02} max={1.5} text={sec(synth.filterDecay ?? 0.25)} onChange={(v) => set({ filterDecay: Math.round(v * 100) / 100 })} />}
            </>
          )}
        </Section>
      )}

      {kind === 'synth' && (
        <Section title="LFO auf den Filter">
          <Txt style={s.sub}>Zyklen pro Takt, synchron zum Tempo</Txt>
          <View style={s.chips}>
            <Chip variant={synth.lfoRate ? 'ghost' : 'on'} onPress={() => set({ lfoRate: undefined, lfoDepth: undefined })}>
              Aus
            </Chip>
            {LFO_RATES.map((r) => (
              <Chip key={r.rate} variant={synth.lfoRate === r.rate ? 'on' : 'ghost'} onPress={() => set({ lfoRate: r.rate, lfoDepth: synth.lfoDepth || 0.4 })}>
                {r.label}
              </Chip>
            ))}
          </View>
          {!!synth.lfoRate && <Param label="Tiefe" value={synth.lfoDepth ?? 0} min={0} max={1} text={pct(synth.lfoDepth ?? 0)} onChange={(v) => set({ lfoDepth: Math.round(v * 100) / 100 })} />}
        </Section>
      )}

      <Section title="Hüllkurve">
        <Param label="Attack" value={synth.attack} min={0.001} max={2} text={sec(synth.attack)} onChange={(v) => set({ attack: v })} />
        <Param label="Decay" value={synth.decay} min={0.01} max={1.5} text={sec(synth.decay)} onChange={(v) => set({ decay: v })} />
        <Param label="Sustain" value={synth.sustain} min={0} max={1} text={`${Math.round(synth.sustain * 100)} %`} onChange={(v) => set({ sustain: v })} />
        <Param label="Release" value={synth.release} min={0.005} max={2.5} text={sec(synth.release)} onChange={(v) => set({ release: v })} />
      </Section>

      <View style={[s.chips, { marginTop: 4 }]}>
        <Btn kind="primary" onPress={() => hear(synth, kind === 'synth' ? (current?.note ?? 48) : 60)}>
          Anhören
        </Btn>
        <Btn onPress={() => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, synth: undefined })))}>Zurücksetzen</Btn>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  current: { ...font(600), fontSize: 14, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  list: { marginTop: 12, borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: 'hidden' },
  row: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  rowOn: { backgroundColor: 'rgba(198,255,61,0.08)' },
  rowName: { fontSize: 14, ...font(600) },
  rowHint: { color: C.muted, fontSize: 12, marginTop: 2 },
  sampleList: { maxHeight: 176, marginTop: 8, borderWidth: 1, borderColor: C.line, borderRadius: 10 },
  sampleRow: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line },
  note: { color: C.muted, fontSize: 12, lineHeight: 17 },
  sub: { color: C.muted, fontSize: 13 },
  value: { ...mono(), fontSize: 13 },
});
