import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { C } from '../constants/theme';
import { instrumentKind } from '../audio/presets';
import { Txt } from './kit';
import { ChangeInstrument, FxRack, Header, Knob, KnobRow, KeyboardPanel, Panel } from './synth/skin';
import { Pads } from './synth/Pads';
import { EnvScope, FilterScope } from './synth/Scopes';
import { useInstrument } from './synth/useInstrument';

const SECOND = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2).replace('.', ',')} s`);
const HZ = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')} k` : `${Math.round(v)} Hz`);
const PCT = (v: number) => `${Math.round(v * 100)} %`;
const CT = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} ct`;

/** The three drum instruments (synth kick, noise for hats and snares, the 909 kit) in the plugin skin; apart from the synth and the sampler. */
export function DrumPanel({ width }: { width: number }) {
  const { track, synth, fx, set, setFx, hear } = useInstrument();
  const [keysLow, setKeysLow] = useState(36);
  if (!track || !synth || !fx) return null;
  const kind = instrumentKind(synth.wave);
  const inner = Math.max(160, width - 22);
  return (
    <View style={{ gap: 10 }}>
      <Header track={track} synth={synth} name={kind === 'kit' ? '909 Drum-Kit' : kind === 'kick' ? 'Synth-Kick' : 'Noise · Hat / Snare'} sub={kind === 'kit' ? 'Drum-Kit' : 'Drum-Synth'} onLevel={(v) => set({ gainDb: v })} />

      {kind === 'kit' && (
        <Panel title="909 PADS">
          <Pads color={C.accent} onHit={(p) => hear(synth, p)} />
          <Txt style={s.note}>Jedes Pad liegt auf einer Drum-Rack-Note (Kick C1, Snare D1, Clap D#1, Hi-Hat F#1 und A#1 …). Eine Hi-Hat zu schneidet die offene ab, wie am echten Gerät.</Txt>
          <KnobRow>
            <Knob label="Tune" value={synth.tune ?? 0} min={-600} max={600} step={10} reset={0} format={CT} onChange={(v) => set({ tune: Math.round(v) })} />
            <Knob label="Decay" value={synth.kitDecay ?? 1} min={0.4} max={2.5} curve="log" reset={1} format={(v) => `${v.toFixed(2).replace('.', ',')}×`} onChange={(v) => set({ kitDecay: Math.round(v * 100) / 100 })} />
          </KnobRow>
        </Panel>
      )}

      {kind === 'noise' && (
        <Panel title="FILTER">
          <FilterScope type="highpass" cutoff={synth.cutoff} resonance={synth.resonance} width={inner} height={84} />
          <KnobRow>
            <Knob label="Highpass" value={synth.cutoff} min={40} max={16000} curve="log" format={HZ} onChange={(v) => set({ cutoff: Math.round(v) })} />
            <Knob label="Reso" value={synth.resonance} min={0.5} max={20} step={0.1} reset={1} format={(v) => `${v.toFixed(1).replace('.', ',')} dB`} onChange={(v) => set({ resonance: v })} />
          </KnobRow>
        </Panel>
      )}

      {kind !== 'kit' && (
        <Panel title="AMP">
          <EnvScope attack={synth.attack} decay={synth.decay} sustain={synth.sustain} release={synth.release} width={inner} height={84} />
          <KnobRow>
            <Knob label="Attack" size={46} width={56} value={synth.attack} min={0.001} max={2} curve="log" format={SECOND} onChange={(v) => set({ attack: v })} />
            <Knob label="Decay" size={46} width={56} value={synth.decay} min={0.01} max={1.5} curve="log" format={SECOND} onChange={(v) => set({ decay: v })} />
            <Knob label="Sustain" size={46} width={56} value={synth.sustain} min={0} max={1} format={PCT} onChange={(v) => set({ sustain: v })} />
            <Knob label="Release" size={46} width={56} value={synth.release} min={0.005} max={2.5} curve="log" format={SECOND} onChange={(v) => set({ release: v })} />
          </KnobRow>
        </Panel>
      )}

      <FxRack fx={fx} setFx={setFx} />
      {kind !== 'kit' && <KeyboardPanel low={keysLow} onLow={setKeysLow} onKey={(p) => hear(synth, p)} />}
      <ChangeInstrument />
    </View>
  );
}

const s = StyleSheet.create({ note: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 8 } });
