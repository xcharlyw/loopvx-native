import { type ReactNode, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MAX_MODS, MOD_SOURCES, MOD_TARGETS } from '../../audio/synth';
import { TABLES, tableById } from '../../audio/wavetables';
import { C, cond, mono } from '../../constants/theme';
import { LFO_RATES, lfoRateLabel, modRings, rateAt, rateIndex, synthLayout } from '../../lib/synthView';
import type { ModSlot, ModSource, ModTarget, OscWave, SynthSettings } from '../../types';
import { useDrag, web } from '../drag';
import { Chip, Txt } from '../kit';
import { PluginFrame } from '../skin';
import { Knob as BaseKnob, KnobRow } from './Knob';
import { EnvScope, FilterScope, LfoScope, TableScope, WaveGlyph, WaveScope } from './Scopes';

// The synth page, built like the main screen of a wavetable synth (Serum, Vital) but with only the knobs that matter. In a wide window
// everything is one screen: OSC A, OSC B, SUB/NOISE and the FILTER side by side, below them the modulation sources (ENV 1 = amp,
// ENV 2, LFO 1, LFO 2) and the matrix. Modulated knobs (cutoff, resonance, wavetable positions) carry a white ring showing the sweep.
// Narrower windows use two columns, a phone three tabs.

/** Every knob of this page wears the plugin skin. */
const Knob = (p: React.ComponentProps<typeof BaseKnob>) => <BaseKnob skin="synth" size={48} width={60} {...p} />;
const WAVES: OscWave[] = ['sawtooth', 'square', 'triangle', 'sine'];
const WAVE_NAMES: Record<OscWave, string> = { sawtooth: 'Saw', square: 'Square', triangle: 'Triangle', sine: 'Sine' };
/** Everything an oscillator can play, in the order the arrows step through: the four basic waves, then the wavetables. */
export const SOURCES = [...WAVES.map((w) => ({ key: `w:${w}`, label: WAVE_NAMES[w] })), ...TABLES.map((t) => ({ key: `t:${t.id}`, label: t.label }))];
export const sourceKey = (table: string | undefined, wave: OscWave) => (table ? `t:${table}` : `w:${wave}`);

