import { View } from 'react-native';
import type { SynthSettings } from '../../types';
import { Knob, KnobRow } from './Knob';

const PCT = (v: number) => `${Math.round(v * 100)}%`;
const CT = (v: number) => `${Math.round(v)}ct`;
const HZ = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')}k` : `${Math.round(v)}`);
const SEC = (v: number) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(1).replace('.', ',')}s`);

/** The knobs the compact synth card shows: position, unison, detune, filter and the amp envelope (everything else is in the big editor). */
export function SynthSettingsFields({ synth, set, size, width }: { synth: SynthSettings; set: (patch: Partial<SynthSettings>) => void; size: number; width: number }) {
  const k = { size, width };
  return (
    <View>
      <KnobRow>
        {!!synth.tableA && <Knob label="Pos" {...k} value={synth.posA ?? 0} min={0} max={1} reset={0} format={PCT} onChange={(v) => set({ posA: Math.round(v * 64) / 64 })} />}
        <Knob label="Unison" {...k} value={synth.unison ?? 1} min={1} max={7} step={1} reset={1} format={(v) => String(Math.round(v))} onChange={(v) => set({ unison: v, spread: v > 1 && !synth.spread ? 20 : synth.spread })} />
        <Knob label="Detune" {...k} value={synth.spread ?? 0} min={0} max={100} step={1} reset={0} format={CT} onChange={(v) => set({ spread: v })} />
        <Knob label="Cutoff" {...k} value={synth.cutoff} min={40} max={16000} curve="log" format={HZ} onChange={(v) => set({ cutoff: Math.round(v) })} />
        <Knob label="Reso" {...k} value={synth.resonance} min={0.5} max={20} step={0.1} reset={1} format={(v) => v.toFixed(1).replace('.', ',')} onChange={(v) => set({ resonance: v })} />
        <Knob label="F-Env" {...k} value={synth.filterEnv ?? 0} min={0} max={5} step={0.1} reset={0} format={(v) => (v ? v.toFixed(1).replace('.', ',') : 'aus')} onChange={(v) => set({ filterEnv: v })} />
      </KnobRow>
      <KnobRow>
        <Knob label="Att" {...k} value={synth.attack} min={0.001} max={2} curve="log" format={SEC} onChange={(v) => set({ attack: v })} />
        <Knob label="Dec" {...k} value={synth.decay} min={0.01} max={1.5} curve="log" format={SEC} onChange={(v) => set({ decay: v })} />
        <Knob label="Sus" {...k} value={synth.sustain} min={0} max={1} format={PCT} onChange={(v) => set({ sustain: v })} />
        <Knob label="Rel" {...k} value={synth.release} min={0.005} max={2.5} curve="log" format={SEC} onChange={(v) => set({ release: v })} />
        <Knob label="Sub" {...k} value={synth.sub ?? 0} min={0} max={1} reset={0} format={PCT} onChange={(v) => set({ sub: Math.round(v * 100) / 100 })} />
      </KnobRow>
    </View>
  );
}
