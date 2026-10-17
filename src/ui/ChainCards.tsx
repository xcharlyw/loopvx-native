import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ARP_RATES, rateLabel, SEQ_STEPS } from '../audio/notefx';
import { ARP_PRESETS, arpPresetById, SEQ_PRESETS, seqPresetById } from '../audio/notefxPresets';
import { applyPreset, presetById, PRESETS } from '../audio/presets';
import { C, font, mono } from '../constants/theme';
import { applyArpPreset, applySeqPreset, arpOf, seqOf, setArp, setSeq, setSeqStep, stepId } from '../lib/notefxActions';
import { mapTrack, trackSynth } from '../lib/project';
import { updateProject } from '../lib/store';
import { openWindow } from '../lib/windowActions';
import type { ArpPattern, OscWave, Track } from '../types';
import { Txt } from './kit';
import { PluginFrame, SKIN } from './skin';
import { Knob, KnobRow } from './synth/Knob';
import { TableScope, WaveScope } from './synth/Scopes';
import { SOURCES, sourceKey } from './synth/SynthPage';
import { SynthSettingsFields } from './synth/synthFields';

// The compact cards of the device chain (Ableton's device view): the MIDI effects and the instrument sit in front of the
// audio effects, side by side, each with a slim title bar (power LED, name, fold) and small knobs. "⤢" opens the full editor.

export const CARD_W_SYNTH = 330;
export const CARD_W_FX = 250;
const KS = 36; // knob size
const KW = 50; // knob cell width
const PCT = (v: number) => `${Math.round(v * 100)}%`;
const PATTERNS: { id: ArpPattern; label: string }[] = [
  { id: 'up', label: 'Auf' },
  { id: 'down', label: 'Ab' },
  { id: 'updown', label: 'Auf-Ab' },
  { id: 'random', label: 'Zufall' },
  { id: 'played', label: 'Gespielt' },
  { id: 'chord', label: 'Akkord' },
];

/** The slim title bar and body every chain card shares. */
export function CardFrame({ title, on, onToggle, folded, onFold, right, color = C.accent, children, style }: { title: string; on?: boolean; onToggle?: () => void; folded?: boolean; onFold?: () => void; right?: ReactNode; color?: string; children?: ReactNode; style?: object }) {
  return (
    <View style={[on === false && { opacity: 0.6 }, style]}>
      <PluginFrame style={s.card} radius={4}>
        <View style={s.head}>
          {onToggle && (
            <Pressable onPress={onToggle} accessibilityLabel={`${title} ${on ? 'ausschalten' : 'einschalten'}`} hitSlop={8} style={s.ledBox}>
              <View style={[s.led, on && { backgroundColor: color, borderColor: color, shadowColor: color, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } }]} />
            </Pressable>
          )}
          <Pressable onPress={onFold} disabled={!onFold} accessibilityLabel={`${title} ${folded ? 'ausklappen' : 'einklappen'}`} style={{ flex: 1 }}>
            <Txt numberOfLines={1} style={[s.title, { color }]}>
              {title}
            </Txt>
          </Pressable>
          {right}
        </View>
        {!folded && children}
      </PluginFrame>
    </View>
  );
}

const Tiny = ({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel: string }) => (
  <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress} hitSlop={6} style={s.tiny}>
    <Txt style={s.tinyText}>{label}</Txt>
  </Pressable>
);

/** ◀ name ▶ on one slim line. */
function Switcher({ name, sub, onStep, label }: { name: string; sub?: string; onStep: (d: 1 | -1) => void; label: string }) {
  return (
    <View style={s.switcher}>
      <Tiny label="◀" onPress={() => onStep(-1)} accessibilityLabel={`${label} vorheriges`} />
      <View style={s.nameBox}>
        <Txt numberOfLines={1} style={s.nameText}>
          {name}
        </Txt>
      </View>
      <Tiny label="▶" onPress={() => onStep(1)} accessibilityLabel={`${label} nächstes`} />
      {!!sub && <View />}
    </View>
  );
}

const Chip2 = ({ label, onPress, on, accessibilityLabel }: { label: string; onPress: () => void; on?: boolean; accessibilityLabel: string }) => (
  <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress} style={[s.chip, on && s.chipOn]}>
    <Txt style={[s.chipText, on && { color: C.accentInk }]}>{label}</Txt>
  </Pressable>
);

const expandBtn = (kind: 'instrument' | 'notefx') => <Tiny label="⤢" accessibilityLabel={kind === 'instrument' ? 'Synth groß öffnen' : 'MIDI-Effekte groß öffnen'} onPress={() => openWindow(kind)} />;

// ---------------------------------------------------------------- arpeggiator

