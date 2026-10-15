import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { applyNoteFx, ARP_RATES, DEFAULT_ARP, DEFAULT_SEQ, rateLabel, SEQ_STEPS } from '../audio/notefx';
import { ARP_PRESETS, arpPresetById, SEQ_PRESETS, seqPresetById } from '../audio/notefxPresets';
import { C, font } from '../constants/theme';
import { noteName } from '../lib/midi';
import { trackKind } from '../lib/project';
import { useStore } from '../lib/store';
import { applyArpPreset, applySeqPreset, setArp as setArpFx, setSeq as setSeqFx, setSeqStep, stepId } from '../lib/notefxActions';
import type { ArpPattern, ArpSettings, Note, SeqSettings, SeqStep } from '../types';
import { Btn, Chip, Txt } from './kit';
import { Sheet } from './Sheet';
import { Knob, KnobRow } from './synth/Knob';
import { Tabs } from './synth/Tabs';
import { Panel } from './synth/SynthPage';

// The track's MIDI effects: an arpeggiator and a step sequencer. They rewrite the notes while they play (the clips stay as
// drawn), so a held chord becomes a run, or a single bass note a whole pattern. Only one of the two is on at a time.

type Tab = 'arp' | 'seq';
const PATTERNS: { id: ArpPattern; label: string }[] = [
  { id: 'up', label: 'Auf' },
  { id: 'down', label: 'Ab' },
  { id: 'updown', label: 'Auf-Ab' },
  { id: 'random', label: 'Zufall' },
  { id: 'played', label: 'Gespielt' },
  { id: 'chord', label: 'Akkord' },
];
const PCT = (v: number) => `${Math.round(v * 100)} %`;
const DEMO_CHORD: Note[] = [48, 52, 55].map((pitch) => ({ pitch, start: 0, length: 1, velocity: 0.85 }));
const DEMO_ROOT: Note[] = [{ pitch: 36, start: 0, length: 1, velocity: 0.9 }];

/** One bar of what the effect plays for a demo chord (arp) or a root note (sequencer), as little bars. */
function Preview({ notes, width, color = C.accent }: { notes: Note[]; width: number; color?: string }) {
  const height = 70;
  const lo = Math.min(...notes.map((n) => n.pitch), 48);
  const hi = Math.max(...notes.map((n) => n.pitch), lo + 12);
  const y = (p: number) => 6 + (1 - (p - lo) / Math.max(1, hi - lo)) * (height - 16);
  return (
    <View style={{ width, height, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: '#09090b' }}>
      <Svg width={width} height={height}>
        {[0, 0.25, 0.5, 0.75].map((b) => (
          <Line key={b} x1={b * width} y1={0} x2={b * width} y2={height} stroke="#17171b" strokeWidth={1} />
        ))}
        {notes.map((n, i) => (
          <Rect key={i} x={n.start * width + 1} y={y(n.pitch)} width={Math.max(2, n.length * width - 1)} height={6} rx={2} fill={color} opacity={0.35 + 0.65 * n.velocity} />
        ))}
      </Svg>
    </View>
  );
}

