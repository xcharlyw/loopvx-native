import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MAX_MODS, MOD_SOURCES, MOD_TARGETS } from '../../audio/synth';
import { TABLES, tableById } from '../../audio/wavetables';
import { C, font } from '../../constants/theme';
import type { ModSlot, ModSource, ModTarget, OscWave, SynthSettings } from '../../types';
import { Chip, Txt } from '../kit';
import { Knob, KnobRow } from './Knob';
import { EnvScope, FilterScope, LfoScope, TableScope, WaveScope } from './Scopes';

// The synth page, built like Serum's main screen but with only the knobs that matter: two oscillators with a wavetable
// each (the picture, a position knob, unison), a filter, the amp envelope and one small modulation matrix.

const ACCENT_B = '#3dd6ff';
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
const LFO_RATES = [0.25, 0.5, 1, 2, 4, 8, 16];
const lfoLabel = (r: number) => (r === 0.25 ? '¼' : r === 0.5 ? '½' : `${r}×`);
const FILTERS: { type: NonNullable<SynthSettings['filterType']>; label: string }[] = [
  { type: 'lowpass', label: 'LP' },
  { type: 'highpass', label: 'HP' },
  { type: 'bandpass', label: 'BP' },
];
const ENV2 = { attack: 0.01, decay: 0.4, sustain: 0, release: 0.2 };
const SOURCE_NAMES: Record<ModSource, string> = { lfo1: 'LFO 1', lfo2: 'LFO 2', env2: 'ENV 2' };
const TARGET_NAMES: Record<ModTarget, string> = { cutoff: 'Cutoff', reso: 'Resonanz', pitch: 'Tonhöhe', posA: 'Wavetable A', posB: 'Wavetable B', level: 'Lautstärke', pan: 'Panorama' };

interface Props {
  synth: SynthSettings;
  width: number;
  set: (patch: Partial<SynthSettings>) => void;
  setB: (patch: Partial<NonNullable<SynthSettings['oscB']>>) => void;
  setMods: (mods: ModSlot[]) => void;
  setMod: (i: number, patch: Partial<ModSlot>) => void;
}

/** A section with a Serum-like header: a LED (on/off where the section can be switched), the title in small caps, a control on the right. */
export function Panel({ title, on, onToggle, right, color = C.accent, children, style }: { title: string; on?: boolean; onToggle?: () => void; right?: ReactNode; color?: string; children: ReactNode; style?: object }) {
  return (
    <View style={[s.panel, style]}>
      <View style={s.head}>
        <Pressable onPress={onToggle} disabled={!onToggle} accessibilityLabel={onToggle ? `${title} ${on ? 'ausschalten' : 'einschalten'}` : undefined} style={s.titleRow} hitSlop={8}>
          <View style={[s.led, on !== false && { backgroundColor: color, shadowColor: color, shadowOpacity: 0.8, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } }]} />
          <Txt style={[s.title, on === false && { color: C.dim }]}>{title}</Txt>
        </Pressable>
        {right}
      </View>
      {children}
    </View>
  );
}

/** One oscillator: ◀ name ▶ over the picture (a wave or the wavetable stack), the list to pick from on tap, position knob and unison. */
function Osc({ title, color, table, pos, wave, unison, spread, width, on, onToggle, onPick, onPos, children }: { title: string; color: string; table?: string; pos: number; wave: OscWave; unison?: number; spread?: number; width: number; on?: boolean; onToggle?: () => void; onPick: (key: string) => void; onPos: (v: number) => void; children: ReactNode }) {
  const [list, setList] = useState(false);
  const key = sourceKey(table, wave);
  const step = (d: number) => onPick(SOURCES[(SOURCES.findIndex((x) => x.key === key) + d + SOURCES.length) % SOURCES.length].key);
  return (
    <Panel title={title} on={on} onToggle={onToggle} color={color}>
      <View style={s.picker}>
        <Pressable accessibilityLabel={`${title} vorherige Wellenform`} onPress={() => step(-1)} hitSlop={8} style={s.arrow}>
          <Txt style={s.arrowText}>◀</Txt>
        </Pressable>
        <Pressable accessibilityLabel={`${title} Wellenform wählen`} onPress={() => setList((v) => !v)} style={s.pickName}>
          <Txt numberOfLines={1} style={[s.pickText, { color }]}>
            {SOURCES.find((x) => x.key === key)?.label}
          </Txt>
        </Pressable>
        <Pressable accessibilityLabel={`${title} nächste Wellenform`} onPress={() => step(1)} hitSlop={8} style={s.arrow}>
          <Txt style={s.arrowText}>▶</Txt>
        </Pressable>
      </View>
      {list && (
        <View style={s.chips}>
          {SOURCES.map((x) => (
            <Chip key={x.key} variant={key === x.key ? 'on' : 'ghost'} onPress={() => (onPick(x.key), setList(false))}>
              {x.label}
            </Chip>
          ))}
        </View>
      )}
      <View style={{ marginTop: 8 }}>{table ? <TableScope table={table} pos={pos} width={width} height={96} color={color} /> : <WaveScope wave={wave} unison={unison} spread={spread} width={width} height={96} color={color} />}</View>
      {table && <Txt style={s.hint}>{tableById(table)?.hint}</Txt>}
      <KnobRow>
        {table && <Knob label="Pos" color={color} size={52} width={64} value={pos} min={0} max={1} reset={0} format={PCT} onChange={(v) => onPos(Math.round(v * 64) / 64)} />}
        {children}
      </KnobRow>
    </Panel>
  );
}