export function ArpCard({ track, folded, onFold }: { track: Track; folded: boolean; onFold: () => void }) {
  const id = track.id;
  const a = arpOf(id);
  const cur = arpPresetById(a.preset);
  const cycle = <T,>(list: T[], v: T, d: number) => list[(list.indexOf(v) + d + list.length) % list.length];
  return (
    <CardFrame title="ARPEGGIATOR" on={a.on} onToggle={() => setArp(id, { on: !a.on }, true)} folded={folded} onFold={onFold} right={expandBtn('notefx')} style={{ width: CARD_W_FX }}>
      <Switcher name={cur?.name ?? 'Eigene Einstellung'} onStep={(d) => applyArpPreset(id, stepId(ARP_PRESETS, a.preset, d))} label="Arp-Preset" />
      <View style={s.chipRow}>
        <Chip2 label={PATTERNS.find((p) => p.id === a.pattern)!.label} accessibilityLabel="Arp-Muster wechseln" onPress={() => setArp(id, { pattern: cycle(PATTERNS, PATTERNS.find((p) => p.id === a.pattern)!, 1).id, preset: undefined }, true)} on />
        <Chip2 label={rateLabel(a.rate)} accessibilityLabel="Arp-Rate wechseln" onPress={() => setArp(id, { rate: cycle(ARP_RATES, a.rate, 1), preset: undefined }, true)} on />
      </View>
      <KnobRow>
        <Knob label="Okt" size={KS} width={KW} value={a.octaves} min={1} max={4} step={1} reset={1} format={(v) => String(Math.round(v))} onChange={(v) => setArp(id, { octaves: v, preset: undefined })} />
        <Knob label="Gate" size={KS} width={KW} value={a.gate} min={0.05} max={1} reset={0.6} format={PCT} onChange={(v) => setArp(id, { gate: Math.round(v * 100) / 100, preset: undefined })} />
        <Knob label="Swing" size={KS} width={KW} value={a.swing} min={0} max={0.5} reset={0} format={(v) => PCT(v * 2)} onChange={(v) => setArp(id, { swing: Math.round(v * 100) / 100, preset: undefined })} />
      </KnobRow>
    </CardFrame>
  );
}

// ---------------------------------------------------------------- step sequencer

export function SeqCard({ track, folded, onFold }: { track: Track; folded: boolean; onFold: () => void }) {
  const id = track.id;
  const q = seqOf(id);
  const cur = seqPresetById(q.preset);
  return (
    <CardFrame title="SEQUENCER" color="#3dd6ff" on={q.on} onToggle={() => setSeq(id, { on: !q.on }, true)} folded={folded} onFold={onFold} right={expandBtn('notefx')} style={{ width: CARD_W_FX }}>
      <Switcher name={cur?.name ?? 'Eigenes Muster'} onStep={(d) => applySeqPreset(id, stepId(SEQ_PRESETS, q.preset, d))} label="Sequencer-Preset" />
      <View style={s.grid}>
        {q.steps.slice(0, SEQ_STEPS).map((st, i) => {
          const h = Math.round(((Math.max(-12, Math.min(24, st.semi)) + 12) / 36) * 22) + 4;
          return (
            <Pressable key={i} accessibilityLabel={`Schritt ${i + 1} ${st.on ? 'an' : 'aus'}`} onPress={() => setSeqStep(id, i, { on: !st.on })} style={[s.cell, i % 4 === 0 && { borderLeftColor: C.dim }, i >= q.length && { opacity: 0.3 }]}>
              <View style={s.bar}>{st.on && <View style={{ height: h, backgroundColor: st.accent ? '#fff' : '#3dd6ff', borderRadius: 2 }} />}</View>
            </Pressable>
          );
        })}
      </View>
      <View style={s.chipRow}>
        <Chip2 label={rateLabel(q.rate)} accessibilityLabel="Sequencer-Rate wechseln" onPress={() => setSeq(id, { rate: ARP_RATES[(ARP_RATES.indexOf(q.rate) + 1) % ARP_RATES.length], preset: undefined }, true)} on />
      </View>
      <KnobRow>
        <Knob label="Länge" size={KS} width={KW} color="#3dd6ff" value={q.length} min={1} max={16} step={1} reset={16} format={(v) => String(Math.round(v))} onChange={(v) => setSeq(id, { length: v, preset: undefined })} />
        <Knob label="Gate" size={KS} width={KW} color="#3dd6ff" value={q.gate} min={0.05} max={1} reset={0.6} format={PCT} onChange={(v) => setSeq(id, { gate: Math.round(v * 100) / 100, preset: undefined })} />
        <Knob label="Swing" size={KS} width={KW} color="#3dd6ff" value={q.swing} min={0} max={0.5} reset={0} format={(v) => PCT(v * 2)} onChange={(v) => setSeq(id, { swing: Math.round(v * 100) / 100, preset: undefined })} />
      </KnobRow>
    </CardFrame>
  );
}

// ---------------------------------------------------------------- instrument