/** ◀ preset name ▶ and a list to pick from. */
function PresetBar({ name, hint, list, onStep, onPick }: { name: string; hint?: string; list: { id: string; name: string; hint: string }[]; onStep: (d: 1 | -1) => void; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <View style={s.switcher}>
        <Btn small accessibilityLabel="Vorheriges Preset" onPress={() => onStep(-1)}>
          ◀
        </Btn>
        <Pressable accessibilityLabel="Preset-Liste" onPress={() => setOpen((v) => !v)} style={s.nameBox}>
          <Txt numberOfLines={1} style={s.name}>
            {name}
          </Txt>
          {!!hint && (
            <Txt numberOfLines={1} style={s.hint}>
              {hint}
            </Txt>
          )}
        </Pressable>
        <Btn small accessibilityLabel="Nächstes Preset" onPress={() => onStep(1)}>
          ▶
        </Btn>
      </View>
      {open && (
        <View style={s.list}>
          {list.map((p) => (
            <Pressable key={p.id} accessibilityLabel={`Preset ${p.name}`} onPress={() => (onPick(p.id), setOpen(false))} style={s.row}>
              <Txt style={s.rowName}>{p.name}</Txt>
              <Txt numberOfLines={1} style={s.hint}>
                {p.hint}
              </Txt>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );
}

export function NoteFxPanel() {
  const track = useStore((st) => st.project.tracks.find((t) => t.id === st.selectedTrackId));
  const [tab, setTab] = useState<Tab>('arp');
  const [width, setWidth] = useState(330);
  const [selected, setSelected] = useState(0);
  if (!track || trackKind(track) !== 'midi') {
    return (
      <Sheet title="MIDI-Effekte">
        <Txt style={s.note}>Wähle eine MIDI-Spur aus: Arpeggiator und Step-Sequencer arbeiten mit ihren Noten.</Txt>
      </Sheet>
    );
  }
  const trackId = track.id;
  const arp: ArpSettings = { ...DEFAULT_ARP, ...track.arp };
  const seq: SeqSettings = { ...DEFAULT_SEQ, ...track.seq };
  const inner = Math.max(200, width - 22);
  const setArp = (patch: Partial<ArpSettings>, record = false) => setArpFx(trackId, patch, record);
  const setSeq = (patch: Partial<SeqSettings>, record = false) => setSeqFx(trackId, patch, record);
  const setStep = (i: number, patch: Partial<SeqStep>) => setSeqStep(trackId, i, patch);
  const arpPreset = (id: string) => applyArpPreset(trackId, id);
  const seqPreset = (id: string) => applySeqPreset(trackId, id);
  const stepList = stepId;
  const curArp = arpPresetById(arp.preset);
  const curSeq = seqPresetById(seq.preset);
  const step = seq.steps[selected] ?? seq.steps[0];
  const arpOut = applyNoteFx(DEMO_CHORD, { arp: { ...arp, on: true } }, 1);
  const seqOut = applyNoteFx(DEMO_ROOT, { seq: { ...seq, on: true } }, 1);

  return (
    <Sheet title={`MIDI-Effekte · ${track.name}`}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <Tabs
          tabs={[
            { id: 'arp' as Tab, label: arp.on ? 'ARPEGGIATOR ●' : 'ARPEGGIATOR' },
            { id: 'seq' as Tab, label: seq.on ? 'SEQUENCER ●' : 'SEQUENCER' },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'arp' && (
          <Panel title="ARPEGGIATOR" on={arp.on} onToggle={() => setArp({ on: !arp.on }, true)}>
            <PresetBar name={curArp?.name ?? 'Eigene Einstellung'} hint={curArp?.hint} list={ARP_PRESETS} onStep={(d) => arpPreset(stepList(ARP_PRESETS, arp.preset, d))} onPick={arpPreset} />
            <View style={{ marginTop: 10 }}>
              <Preview notes={arpOut} width={inner} />
            </View>
            <Txt style={s.cap}>MUSTER</Txt>
            <View style={s.chips}>
              {PATTERNS.map((p) => (
                <Chip key={p.id} variant={arp.pattern === p.id ? 'on' : 'ghost'} onPress={() => setArp({ pattern: p.id, preset: undefined })}>
                  {p.label}
                </Chip>
              ))}
            </View>
            <Txt style={s.cap}>RATE</Txt>
            <View style={s.chips}>
              {ARP_RATES.map((r) => (
                <Chip key={r} variant={arp.rate === r ? 'on' : 'ghost'} onPress={() => setArp({ rate: r, preset: undefined })}>
                  {rateLabel(r)}
                </Chip>
              ))}
            </View>
            <KnobRow>
              <Knob label="Oktaven" size={52} width={64} value={arp.octaves} min={1} max={4} step={1} reset={1} format={(v) => String(Math.round(v))} onChange={(v) => setArp({ octaves: v, preset: undefined })} />
              <Knob label="Gate" size={52} width={64} value={arp.gate} min={0.05} max={1} reset={0.6} format={PCT} onChange={(v) => setArp({ gate: Math.round(v * 100) / 100, preset: undefined })} />
              <Knob label="Swing" size={52} width={64} value={arp.swing} min={0} max={0.5} reset={0} format={(v) => PCT(v * 2)} onChange={(v) => setArp({ swing: Math.round(v * 100) / 100, preset: undefined })} />
            </KnobRow>
            <Txt style={s.note}>Der Arpeggiator spielt die Noten, die gerade gehalten werden, nacheinander. Zeichne im Piano Roll einen Akkord über mehrere Takte: der Lauf entsteht beim Abspielen, die Noten im Clip bleiben unverändert. Er und der Sequencer schließen sich aus (nur einer ist an).</Txt>
          </Panel>
        )}

        {tab === 'seq' && (
          <Panel title="STEP-SEQUENCER" on={seq.on} onToggle={() => setSeq({ on: !seq.on }, true)} color="#3dd6ff">
            <PresetBar name={curSeq?.name ?? 'Eigenes Muster'} hint={curSeq?.hint} list={SEQ_PRESETS} onStep={(d) => seqPreset(stepList(SEQ_PRESETS, seq.preset, d))} onPick={seqPreset} />
            <View style={s.grid}>
              {seq.steps.slice(0, SEQ_STEPS).map((st, i) => {
                const inLoop = i < seq.length;
                const h = Math.round(((Math.max(-12, Math.min(24, st.semi)) + 12) / 36) * 34) + 8;
                return (
                  <Pressable key={i} accessibilityLabel={`Schritt ${i + 1} ${st.on ? 'an' : 'aus'}`} accessibilityState={{ selected: selected === i }} onPress={() => setSelected(i)} style={[s.cell, i % 4 === 0 && s.cellBeat, selected === i && s.cellSel, !inLoop && { opacity: 0.3 }]}>
                    <View style={s.bar}>{st.on && <View style={{ height: h, backgroundColor: st.accent ? '#ffffff' : '#3dd6ff', borderRadius: 3 }} />}</View>
                    <Txt style={s.cellNo}>{i + 1}</Txt>
                  </Pressable>
                );
              })}
            </View>
            <View style={[s.chips, { alignItems: 'center' }]}>
              <Chip variant={step.on ? 'on' : 'ghost'} onPress={() => setStep(selected, { on: !step.on })} accessibilityLabel="Schritt an oder aus">
                {`Schritt ${selected + 1}: ${step.on ? 'an' : 'aus'}`}
              </Chip>
              <Chip variant={step.accent ? 'on' : 'ghost'} onPress={() => setStep(selected, { accent: !step.accent, on: true })} accessibilityLabel="Akzent">
                Akzent
              </Chip>
              <Knob label="Ton" size={46} width={62} color="#3dd6ff" value={step.semi} min={-24} max={24} step={1} reset={0} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} · ${noteName(36 + Math.round(v))}`} onChange={(v) => setStep(selected, { semi: Math.round(v), on: true })} />
            </View>
            <Txt style={s.cap}>RATE</Txt>
            <View style={s.chips}>
              {ARP_RATES.map((r) => (
                <Chip key={r} variant={seq.rate === r ? 'on' : 'ghost'} onPress={() => setSeq({ rate: r, preset: undefined })}>
                  {rateLabel(r)}
                </Chip>
              ))}
            </View>
            <KnobRow>
              <Knob label="Länge" size={52} width={64} color="#3dd6ff" value={seq.length} min={1} max={16} step={1} reset={16} format={(v) => `${Math.round(v)} Schr.`} onChange={(v) => setSeq({ length: v, preset: undefined })} />
              <Knob label="Gate" size={52} width={64} color="#3dd6ff" value={seq.gate} min={0.05} max={1} reset={0.6} format={PCT} onChange={(v) => setSeq({ gate: Math.round(v * 100) / 100, preset: undefined })} />
              <Knob label="Swing" size={52} width={64} color="#3dd6ff" value={seq.swing} min={0} max={0.5} reset={0} format={(v) => PCT(v * 2)} onChange={(v) => setSeq({ swing: Math.round(v * 100) / 100, preset: undefined })} />
            </KnobRow>
            <Txt style={s.cap}>SO KLINGT ES AUF EINEM TIEFEN C</Txt>
            <View style={{ marginTop: 6 }}>
              <Preview notes={seqOut} width={inner} color="#3dd6ff" />
            </View>
            <Txt style={s.note}>Jede gehaltene Note spielt das Muster, versetzt auf ihren Ton. Zeichne also nur lange Grundtöne (zum Beispiel einen Takt C1) und wähle ein Preset: aus einer Note wird die ganze Bass-Linie. Der Ton-Regler stellt die Halbtöne über dem Grundton ein, ein Akzent ist lauter.</Txt>
          </Panel>
        )}
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 10 },
  cap: { ...font(700), fontSize: 10, letterSpacing: 1.2, color: C.muted, marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  hint: { color: C.dim, fontSize: 11 },
  switcher: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameBox: { flex: 1, backgroundColor: '#111114', borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12, alignItems: 'center' },
  name: { ...font(700), fontSize: 14, color: C.accent },
  list: { marginTop: 8, borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: 'hidden' },
  row: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  rowName: { fontSize: 13, ...font(600) },
  grid: { flexDirection: 'row', gap: 2, marginTop: 10 },
  cell: { flex: 1, alignItems: 'center', backgroundColor: '#111114', borderWidth: 1, borderColor: C.line, borderRadius: 4, paddingVertical: 4 },
  cellBeat: { borderLeftColor: C.dim },
  cellSel: { borderColor: '#3dd6ff', backgroundColor: '#12222a' },
  bar: { height: 44, width: '60%', justifyContent: 'flex-end' },
  cellNo: { fontSize: 8.5, color: C.dim, marginTop: 2 },
});
