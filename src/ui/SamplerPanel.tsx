import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { EnvScope, FilterScope } from './synth/Scopes';
import { C, cond } from '../constants/theme';
import { noteName } from '../lib/midi';
import { Chip, Txt } from './kit';
import { ChangeInstrument, FxRack, Header, Knob, KnobRow, KeyboardPanel, Panel } from './synth/skin';
import { SamplePeaks } from './synth/SamplePeaks';
import { useInstrument } from './synth/useInstrument';
import { useState } from 'react';

const SECOND = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2).replace('.', ',')} s`);
const HZ = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')} k` : `${Math.round(v)} Hz`);
const PCT = (v: number) => `${Math.round(v * 100)} %`;
const CT = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} ct`;

/**
 * The sampler: its own panel, apart from the synth. One library sample played over the keyboard (chromatically, or as slices
 * when it was cut up), with root note, tune, level, a filter, an amp envelope and the track's FX rack. Same skin as the synth.
 */
export function SamplerPanel({ width }: { width: number }) {
  const { track, synth, fx, samples, set, setFx, hear } = useInstrument();
  const [keysLow, setKeysLow] = useState(48);
  if (!track || !synth || !fx) return null;
  const inner = Math.max(160, width - 22);
  const sample = samples.find((x) => x.id === synth.sampleId);
  const sliced = !!synth.slices?.length;
  return (
    <View style={{ gap: 10 }}>
      <Header track={track} synth={synth} name={sample ? sample.name.replace(/\.[a-z0-9]+$/i, '') : 'Kein Sample'} sub={sliced ? `${synth.slices!.length} Slices` : 'Sampler'} onLevel={(v) => set({ gainDb: v })} />

      <Panel title="SAMPLE">
        <SamplePeaks sampleId={synth.sampleId} width={inner} />
        <ScrollView style={s.list} nestedScrollEnabled>
          {samples.length === 0 && <Txt style={[s.note, { padding: 12 }]}>Lade zuerst ein Sample in die Bibliothek (z. B. eine Kick, einen Hat oder einen Bass-Ton).</Txt>}
          {samples.map((x) => (
            <Pressable
              key={x.id}
              accessibilityLabel={`Instrument-Sample ${x.name}`}
              accessibilityState={{ selected: synth.sampleId === x.id }}
              onPress={() => {
                // A new sample ends a slicer: its cut points belong to the old sample.
                set({ sampleId: x.id, slices: undefined, sliceBpm: undefined });
                hear({ ...synth, sampleId: x.id, slices: undefined, sliceBpm: undefined }, synth.sampleRoot ?? 60);
              }}
              style={[s.row, synth.sampleId === x.id && s.rowOn]}
            >
              <Txt numberOfLines={1} style={[s.rowName, synth.sampleId === x.id && { color: C.accent }]}>
                {x.name.replace(/\.[a-z0-9]+$/i, '')}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>
        {synth.sampleId && !sample && <Txt style={[s.note, { color: C.danger }]}>Das gewählte Sample ist nicht mehr in der Bibliothek.</Txt>}
        {sliced ? (
          <Txt style={s.note}>{`Slicer: Note 36 (C1) spielt Slice 1, jede Taste darüber den nächsten (${synth.slices!.length} Slices). Ein anderes Sample hebt das Slicen auf.`}</Txt>
        ) : (
          <>
            <KnobRow>
              <Knob label="Root" value={synth.sampleRoot ?? 60} min={24} max={96} step={1} reset={60} format={(v) => noteName(Math.round(v))} onChange={(v) => set({ sampleRoot: v })} />
              <Knob label="Tune" value={synth.tune ?? 0} min={-100} max={100} step={1} reset={0} format={CT} onChange={(v) => set({ tune: v })} />
            </KnobRow>
            <Txt style={s.note}>Root: die Note, auf der das Sample original klingt. Alle anderen Noten spielen es höher oder tiefer.</Txt>
            <View style={s.chips}>
              <Chip variant={synth.oneShot ? 'on' : 'ghost'} onPress={() => set({ oneShot: true })}>
                Ganz abspielen
              </Chip>
              <Chip variant={synth.oneShot ? 'ghost' : 'on'} onPress={() => set({ oneShot: false })}>
                Notenlänge
              </Chip>
            </View>
          </>
        )}
      </Panel>

      <View style={width >= 620 ? s.cols : undefined}>
        <View style={width >= 620 ? { flex: 1 } : undefined}>
          <Panel title="FILTER">
            <FilterScope type="lowpass" cutoff={synth.cutoff} resonance={synth.resonance} width={width >= 620 ? Math.floor(inner / 2) - 6 : inner} height={84} />
            <KnobRow>
              <Knob label="Cutoff" value={synth.cutoff} min={40} max={16000} curve="log" format={HZ} onChange={(v) => set({ cutoff: Math.round(v) })} />
              <Knob label="Reso" value={synth.resonance} min={0.5} max={20} step={0.1} reset={1} format={(v) => `${v.toFixed(1).replace('.', ',')} dB`} onChange={(v) => set({ resonance: v })} />
            </KnobRow>
          </Panel>
        </View>
        <View style={width >= 620 ? { flex: 1 } : { marginTop: 10 }}>
          <Panel title="AMP">
            <EnvScope attack={synth.attack} decay={synth.decay} sustain={synth.sustain} release={synth.release} width={width >= 620 ? Math.floor(inner / 2) - 6 : inner} height={84} />
            <KnobRow>
              <Knob label="Attack" size={46} width={56} value={synth.attack} min={0.001} max={2} curve="log" format={SECOND} onChange={(v) => set({ attack: v })} />
              <Knob label="Decay" size={46} width={56} value={synth.decay} min={0.01} max={1.5} curve="log" format={SECOND} onChange={(v) => set({ decay: v })} />
              <Knob label="Sustain" size={46} width={56} value={synth.sustain} min={0} max={1} format={PCT} onChange={(v) => set({ sustain: v })} />
              <Knob label="Release" size={46} width={56} value={synth.release} min={0.005} max={2.5} curve="log" format={SECOND} onChange={(v) => set({ release: v })} />
            </KnobRow>
          </Panel>
        </View>
      </View>

      <FxRack fx={fx} setFx={setFx} />
      <KeyboardPanel low={keysLow} onLow={setKeysLow} onKey={(p) => hear(synth, p)} />
      <ChangeInstrument />
    </View>
  );
}

const s = StyleSheet.create({
  cols: { flexDirection: 'row', gap: 10 },
  list: { maxHeight: 150, marginTop: 10, borderWidth: 1, borderColor: '#24242b', borderRadius: 10 },
  row: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#24242b' },
  rowOn: { backgroundColor: 'rgba(198,255,61,0.08)' },
  rowName: { ...cond(600), fontSize: 14, letterSpacing: 0.8, color: C.text },
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
});