export function InstrumentCard({ track, folded, onFold }: { track: Track; folded: boolean; onFold: () => void }) {
  const id = track.id;
  const synth = trackSynth(track);
  const preset = presetById(synth.preset);
  const isOsc = ['sawtooth', 'square', 'sine', 'triangle'].includes(synth.wave);
  const name = preset ? preset.name : synth.wave === 'sample' ? 'Sampler' : synth.wave === 'kick' ? 'Synth-Kick' : synth.wave === 'noise' ? 'Noise / Hat' : synth.wave === 'kit909' ? '909 Kit' : track.synth ? 'Eigener Sound' : 'Standard-Synth';
  const stepPreset = (d: 1 | -1) => {
    const next = PRESETS[(PRESETS.findIndex((p) => p.id === synth.preset) + d + PRESETS.length) % PRESETS.length];
    updateProject((p) => mapTrack(p, id, (t) => applyPreset(t, next)));
  };
  const set = (patch: Partial<typeof synth>) => updateProject((p) => mapTrack(p, id, (t) => ({ ...t, synth: { ...trackSynth(t), ...patch } })), { merge: true });
  const key = sourceKey(synth.tableA, synth.wave as OscWave);
  const stepSource = (d: number) => {
    const next = SOURCES[(SOURCES.findIndex((x) => x.key === key) + d + SOURCES.length) % SOURCES.length].key;
    if (next.startsWith('w:')) set({ wave: next.slice(2) as OscWave, tableA: undefined, posA: undefined });
    else set({ tableA: next.slice(2), posA: synth.posA ?? 0, ...(!synth.tableA && synth.cutoff < 6000 ? { cutoff: 9000 } : {}) });
  };
  return (
    <CardFrame title={isOsc ? 'SYNTH' : 'INSTRUMENT'} folded={folded} onFold={onFold} right={expandBtn('instrument')} style={{ width: CARD_W_SYNTH }}>
      <Switcher name={name} onStep={stepPreset} label="Sound" />
      {isOsc ? (
        <>
          <View style={s.srcRow}>
            <Tiny label="◀" onPress={() => stepSource(-1)} accessibilityLabel="Wellenform A vorherige" />
            <View style={[s.nameBox, { flex: 1 }]}>
              <Txt numberOfLines={1} style={[s.nameText, { color: C.text }]}>
                {SOURCES.find((x) => x.key === key)?.label}
              </Txt>
            </View>
            <Tiny label="▶" onPress={() => stepSource(1)} accessibilityLabel="Wellenform A nächste" />
          </View>
          <View style={{ marginTop: 6 }}>{synth.tableA ? <TableScope table={synth.tableA} pos={synth.posA ?? 0} width={CARD_W_SYNTH - 22} height={54} /> : <WaveScope wave={synth.wave as OscWave} unison={synth.unison} spread={synth.spread} width={CARD_W_SYNTH - 22} height={54} />}</View>
          <SynthSettingsFields synth={synth} set={set} size={KS} width={KW} />
        </>
      ) : (
        <Txt style={s.note}>{synth.wave === 'sample' ? 'Dein Sample, chromatisch gespielt.' : synth.wave === 'kit909' ? 'Drum-Kit auf den Drum-Rack-Noten.' : 'Synthetischer Drum-Klang.'} Mit ⤢ öffnest du den großen Editor.</Txt>
      )}
    </CardFrame>
  );
}

const s = StyleSheet.create({
  card: { padding: 8, paddingTop: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24, marginBottom: 8, marginHorizontal: -8, paddingHorizontal: 8, backgroundColor: '#0f0f11', borderBottomWidth: 1, borderBottomColor: '#000' },
  ledBox: { paddingVertical: 4 },
  led: { width: 11, height: 11, borderRadius: 2, borderWidth: 1, borderColor: '#4a4a52', backgroundColor: '#1a1a1e' },
  title: { ...font(700), fontSize: 10, letterSpacing: 1.4 },
  tiny: { minWidth: 24, height: 22, borderRadius: 5, borderWidth: 1, borderColor: '#3a3a42', backgroundColor: '#1c1c21', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tinyText: { fontSize: 11, color: C.text },
  switcher: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  srcRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  nameBox: { flex: 1, height: 24, borderRadius: 5, borderWidth: 1, borderColor: SKIN.lcdEdge, backgroundColor: SKIN.lcd, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  nameText: { ...mono(500), fontSize: 11, color: SKIN.lcdText },
  chipRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  chip: { paddingHorizontal: 10, height: 22, borderRadius: 11, borderWidth: 1, borderColor: '#3a3a42', backgroundColor: '#1c1c21', alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { fontSize: 11, ...font(600), color: C.text },
  grid: { flexDirection: 'row', gap: 1, marginTop: 6 },
  cell: { flex: 1, height: 34, borderLeftWidth: 1, borderLeftColor: '#26262b', backgroundColor: '#0d0d10', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 2, borderRadius: 2 },
  bar: { width: '70%', justifyContent: 'flex-end', flex: 1 },
  note: { color: C.muted, fontSize: 11.5, lineHeight: 16, marginTop: 8 },
});
