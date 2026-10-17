import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { applyPreset, PRESET_CATEGORIES, PRESETS, presetById, INSTRUMENT_KINDS, instrumentKind, type PresetCategory } from '../../audio/presets';
import { C, cond, mono } from '../../constants/theme';
import { mapTrack } from '../../lib/project';
import { setState, updateProject } from '../../lib/store';
import type { SynthSettings, Track, TrackFx } from '../../types';
import { Chip, Txt } from '../kit';
import { PluginFrame, SKIN } from '../skin';
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

/**
 * The plugin's top bar: the LOOPVX mark with the instrument's name, the preset display in the middle (‹ › step, the name opens the
 * browser), a play button to hear the sound, and the level knob.
 */
export function Header({ track, synth, name, sub, onStep, browsable, onLevel, onTitle, onPlay }: { track: Track; synth: SynthSettings; name: string; sub: string; onStep?: (dir: 1 | -1) => void; browsable?: ReactNode; onLevel: (db: number) => void; onTitle?: () => void; onPlay?: () => void }) {
  // Narrow (a phone): the mark, play and level on one line, the preset display under them at full width.
  const [width, setWidth] = useState(600);
  const narrow = width < 520;
  const lcdBox = (
    <View style={[h.lcd, narrow && h.lcdNarrow]}>
      {onStep && (
        <Pressable accessibilityLabel="Vorheriges Preset" hitSlop={8} onPress={() => onStep(-1)} style={h.step}>
          <Txt style={h.stepText}>◀</Txt>
        </Pressable>
      )}
      <Pressable accessibilityLabel="Preset-Browser" disabled={!onTitle} onPress={onTitle} style={h.name}>
        <Txt numberOfLines={1} style={h.nameText}>
          {name}
        </Txt>
        <Txt numberOfLines={1} style={h.nameSub}>{`${sub} · ${track.name}`.toUpperCase()}</Txt>
      </Pressable>
      {onTitle && (
        <Pressable accessibilityLabel="Presets durchsuchen" hitSlop={6} onPress={onTitle} style={h.step}>
          <Txt style={h.stepText}>☰</Txt>
        </Pressable>
      )}
      {onStep && (
        <Pressable accessibilityLabel="Nächstes Preset" hitSlop={8} onPress={() => onStep(1)} style={h.step}>
          <Txt style={h.stepText}>▶</Txt>
        </Pressable>
      )}
    </View>
  );
  return (
    <View style={h.wrap}>
      <PluginFrame style={h.frame} radius={10}>
        <View style={[h.top, narrow && h.topNarrow]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          <View style={[h.brand, narrow && { flex: 1 }]}>
            <Svg width={28} height={28} viewBox="0 0 36 36">
              <Path d="M6,18 C10,6 14,6 18,18 S26,30 30,18" fill="none" stroke={C.accent} strokeWidth={2.8} strokeLinecap="round" />
            </Svg>
            <View>
              <Txt style={h.logo}>LOOPVX</Txt>
              <Txt style={h.kind}>{INSTRUMENT_KINDS.find((k) => k.kind === instrumentKind(synth.wave))?.title.toUpperCase()}</Txt>
            </View>
          </View>
          {!narrow && lcdBox}
          {onPlay && (
            <Pressable accessibilityLabel="Anhören" onPress={onPlay} style={h.play}>
              <Svg width={12} height={12} viewBox="0 0 12 12">
                <Path d="M2,1 L11,6 L2,11 Z" fill={C.accentInk} />
              </Svg>
            </Pressable>
          )}
          <Knob label="Level" size={42} width={54} value={synth.gainDb ?? 0} min={-24} max={6} step={0.5} reset={0} format={DB} onChange={onLevel} />
          {narrow && lcdBox}
        </View>
      </PluginFrame>
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
  wrap: { gap: 8 },
  frame: { paddingHorizontal: 12, paddingVertical: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  topNarrow: { rowGap: 8 },
  lcdNarrow: { flexBasis: '100%', flexGrow: 1 },
  lcd: { flex: 1, minWidth: 190, flexDirection: 'row', alignItems: 'center', height: 46, backgroundColor: SKIN.lcd, borderWidth: 1, borderColor: SKIN.lcdEdge, borderRadius: 6 },
  play: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { ...cond(700), fontSize: 18, letterSpacing: 2.4, color: C.text, lineHeight: 20 },
  kind: { ...cond(600), fontSize: 10, letterSpacing: 4, color: C.muted, lineHeight: 12 },
  step: { paddingHorizontal: 11, height: 44, justifyContent: 'center' },
  stepText: { color: '#6f8a3a', fontSize: 11 },
  name: { flex: 1, alignItems: 'center', justifyContent: 'center', minWidth: 0 },
  nameText: { ...mono(500), fontSize: 15, letterSpacing: 1, color: SKIN.lcdText, textTransform: 'uppercase', textShadowColor: 'rgba(198,255,61,0.55)', textShadowRadius: 8 },
  nameSub: { ...mono(), fontSize: 9, letterSpacing: 1.2, color: '#6f8a3a', marginTop: 1 },
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
