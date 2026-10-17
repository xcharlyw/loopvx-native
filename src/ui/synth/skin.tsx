import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { applyPreset, PRESET_CATEGORIES, PRESETS, presetById, INSTRUMENT_KINDS, instrumentKind, type PresetCategory } from '../../audio/presets';
import { C, cond, mono } from '../../constants/theme';
import { mapTrack } from '../../lib/project';
import { setState, updateProject } from '../../lib/store';
import type { SynthSettings, Track, TrackFx } from '../../types';
import { Chip, Txt } from '../kit';
import { Keys } from './Keys';
import { Knob as BaseKnob, KnobRow } from './Knob';
import { Panel } from './SynthPage';

// The pieces every instrument panel shares so synth, sampler and drums look like one plugin family: the header with the
// preset bar, the FX rack, the keyboard and the plugin knob.

/** A knob in the plugin skin. */
export const Knob = (p: React.ComponentProps<typeof BaseKnob>) => <BaseKnob skin="synth" size={52} width={64} {...p} />;
export { KnobRow, Panel };

const PCT = (v: number) => `${Math.round(v * 100)} %`;
export const DB = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} dB`;

/** The plugin's top bar: the LOOPVX mark with the instrument's name, the preset switcher in the middle (tap the name for the browser), a level knob. */
export function Header({ track, synth, name, sub, onStep, browsable, onLevel, onTitle }: { track: Track; synth: SynthSettings; name: string; sub: string; onStep?: (dir: 1 | -1) => void; browsable?: ReactNode; onLevel: (db: number) => void; onTitle?: () => void }) {
  return (
    <View style={h.wrap}>
      <View style={h.top}>
        <View style={h.brand}>
          <Svg width={30} height={30} viewBox="0 0 36 36">
            <Path d="M6,18 C10,6 14,6 18,18 S26,30 30,18" fill="none" stroke={C.accent} strokeWidth={2.6} strokeLinecap="round" />
          </Svg>
          <View>
            <Txt style={h.logo}>LOOPVX</Txt>
            <Txt style={h.kind}>{INSTRUMENT_KINDS.find((k) => k.kind === instrumentKind(synth.wave))?.title.toUpperCase()}</Txt>
          </View>
        </View>
        <View style={h.bar}>
          {onStep && (
            <Pressable accessibilityLabel="Vorheriges Preset" hitSlop={8} onPress={() => onStep(-1)} style={h.step}>
              <Txt style={h.stepText}>‹</Txt>
            </Pressable>
          )}
          <Pressable accessibilityLabel="Preset-Browser" disabled={!onTitle} onPress={onTitle} style={h.name}>
            <Txt numberOfLines={1} style={h.nameText}>{name}</Txt>
            <Txt numberOfLines={1} style={h.nameSub}>{`${track.name} · ${sub}`.toUpperCase()}</Txt>
          </Pressable>
          {onStep && (
            <Pressable accessibilityLabel="Nächstes Preset" hitSlop={8} onPress={() => onStep(1)} style={h.step}>
              <Txt style={h.stepText}>›</Txt>
            </Pressable>
          )}
        </View>
        <Knob label="Level" size={44} width={56} value={synth.gainDb ?? 0} min={-24} max={6} step={0.5} reset={0} format={DB} onChange={onLevel} />
      </View>
      {browsable}
    </View>
  );
}

/** The synth preset browser: categories as chips, the presets of one category as a list. */
export function PresetBrowser({ track, synth, onPick }: { track: Track; synth: SynthSettings; onPick: (id: string) => void }) {
  const current = presetById(synth.preset);
  const [category, setCategory] = useState<PresetCategory | null>(null);
  const shown = category ?? current?.category ?? 'Bass';
  return (
    <Panel title="PRESETS">
      <View style={h.chips}>
        {PRESET_CATEGORIES.map((c) => (
          <Chip key={c} variant={shown === c ? 'on' : 'ghost'} onPress={() => setCategory(c)}>
            {c}
          </Chip>
        ))}
      </View>
      <View style={h.list}>
        {PRESETS.filter((p) => p.category === shown).map((p) => (
          <Pressable key={p.id} accessibilityLabel={`Preset ${p.name}`} accessibilityState={{ selected: synth.preset === p.id }} onPress={() => onPick(p.id)} style={[h.row, synth.preset === p.id && h.rowOn]}>
            <Txt style={[h.rowName, synth.preset === p.id && { color: C.accent }]}>{p.name}</Txt>
            <Txt numberOfLines={1} style={h.rowHint}>{p.hint}</Txt>
          </Pressable>
        ))}
      </View>
    </Panel>
  );
}

/** Previous or next preset of the whole library, loaded into the track and played once. */
export function stepPreset(track: Track, synth: SynthSettings, dir: 1 | -1, hear: (s: SynthSettings, pitch: number) => void) {
  const i = PRESETS.findIndex((p) => p.id === synth.preset);
  const next = PRESETS[i < 0 ? (dir > 0 ? 0 : PRESETS.length - 1) : (i + dir + PRESETS.length) % PRESETS.length];
  updateProject((p) => mapTrack(p, track.id, (t) => applyPreset(t, next)));
  hear(next.synth, next.note);
}

/** The track's sound effects as a small rack: they belong to the track, not to the instrument. */
export function FxRack({ fx, setFx }: { fx: { drive: number; reverb: number; delay: number; pump: number }; setFx: (patch: TrackFx) => void }) {
  return (
    <Panel title="FX RACK">
      <KnobRow>
        <Knob label="Drive" value={fx.drive} min={0} max={1} reset={0} format={PCT} onChange={(v) => setFx({ drive: Math.round(v * 100) / 100 })} />
        <Knob label="Reverb" value={fx.reverb} min={0} max={1} reset={0} format={PCT} onChange={(v) => setFx({ reverb: Math.round(v * 100) / 100 })} />
        <Knob label="Delay" value={fx.delay} min={0} max={1} reset={0} format={PCT} onChange={(v) => setFx({ delay: Math.round(v * 100) / 100 })} />
        <Knob label="Pump" value={fx.pump} min={0} max={1} reset={0} format={PCT} onChange={(v) => setFx({ pump: Math.round(v * 100) / 100 })} />
      </KnobRow>
      <Txt style={h.hint}>Pump duckt die Spur auf jedem Beat wie ein Sidechain zur Kick. Doppeltippen setzt einen Regler zurück.</Txt>
    </Panel>
  );
}

/** The keyboard to try the sound. */
export function KeyboardPanel({ low, onLow, onKey }: { low: number; onLow: (v: number) => void; onKey: (pitch: number) => void }) {
  return (
    <Panel title="KEYBOARD">
      <Keys low={low} onLow={onLow} color={C.accent} onKey={onKey} />
    </Panel>
  );
}

/** A link to the place where the instrument is chosen (the track sheet), so the synth page itself carries no sampler or drum tiles. */
export function ChangeInstrument() {
  return (
    <Pressable accessibilityLabel="Instrument wechseln" onPress={() => setState({ panel: 'track' })} style={h.change}>
      <Txt style={h.changeText}>Instrument wechseln …</Txt>
    </Pressable>
  );
}

const h = StyleSheet.create({
  wrap: { marginBottom: 10, gap: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { ...cond(700), fontSize: 18, letterSpacing: 2.4, color: C.text, lineHeight: 20 },
  kind: { ...cond(600), fontSize: 10, letterSpacing: 4, color: C.muted, lineHeight: 12 },
  bar: { flex: 1, minWidth: 180, flexDirection: 'row', alignItems: 'center', backgroundColor: '#121215', borderWidth: 1, borderColor: '#24242b', borderRadius: 12 },
  step: { paddingHorizontal: 14, paddingVertical: 10 },
  stepText: { color: C.muted, fontSize: 22, lineHeight: 24 },
  name: { flex: 1, alignItems: 'center', paddingVertical: 7 },
  nameText: { ...cond(700), fontSize: 17, letterSpacing: 1.6, color: C.text, textTransform: 'uppercase' },
  nameSub: { ...cond(600), fontSize: 10, letterSpacing: 2.4, color: C.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  list: { marginTop: 10, borderWidth: 1, borderColor: '#24242b', borderRadius: 10, overflow: 'hidden' },
  row: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#24242b' },
  rowOn: { backgroundColor: 'rgba(198,255,61,0.08)' },
  rowName: { ...cond(700), fontSize: 15, letterSpacing: 1, color: C.text },
  rowHint: { color: C.muted, fontSize: 11.5, marginTop: 2, ...mono() },
  hint: { color: C.muted, fontSize: 11.5, lineHeight: 16, marginTop: 6 },
  change: { alignSelf: 'flex-start', paddingVertical: 6 },
  changeText: { ...cond(600), fontSize: 12, letterSpacing: 1.6, color: C.muted, textDecorationLine: 'underline' },
});