/** The whole synth page. */
export function SynthPage({ synth, width, set, setB, setMods, setMod }: Props) {
  const wide = width >= 620;
  const half = wide ? Math.floor((width - 10) / 2) : width;
  const inner = (w: number) => Math.max(160, w - 22); // panel padding 10 + border 1 on each side
  const b = synth.oscB;
  const bOn = !!b && b.level > 0;
  const filterType = synth.filterType ?? 'lowpass';
  const mods = synth.mods ?? [];
  const uses = (src: ModSource) => mods.some((m) => m.source === src);
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

  return (
    <View style={{ gap: 10 }}>
      <View style={wide ? s.row : undefined}>
        <View style={wide ? { width: half } : undefined}>
          <Osc title="OSC A" color={C.accent} table={synth.tableA} pos={synth.posA ?? 0} wave={synth.wave as OscWave} unison={synth.unison} spread={synth.spread} width={inner(half)} onPick={pickA} onPos={(v) => set({ posA: v })}>
            <Knob label="Unison" size={52} width={64} value={synth.unison ?? 1} min={1} max={7} step={1} reset={1} format={(v) => String(Math.round(v))} onChange={(v) => set({ unison: v, spread: v > 1 && !synth.spread ? 20 : synth.spread })} />
            <Knob label="Detune" size={52} width={64} value={synth.spread ?? 0} min={0} max={100} step={1} reset={0} format={CT} onChange={(v) => set({ spread: v })} />
          </Osc>
        </View>
        <View style={wide ? { width: half } : { marginTop: 10 }}>
          <Osc
            title="OSC B"
            color={ACCENT_B}
            on={bOn}
            onToggle={() => (bOn ? set({ oscB: undefined }) : setB({ level: 0.7 }))}
            table={b?.table}
            pos={b?.pos ?? 0}
            wave={b?.wave ?? 'sawtooth'}
            unison={synth.unison}
            spread={synth.spread}
            width={inner(half)}
            onPick={(k) => (b ? pickB(k) : setB({ level: 0.7 }))}
            onPos={(v) => setB({ pos: v })}
          >
            {b ? (
              <>
                <Knob label="Oktave" color={ACCENT_B} size={52} width={64} value={b.octave} min={-2} max={2} step={1} reset={0} format={SIGNED} onChange={(v) => setB({ octave: v })} />
                <Knob label="Level" color={ACCENT_B} size={52} width={64} value={b.level} min={0} max={1} reset={0.7} format={PCT} onChange={(v) => setB({ level: Math.round(v * 100) / 100 })} />
              </>
            ) : (
              <Txt style={s.hint}>Tippe auf die LED, um den zweiten Oszillator einzuschalten.</Txt>
            )}
          </Osc>
        </View>
      </View>

      <View style={wide ? s.row : undefined}>
        <View style={wide ? { width: half } : undefined}>
          <Panel
            title="FILTER"
            right={
              <View style={s.chips0}>
                {FILTERS.map((f) => (
                  <Chip key={f.type} variant={filterType === f.type ? 'on' : 'ghost'} onPress={() => set({ filterType: f.type })} textStyle={{ fontSize: 11 }}>
                    {f.label}
                  </Chip>
                ))}
                <Chip variant={synth.filter24 ? 'on' : 'ghost'} onPress={() => set({ filter24: synth.filter24 ? undefined : true })} textStyle={{ fontSize: 11 }}>
                  24 dB
                </Chip>
              </View>
            }
          >
            <FilterScope type={filterType} cutoff={synth.cutoff} resonance={synth.resonance} envOctaves={synth.filterEnv} width={inner(half)} height={84} />
            <KnobRow>
              <Knob label="Cutoff" size={52} width={64} value={synth.cutoff} min={40} max={16000} curve="log" format={HZ} onChange={(v) => set({ cutoff: Math.round(v) })} />
              <Knob label="Reso" size={52} width={64} value={synth.resonance} min={0.5} max={20} step={0.1} reset={1} format={(v) => (filterType === 'bandpass' ? `Q ${v.toFixed(1)}` : `${v.toFixed(1)} dB`).replace('.', ',')} onChange={(v) => set({ resonance: v })} />
              <Knob label="Env" size={52} width={64} value={synth.filterEnv ?? 0} min={0} max={5} step={0.1} reset={0} format={(v) => (v ? `${v.toFixed(1).replace('.', ',')} Okt` : 'Aus')} onChange={(v) => set({ filterEnv: v })} />
            </KnobRow>
          </Panel>
        </View>
        <View style={wide ? { width: half } : { marginTop: 10 }}>
          <Panel title="AMP">
            <EnvScope attack={synth.attack} decay={synth.decay} sustain={synth.sustain} release={synth.release} width={inner(half)} height={84} />
            <KnobRow>
              <Knob label="Attack" size={46} width={56} value={synth.attack} min={0.001} max={2} curve="log" format={SECOND} onChange={(v) => set({ attack: v })} />
              <Knob label="Decay" size={46} width={56} value={synth.decay} min={0.01} max={1.5} curve="log" format={SECOND} onChange={(v) => set({ decay: v })} />
              <Knob label="Sustain" size={46} width={56} value={synth.sustain} min={0} max={1} format={PCT} onChange={(v) => set({ sustain: v })} />
              <Knob label="Release" size={46} width={56} value={synth.release} min={0.005} max={2.5} curve="log" format={SECOND} onChange={(v) => set({ release: v })} />
            </KnobRow>
            <KnobRow>
              <Knob label="Sub" size={46} width={56} value={synth.sub ?? 0} min={0} max={1} reset={0} format={PCT} onChange={(v) => set({ sub: Math.round(v * 100) / 100 })} />
              <Knob label="Noise" size={46} width={56} value={synth.noise ?? 0} min={0} max={1} reset={0} format={PCT} onChange={(v) => set({ noise: Math.round(v * 100) / 100 })} />
            </KnobRow>
          </Panel>
        </View>
      </View>

      <Panel
        title="MOD"
        color={ACCENT_B}
        right={
          <Chip variant="ghost" onPress={() => (mods.length < MAX_MODS ? setMods([...mods, { source: 'lfo1', target: 'cutoff', amount: 0.5 }]) : undefined)} accessibilityLabel="Routing hinzufügen">
            + Routing
          </Chip>
        }
      >
        {mods.length === 0 && <Txt style={s.hint}>Verbinde eine Quelle (LFO 1, LFO 2, ENV 2) mit einem Ziel, zum Beispiel ENV 2 → Wavetable A: der Klang öffnet sich bei jedem Anschlag.</Txt>}
        {mods.map((m, i) => (
          <View key={i} style={s.modRow}>
            <Chip variant="on" onPress={() => setMod(i, { source: MOD_SOURCES[(MOD_SOURCES.indexOf(m.source) + 1) % MOD_SOURCES.length] })} accessibilityLabel={`Quelle ${SOURCE_NAMES[m.source]}`}>
              {SOURCE_NAMES[m.source]}
            </Chip>
            <Txt style={s.arrowText}>→</Txt>
            <View style={{ flex: 1 }}>
              <Chip variant="ghost" onPress={() => setMod(i, { target: nextTarget(m.target) })} accessibilityLabel={`Ziel ${TARGET_NAMES[m.target]}`}>
                {TARGET_NAMES[m.target]}
              </Chip>
              {(m.target === 'posA' && !synth.tableA) || (m.target === 'posB' && !(b && b.table)) ? <Txt style={[s.hint, { color: C.danger }]}>Dafür eine Wavetable wählen.</Txt> : null}
            </View>
            <Knob label="Betrag" size={42} width={60} value={m.amount} min={-1} max={1} reset={0.5} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)} %`} onChange={(v) => setMod(i, { amount: Math.round(v * 100) / 100 })} />
            <Chip variant="ghost" onPress={() => setMods(mods.filter((_, j) => j !== i))} accessibilityLabel="Routing entfernen">
              ✕
            </Chip>
          </View>
        ))}
        {/* the sources: LFO 1 always (it also swings the cutoff), LFO 2 and ENV 2 once a routing uses them */}
        <Txt style={s.cap}>LFO 1 (tempo-synchron, Zyklen pro Takt)</Txt>
        <View style={s.chips0}>
          <Chip variant={synth.lfoRate ? 'ghost' : 'on'} onPress={() => set({ lfoRate: undefined, lfoDepth: undefined })}>
            AUS
          </Chip>
          {LFO_RATES.map((r) => (
            <Chip key={r} variant={synth.lfoRate === r ? 'on' : 'ghost'} onPress={() => set({ lfoRate: r, lfoDepth: synth.lfoDepth || 0.4 })}>
              {lfoLabel(r)}
            </Chip>
          ))}
        </View>
        {(!!synth.lfoRate || uses('lfo1')) && (
          <>
            <LfoScope rate={synth.lfoRate ?? 1} depth={0.6} width={inner(width)} height={52} />
            <View style={s.chips0}>
              {WAVES.map((w) => (
                <Chip key={w} variant={(synth.lfoShape ?? 'sine') === w ? 'on' : 'ghost'} onPress={() => set({ lfoShape: w })}>
                  {WAVE_NAMES[w]}
                </Chip>
              ))}
              {!!synth.lfoRate && <Knob label="Cutoff" size={42} width={60} value={synth.lfoDepth ?? 0} min={0} max={1} reset={0.4} format={PCT} onChange={(v) => set({ lfoDepth: Math.round(v * 100) / 100 })} />}
            </View>
          </>
        )}
        {uses('lfo2') && (
          <>
            <Txt style={s.cap}>LFO 2</Txt>
            <View style={s.chips0}>
              {LFO_RATES.map((r) => (
                <Chip key={r} variant={(synth.lfo2Rate ?? 0.5) === r ? 'on' : 'ghost'} onPress={() => set({ lfo2Rate: r })}>
                  {lfoLabel(r)}
                </Chip>
              ))}
            </View>
            <View style={s.chips0}>
              {WAVES.map((w) => (
                <Chip key={w} variant={(synth.lfo2Shape ?? 'sine') === w ? 'on' : 'ghost'} onPress={() => set({ lfo2Shape: w })}>
                  {WAVE_NAMES[w]}
                </Chip>
              ))}
            </View>
          </>
        )}
        {uses('env2') && (
          <>
            <Txt style={s.cap}>ENV 2</Txt>
            <EnvScope attack={synth.env2?.attack ?? ENV2.attack} decay={synth.env2?.decay ?? ENV2.decay} sustain={synth.env2?.sustain ?? ENV2.sustain} release={synth.env2?.release ?? ENV2.release} width={inner(width)} height={64} color={ACCENT_B} />
            <KnobRow>
              {(['attack', 'decay', 'sustain', 'release'] as const).map((k) => (
                <Knob
                  key={k}
                  label={k === 'attack' ? 'Attack' : k === 'decay' ? 'Decay' : k === 'sustain' ? 'Sustain' : 'Release'}
                  color={ACCENT_B}
                  size={46}
                  width={56}
                  value={synth.env2?.[k] ?? ENV2[k]}
                  min={k === 'sustain' ? 0 : 0.005}
                  max={k === 'sustain' ? 1 : 2.5}
                  curve={k === 'sustain' ? 'linear' : 'log'}
                  format={k === 'sustain' ? PCT : SECOND}
                  onChange={(v) => set({ env2: { ...ENV2, ...synth.env2, [k]: v } })}
                />
              ))}
            </KnobRow>
          </>
        )}
      </Panel>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  panel: { backgroundColor: '#0f1215', borderWidth: 1, borderColor: '#1d262b', borderRadius: 10, padding: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, minHeight: 26 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  led: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#2a3238' },
  title: { ...font(700), fontSize: 11, letterSpacing: 1.6, color: C.text },
  picker: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161c21', borderRadius: 8, borderWidth: 1, borderColor: '#232d33' },
  arrow: { paddingHorizontal: 14, paddingVertical: 9 },
  arrowText: { color: C.muted, fontSize: 13 },
  pickName: { flex: 1, alignItems: 'center', paddingVertical: 9 },
  pickText: { ...font(700), fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chips0: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 6 },
  hint: { color: C.muted, fontSize: 11.5, lineHeight: 16, marginTop: 6 },
  cap: { ...font(700), fontSize: 10, letterSpacing: 1.2, color: C.muted, marginTop: 12 },
  modRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#1d262b' },
});