const PCT = (v: number) => `${Math.round(v * 100)} %`;
const CT = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} ct`;
const SIGNED = (v: number) => (v > 0 ? `+${Math.round(v)}` : String(Math.round(v)));
const HZ = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')} k` : `${Math.round(v)} Hz`);
const SECOND = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2).replace('.', ',')} s`);
const FILTERS: { type: NonNullable<SynthSettings['filterType']>; label: string }[] = [
  { type: 'lowpass', label: 'LP' },
  { type: 'highpass', label: 'HP' },
  { type: 'bandpass', label: 'BP' },
];
const ENV2 = { attack: 0.01, decay: 0.4, sustain: 0, release: 0.2 };
const SOURCE_NAMES: Record<ModSource, string> = { lfo1: 'LFO 1', lfo2: 'LFO 2', env2: 'ENV 2' };
const TARGET_NAMES: Record<ModTarget, string> = { cutoff: 'Cutoff', reso: 'Resonanz', pitch: 'Tonhöhe', posA: 'Wavetable A', posB: 'Wavetable B', level: 'Lautstärke', pan: 'Panorama' };
/** Panel padding + border on each side: what is left for a scope. */
const INSET = 26;
const GAP = 8;

type Tab = 'osc' | 'filter' | 'mod';
const TABS: { id: Tab; label: string }[] = [
  { id: 'osc', label: 'OSC' },
  { id: 'filter', label: 'FILTER' },
  { id: 'mod', label: 'MOD' },
];
type ModTab = 'env1' | 'env2' | 'lfo1' | 'lfo2';
const MOD_TABS: { id: ModTab; label: string }[] = [
  { id: 'env1', label: 'ENV 1' },
  { id: 'env2', label: 'ENV 2' },
  { id: 'lfo1', label: 'LFO 1' },
  { id: 'lfo2', label: 'LFO 2' },
];

interface Props {
  synth: SynthSettings;
  width: number;
  set: (patch: Partial<SynthSettings>) => void;
  setB: (patch: Partial<NonNullable<SynthSettings['oscB']>>) => void;
  setMods: (mods: ModSlot[]) => void;
  setMod: (i: number, patch: Partial<ModSlot>) => void;
}

/**
 * A section of a plugin: a panel with a lit top edge, a header band (LED, title in small caps, a control on the right) and the body.
 * Shared by the synth, sampler, drums and MIDI-effects panels.
 */
export function Panel({ title, on, onToggle, right, color = C.accent, children, style }: { title: string; on?: boolean; onToggle?: () => void; right?: ReactNode; color?: string; children: ReactNode; style?: object }) {
  return (
    <PluginFrame style={[s.panel, style]} radius={10}>
      <View style={s.head}>
        <Pressable onPress={onToggle} disabled={!onToggle} accessibilityLabel={onToggle ? `${title} ${on ? 'ausschalten' : 'einschalten'}` : undefined} style={s.titleRow} hitSlop={8}>
          <View style={[s.led, on !== false && { backgroundColor: color, shadowColor: color, shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } }]} />
          <Txt style={[s.title, on === false && { color: C.dim }]}>{title}</Txt>
        </Pressable>
        {right}
      </View>
      <View style={s.body}>{children}</View>
    </PluginFrame>
  );
}

/** One oscillator: ◀ name ▶ (tap the name for the list), the picture (a wave or the wavetable stack) and its knobs. */
function Osc({ title, table, pos, posRing, wave, unison, spread, width, height, on, onToggle, onPick, onPos, children, panelW }: { panelW?: number; title: string; table?: string; pos: number; posRing?: number; wave: OscWave; unison?: number; spread?: number; width: number; height: number; on?: boolean; onToggle?: () => void; onPick: (key: string) => void; onPos: (v: number) => void; children: ReactNode }) {
  const [list, setList] = useState(false);
  const key = sourceKey(table, wave);
  const step = (d: number) => onPick(SOURCES[(SOURCES.findIndex((x) => x.key === key) + d + SOURCES.length) % SOURCES.length].key);
  const dim = on === false;
  return (
    <Panel
      title={title}
      on={on}
      onToggle={onToggle}
      style={panelW ? { width: panelW } : undefined}
      right={
        <View style={s.picker}>
          <Pressable accessibilityLabel={`${title} vorherige Wellenform`} onPress={() => step(-1)} hitSlop={6} style={s.arrow}>
            <Txt style={s.arrowText}>◀</Txt>
          </Pressable>
          <Pressable accessibilityLabel={`${title} Wellenform wählen`} onPress={() => setList((v) => !v)} style={s.pickName}>
            <Txt numberOfLines={1} style={s.pickText}>
              {SOURCES.find((x) => x.key === key)?.label}
            </Txt>
          </Pressable>
          <Pressable accessibilityLabel={`${title} nächste Wellenform`} onPress={() => step(1)} hitSlop={6} style={s.arrow}>
            <Txt style={s.arrowText}>▶</Txt>
          </Pressable>
        </View>
      }
    >
      {list && (
        <View style={s.list}>
          {SOURCES.map((x) => (
            <Pressable key={x.key} accessibilityLabel={`Wellenform ${x.label}`} onPress={() => (onPick(x.key), setList(false))} style={[s.listItem, key === x.key && s.listOn]}>
              <Txt style={[s.listText, key === x.key && { color: C.accentInk }]}>{x.label}</Txt>
            </Pressable>
          ))}
        </View>
      )}
      <View style={dim && { opacity: 0.4 }}>{table ? <TableScope table={table} pos={pos} width={width} height={height} /> : <WaveScope wave={wave} unison={unison} spread={spread} width={width} height={height} />}</View>
      {table && (
        <Txt numberOfLines={1} style={s.hint}>
          {tableById(table)?.hint}
        </Txt>
      )}
      <KnobRow>
        {table && <Knob label="Pos" mod={posRing} value={pos} min={0} max={1} reset={0} format={PCT} onChange={(v) => onPos(Math.round(v * 64) / 64)} />}
        {children}
      </KnobRow>
    </Panel>
  );
}

/** The whole synth page. */
export function SynthPage({ synth, width, set, setB, setMods, setMod }: Props) {
  const layout = synthLayout(width);
  const [tab, setTab] = useState<Tab>('osc');
  const [modTab, setModTab] = useState<ModTab>('env1');
  const show = (id: Tab) => layout !== 'tabs' || tab === id;
  const rings = modRings(synth);
  const b = synth.oscB;
  const bOn = !!b && b.level > 0;
  const filterType = synth.filterType ?? 'lowpass';
  const mods = synth.mods ?? [];
  const uses = (src: ModSource) => mods.some((m) => m.source === src);

  // Column widths: rack = OSC A | OSC B | SUB | FILTER, then SOURCES | MATRIX; columns = two halves; tabs = the full width.
  const SUB_W = 92;
  const rest = width - SUB_W - 3 * GAP;
  const oscW = layout === 'rack' ? Math.floor(rest * 0.32) : layout === 'columns' ? Math.floor((width - GAP) / 2) : width;
  const filterW = layout === 'rack' ? rest - 2 * oscW : layout === 'columns' ? width - SUB_W - GAP : width;
  const srcW = layout === 'rack' ? Math.floor((width - GAP) * 0.56) : layout === 'columns' ? Math.floor((width - GAP) / 2) : width;
  const scopeH = layout === 'tabs' ? 80 : 78;
  // Side by side the panels share the row; stacked (tabs) they take their own height.
  const grow = layout !== 'tabs';
  const inner = (w: number) => Math.max(140, w - INSET);

  const nextTarget = (current: ModTarget): ModTarget => {
    const ok = (t: ModTarget) => (t === 'posA' ? !!synth.tableA : t === 'posB' ? !!(b && b.table) : true);
    let i = MOD_TARGETS.indexOf(current);
    for (let k = 0; k < MOD_TARGETS.length; k++) {
      i = (i + 1) % MOD_TARGETS.length;
      if (ok(MOD_TARGETS[i])) return MOD_TARGETS[i];
    }
    return current;
  };
  /** Pick for A. Moving from a plain wave to a wavetable also opens a dull filter: the table's colour lives in the upper harmonics. */
  const pickA = (key: string) => {
    if (key.startsWith('w:')) set({ wave: key.slice(2) as OscWave, tableA: undefined, posA: undefined });
    else set({ tableA: key.slice(2), posA: synth.posA ?? 0, ...(!synth.tableA && synth.cutoff < 6000 ? { cutoff: 9000 } : {}) });
  };
  const pickB = (key: string) => (key.startsWith('w:') ? setB({ wave: key.slice(2) as OscWave, table: undefined, pos: undefined }) : setB({ table: key.slice(2), pos: b?.pos ?? 0 }));
  /** "+ Ziel" of a source: a new routing from it, to the first target it does not drive yet (a wavetable first when there is one). */
  const addRoute = (source: ModSource) => {
    if (mods.length >= MAX_MODS) return;
    const order: ModTarget[] = [...(synth.tableA ? (['posA'] as ModTarget[]) : []), 'cutoff', 'reso', 'pitch', 'level', 'pan'];
    const target = order.find((t) => !mods.some((m) => m.source === source && m.target === t)) ?? 'cutoff';
    setMods([...mods, { source, target, amount: source === 'env2' ? 0.6 : 0.4 }]);
  };

  const oscA = (
    <Osc panelW={grow ? oscW : undefined} title="OSC A" table={synth.tableA} pos={synth.posA ?? 0} posRing={rings.posA} wave={synth.wave as OscWave} unison={synth.unison} spread={synth.spread} width={inner(oscW)} height={scopeH} onPick={pickA} onPos={(v) => set({ posA: v })}>
      <Knob label="Unison" value={synth.unison ?? 1} min={1} max={7} step={1} reset={1} format={(v) => String(Math.round(v))} onChange={(v) => set({ unison: v, spread: v > 1 && !synth.spread ? 20 : synth.spread })} />
      <Knob label="Detune" value={synth.spread ?? 0} min={0} max={100} step={1} reset={0} format={CT} onChange={(v) => set({ spread: v })} />
    </Osc>
  );
  const oscB = (
    <Osc
      panelW={grow ? oscW : undefined}
      title="OSC B"
      on={bOn}
      onToggle={() => (bOn ? set({ oscB: undefined }) : setB({ level: 0.7 }))}
      table={b?.table}
      pos={b?.pos ?? 0}
      posRing={rings.posB}
      wave={b?.wave ?? 'sawtooth'}
      unison={synth.unison}
      spread={synth.spread}
      width={inner(oscW)}
      height={scopeH}
      onPick={(k) => (b ? pickB(k) : setB({ level: 0.7 }))}
      onPos={(v) => setB({ pos: v })}
    >
      {b ? (
        <>
          <Knob label="Oktave" value={b.octave} min={-2} max={2} step={1} reset={0} format={SIGNED} onChange={(v) => setB({ octave: v })} />
          <Knob label="Fein" value={b.detune ?? 0} min={-50} max={50} step={1} reset={0} format={CT} onChange={(v) => setB({ detune: v })} />
          <Knob label="Level" value={b.level} min={0} max={1} reset={0.7} format={PCT} onChange={(v) => setB({ level: Math.round(v * 100) / 100 })} />
        </>
      ) : (
        <Txt style={s.hint}>Tippe auf die LED, um den zweiten Oszillator einzuschalten.</Txt>
      )}
    </Osc>
  );
  const subNoise = (
    <Panel title={layout === 'rack' ? 'SUB' : 'SUB · NOISE'} style={layout === 'tabs' ? undefined : { width: SUB_W }}>
      <View style={layout === 'tabs' ? s.knobLine : s.knobColumn}>
        <Knob label="Sub" value={synth.sub ?? 0} min={0} max={1} reset={0} format={PCT} onChange={(v) => set({ sub: Math.round(v * 100) / 100 })} />
        <Knob label="Noise" value={synth.noise ?? 0} min={0} max={1} reset={0} format={PCT} onChange={(v) => set({ noise: Math.round(v * 100) / 100 })} />
      </View>
    </Panel>
  );
  const filter = (
    <Panel
      title="FILTER"
      style={grow ? { width: filterW } : undefined}
      right={
        <View style={s.seg}>
          {FILTERS.map((f) => (
            <Seg key={f.type} label={f.label} on={filterType === f.type} onPress={() => set({ filterType: f.type })} a11y={`Filter ${f.label}`} />
          ))}
          <Seg label="24" on={!!synth.filter24} onPress={() => set({ filter24: synth.filter24 ? undefined : true })} a11y="24 dB pro Oktave" />
        </View>
      }
    >
      <FilterScope type={filterType} cutoff={synth.cutoff} resonance={synth.resonance} envOctaves={synth.filterEnv} width={inner(filterW)} height={scopeH} />
      <KnobRow>
        <Knob label="Cutoff" mod={rings.cutoff} value={synth.cutoff} min={40} max={16000} curve="log" format={HZ} onChange={(v) => set({ cutoff: Math.round(v) })} />
        <Knob label="Reso" mod={rings.reso} value={synth.resonance} min={0.5} max={20} step={0.1} reset={1} format={(v) => (filterType === 'bandpass' ? `Q ${v.toFixed(1)}` : `${v.toFixed(1)} dB`).replace('.', ',')} onChange={(v) => set({ resonance: v })} />
        <Knob label="Env" value={synth.filterEnv ?? 0} min={0} max={5} step={0.1} reset={0} format={(v) => (v ? `${v.toFixed(1).replace('.', ',')} Okt` : 'Aus')} onChange={(v) => set({ filterEnv: v })} />
        <Knob label="Env Zeit" value={synth.filterDecay ?? 0.25} min={0.01} max={2} curve="log" reset={0.25} format={SECOND} onChange={(v) => set({ filterDecay: v })} />
      </KnobRow>
    </Panel>
  );

  const env2 = { ...ENV2, ...synth.env2 };
  const sources = (
    <Panel
      title="MODULATION"
      style={layout === 'tabs' ? undefined : { width: srcW }}
      right={
        <View style={s.seg}>
          {MOD_TABS.map((t) => (
            <Seg key={t.id} label={t.label} on={modTab === t.id} dot={t.id !== 'env1' && uses(t.id as ModSource)} onPress={() => setModTab(t.id)} a11y={`Quelle ${t.label}`} />
          ))}
        </View>
      }
    >
      {modTab === 'env1' && (
        <>
          <EnvScope attack={synth.attack} decay={synth.decay} sustain={synth.sustain} release={synth.release} width={inner(srcW)} height={scopeH} />
          <KnobRow>
            <Knob label="Attack" value={synth.attack} min={0.001} max={2} curve="log" format={SECOND} onChange={(v) => set({ attack: v })} />
            <Knob label="Decay" value={synth.decay} min={0.01} max={1.5} curve="log" format={SECOND} onChange={(v) => set({ decay: v })} />
            <Knob label="Sustain" value={synth.sustain} min={0} max={1} format={PCT} onChange={(v) => set({ sustain: v })} />
            <Knob label="Release" value={synth.release} min={0.005} max={2.5} curve="log" format={SECOND} onChange={(v) => set({ release: v })} />
          </KnobRow>
          <Txt style={s.hint}>ENV 1 formt die Lautstärke jeder Note.</Txt>
        </>
      )}
      {modTab === 'env2' && (
        <>
          <EnvScope attack={env2.attack} decay={env2.decay} sustain={env2.sustain} release={env2.release} width={inner(srcW)} height={scopeH} />
          <KnobRow>
            {(['attack', 'decay', 'sustain', 'release'] as const).map((k) => (
              <Knob
                key={k}
                label={k === 'attack' ? 'Attack' : k === 'decay' ? 'Decay' : k === 'sustain' ? 'Sustain' : 'Release'}
                value={env2[k]}
                min={k === 'sustain' ? 0 : 0.005}
                max={k === 'sustain' ? 1 : 2.5}
                curve={k === 'sustain' ? 'linear' : 'log'}
                format={k === 'sustain' ? PCT : SECOND}
                onChange={(v) => set({ env2: { ...env2, [k]: v } })}
              />
            ))}
          </KnobRow>
          <SourceFoot source="env2" used={uses('env2')} onAdd={() => addRoute('env2')} />
        </>
      )}
      {modTab === 'lfo1' && (
        <>
          <LfoScope rate={synth.lfoRate ?? 1} depth={synth.lfoRate ? Math.max(0.25, synth.lfoDepth ?? 0) : 0.6} wave={synth.lfoShape} width={inner(srcW)} height={scopeH} />
          <View style={s.lfoRow}>
            <KnobRow>
              <Knob label="Rate" value={rateIndex(synth.lfoRate, true)} min={0} max={LFO_RATES.length} step={1} reset={0} format={(v) => (rateAt(v, true) ? lfoRateLabel(rateAt(v, true)!) : 'Aus')} onChange={(v) => set({ lfoRate: rateAt(v, true), lfoDepth: rateAt(v, true) ? synth.lfoDepth || 0.4 : undefined })} />
              <Knob label="→ Cutoff" value={synth.lfoDepth ?? 0} min={0} max={1} reset={0.4} format={PCT} onChange={(v) => set({ lfoDepth: Math.round(v * 100) / 100, lfoRate: synth.lfoRate ?? 1 })} />
            </KnobRow>
            <Shapes value={synth.lfoShape ?? 'sine'} onPick={(w) => set({ lfoShape: w })} />
          </View>
          <SourceFoot source="lfo1" used={uses('lfo1')} onAdd={() => addRoute('lfo1')} />
        </>
      )}
      {modTab === 'lfo2' && (
        <>
          <LfoScope rate={synth.lfo2Rate ?? 0.5} depth={0.6} wave={synth.lfo2Shape} width={inner(srcW)} height={scopeH} />
          <View style={s.lfoRow}>
            <KnobRow>
              <Knob label="Rate" value={rateIndex(synth.lfo2Rate ?? 0.5, false)} min={0} max={LFO_RATES.length - 1} step={1} reset={1} format={(v) => lfoRateLabel(rateAt(v, false)!)} onChange={(v) => set({ lfo2Rate: rateAt(v, false) })} />
            </KnobRow>
            <Shapes value={synth.lfo2Shape ?? 'sine'} onPick={(w) => set({ lfo2Shape: w })} />
          </View>
          <SourceFoot source="lfo2" used={uses('lfo2')} onAdd={() => addRoute('lfo2')} />
        </>
      )}
    </Panel>
  );

  const matrix = (
    <Panel
      title="MATRIX"
      style={grow ? { flex: 1 } : undefined}
      right={
        <Pressable accessibilityLabel="Routing hinzufügen" disabled={mods.length >= MAX_MODS} onPress={() => setMods([...mods, { source: 'lfo1', target: 'cutoff', amount: 0.5 }])} style={[s.addBtn, mods.length >= MAX_MODS && { opacity: 0.4 }]}>
          <Txt style={s.addText}>+ Routing</Txt>
        </Pressable>
      }
    >
      {mods.length === 0 && <Txt style={s.hint}>Noch keine Modulation. Wähle links eine Quelle und tippe „+ Ziel“, z. B. ENV 2 → Wavetable A: der Klang öffnet sich bei jedem Anschlag. Modulierte Regler bekommen einen weißen Ring.</Txt>}
      {mods.map((m, i) => {
        const silent = (m.target === 'posA' && !synth.tableA) || (m.target === 'posB' && !(b && b.table));
        return (
          <View key={i} style={s.modRow}>
            <Pressable accessibilityLabel={`Quelle ${SOURCE_NAMES[m.source]}`} onPress={() => setMod(i, { source: MOD_SOURCES[(MOD_SOURCES.indexOf(m.source) + 1) % MOD_SOURCES.length] })} style={s.srcChip}>
              <Txt style={s.srcText}>{SOURCE_NAMES[m.source]}</Txt>
            </Pressable>
            <Txt style={s.arrowText}>→</Txt>
            <Pressable accessibilityLabel={`Ziel ${TARGET_NAMES[m.target]}`} onPress={() => setMod(i, { target: nextTarget(m.target) })} style={[s.dstChip, silent && { borderColor: C.danger }]}>
              <Txt numberOfLines={1} style={[s.dstText, silent && { color: C.danger }]}>
                {TARGET_NAMES[m.target]}
              </Txt>
            </Pressable>
            <BiSlider value={m.amount} onChange={(v) => setMod(i, { amount: v })} label={`Betrag ${SOURCE_NAMES[m.source]} nach ${TARGET_NAMES[m.target]}`} />
            <Pressable accessibilityLabel="Routing entfernen" onPress={() => setMods(mods.filter((_, j) => j !== i))} hitSlop={6} style={s.del}>
              <Txt style={s.delText}>✕</Txt>
            </Pressable>
          </View>
        );
      })}
      {mods.some((m) => (m.target === 'posA' && !synth.tableA) || (m.target === 'posB' && !(b && b.table))) && <Txt style={[s.hint, { color: C.danger }]}>Rot: das Ziel braucht eine Wavetable.</Txt>}
    </Panel>
  );

  if (layout === 'tabs') {
    return (
      <View style={{ gap: GAP }}>
        <View style={s.tabBar}>
          {TABS.map((t) => (
            <Pressable key={t.id} accessibilityRole="tab" accessibilityLabel={`Bereich ${t.label}`} accessibilityState={{ selected: tab === t.id }} onPress={() => setTab(t.id)} style={[s.tab, tab === t.id && s.tabOn]}>
              <Txt style={[s.tabText, tab === t.id && { color: C.accentInk }]}>{t.label}</Txt>
            </Pressable>
          ))}
        </View>
        {show('osc') && (
          <>
            {oscA}
            {oscB}
            {subNoise}
          </>
        )}
        {show('filter') && filter}
        {show('mod') && (
          <>
            {sources}
            {matrix}
          </>
        )}
      </View>
    );
  }
  if (layout === 'columns') {
    return (
      <View style={{ gap: GAP }}>
        <View style={s.row}>
          {oscA}
          {oscB}
        </View>
        <View style={s.row}>
          {filter}
          {subNoise}
        </View>
        <View style={s.row}>
          {sources}
          {matrix}
        </View>
      </View>
    );
  }
  return (
    <View style={{ gap: GAP }}>
      <View style={s.row}>
        {oscA}
        {oscB}
        {subNoise}
        {filter}
      </View>
      <View style={s.row}>
        {sources}
        {matrix}
      </View>
    </View>
  );
}

/** One button of a segmented switch in a panel header (filter type, mod source); `dot` marks a source that is routed. */
function Seg({ label, on, onPress, a11y, dot }: { label: string; on: boolean; onPress: () => void; a11y: string; dot?: boolean }) {
  return (
    <Pressable accessibilityLabel={a11y} accessibilityState={{ selected: on }} onPress={onPress} style={[s.segBtn, on && s.segOn]}>
      <Txt style={[s.segText, on && { color: C.accentInk }]}>{label}</Txt>
      {dot && <View style={[s.segDot, on && { backgroundColor: C.accentInk }]} />}
    </Pressable>
  );
}

/** The LFO shapes as four small pictures. */
function Shapes({ value, onPick }: { value: OscWave; onPick: (w: OscWave) => void }) {
  return (
    <View style={s.shapes}>
      {WAVES.map((w) => (
        <Pressable key={w} accessibilityLabel={`Form ${WAVE_NAMES[w]}`} accessibilityState={{ selected: value === w }} onPress={() => onPick(w)} style={[s.shape, value === w && s.shapeOn]}>
          <WaveGlyph wave={w} size={24} color={value === w ? C.accent : '#6b6b76'} />
        </Pressable>
      ))}
    </View>
  );
}

/** Under a mod source: where it goes, and "+ Ziel" to route it somewhere. */
function SourceFoot({ source, used, onAdd }: { source: ModSource; used: boolean; onAdd: () => void }) {
  return (
    <View style={s.foot}>
      <Txt style={s.hint}>{used ? `${SOURCE_NAMES[source]} ist im Einsatz (siehe Matrix).` : `${SOURCE_NAMES[source]} ist noch mit nichts verbunden.`}</Txt>
      <Pressable accessibilityLabel={`${SOURCE_NAMES[source]} mit einem Ziel verbinden`} onPress={onAdd} style={s.addBtn}>
        <Txt style={s.addText}>+ Ziel</Txt>
      </Pressable>
    </View>
  );
}

/** A bipolar amount slider (-100 % … +100 %) filled from the middle: drag sideways, double tap for 0. */
function BiSlider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [w, setW] = useState(80);
  const start = useRef<number | null>(null);
  const lastTap = useRef(0);
  const latest = useRef({ value, onChange, w });
  latest.current = { value, onChange, w };
  const drag = useDrag('start', true, (dx, _dy, phase) => {
    const l = latest.current;
    if (phase === 'move') {
      start.current ??= l.value;
      l.onChange(Math.round(Math.max(-1, Math.min(1, start.current + (dx / l.w) * 2)) * 100) / 100);
      return;
    }
    const moved = start.current !== null;
    start.current = null;
    if (phase === 'end' && !moved) {
      const now = Date.now();
      if (now - lastTap.current < 350) l.onChange(0);
      lastTap.current = now;
    }
  });
  const x = (v: number) => ((v + 1) / 2) * w;
  return (
    <View style={s.bi}>
      <View {...drag} accessibilityRole="adjustable" accessibilityLabel={`${label} ${Math.round(value * 100)} %`} onLayout={(e) => setW(e.nativeEvent.layout.width)} style={[s.biTrack, web({ touchAction: 'none', cursor: 'ew-resize' })]}>
        <View style={[s.biFill, { left: Math.min(x(0), x(value)), width: Math.abs(x(value) - x(0)) }]} />
        <View style={s.biMid} />
      </View>
      <Txt style={s.biText}>{`${value > 0 ? '+' : ''}${Math.round(value * 100)}`}</Txt>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: GAP, alignItems: 'stretch' },
  panel: { minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 32, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: 'rgba(0,0,0,0.28)', borderBottomWidth: 1, borderBottomColor: '#25252c' },
  body: { padding: 12, paddingTop: 10, flexGrow: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  led: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#2a2a32' },
  title: { ...cond(700), fontSize: 13, letterSpacing: 2.4, color: '#d9d9de' },
  picker: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0, backgroundColor: '#0a0a0c', borderRadius: 5, borderWidth: 1, borderColor: '#2a2a32', height: 24 },
  arrow: { paddingHorizontal: 7, height: 22, justifyContent: 'center' },
  arrowText: { color: C.muted, fontSize: 9 },
  pickName: { flexShrink: 1, minWidth: 64, alignItems: 'center', paddingHorizontal: 4 },
  pickText: { ...mono(500), fontSize: 11, color: C.accent, textShadowColor: 'rgba(198,255,61,0.5)', textShadowRadius: 6 },
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  listItem: { paddingHorizontal: 8, height: 24, borderRadius: 4, borderWidth: 1, borderColor: '#2e2e36', backgroundColor: '#141418', justifyContent: 'center' },
  listOn: { backgroundColor: C.accent, borderColor: C.accent },
  listText: { ...cond(600), fontSize: 12, letterSpacing: 0.8, color: C.text },
  hint: { color: C.muted, fontSize: 11, lineHeight: 15, marginTop: 6, flexShrink: 1 },
  knobColumn: { alignItems: 'center', gap: 4, paddingTop: 4 },
  knobLine: { flexDirection: 'row', justifyContent: 'space-around' },
  seg: { flexDirection: 'row', borderRadius: 5, overflow: 'hidden', borderWidth: 1, borderColor: '#2e2e36', flexShrink: 1 },
  segBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, height: 22, backgroundColor: '#121216', borderRightWidth: 1, borderRightColor: '#2e2e36' },
  segOn: { backgroundColor: C.accent },
  segText: { ...cond(700), fontSize: 11.5, letterSpacing: 1, color: '#a0a0aa' },
  segDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.accent },
  lfoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  shapes: { flexDirection: 'row', gap: 4, marginTop: 6 },
  shape: { width: 32, height: 28, borderRadius: 5, borderWidth: 1, borderColor: '#2a2a32', backgroundColor: '#0e0e11', alignItems: 'center', justifyContent: 'center' },
  shapeOn: { borderColor: C.accent },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between', marginTop: 2 },
  addBtn: { height: 24, paddingHorizontal: 9, borderRadius: 5, borderWidth: 1, borderColor: C.accent, justifyContent: 'center', marginTop: 4 },
  addText: { ...cond(700), fontSize: 11.5, letterSpacing: 1, color: C.accent },
  modRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#202027' },
  srcChip: { height: 24, paddingHorizontal: 8, borderRadius: 4, backgroundColor: C.accent, justifyContent: 'center' },
  srcText: { ...cond(700), fontSize: 11.5, letterSpacing: 0.8, color: C.accentInk },
  dstChip: { height: 24, width: 92, paddingHorizontal: 8, borderRadius: 4, borderWidth: 1, borderColor: '#34343d', backgroundColor: '#121216', justifyContent: 'center' },
  dstText: { ...cond(600), fontSize: 11.5, letterSpacing: 0.6, color: C.text },
  bi: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 70 },
  biTrack: { flex: 1, height: 14, borderRadius: 3, backgroundColor: '#0a0a0c', borderWidth: 1, borderColor: '#2a2a32', overflow: 'hidden' },
  biFill: { position: 'absolute', top: 2, bottom: 2, backgroundColor: '#f2f2f5', opacity: 0.85, borderRadius: 2 },
  biMid: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, backgroundColor: '#5b5b66' },
  biText: { ...mono(), fontSize: 10, color: C.text, width: 30, textAlign: 'right' },
  del: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  delText: { fontSize: 11, color: C.muted },
  tabBar: { flexDirection: 'row', gap: 6 },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#2a2a32', backgroundColor: '#121215' },
  tabOn: { backgroundColor: C.accent, borderColor: C.accent },
  tabText: { ...cond(700), fontSize: 14, letterSpacing: 1.7, color: C.muted },
});
