import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { engine } from '../audio/engine';
import { applyInstrument, applyPreset, PRESET_CATEGORIES, PRESETS, presetById, type PresetCategory } from '../audio/presets';
import { KICK_PRESET, NOISE_PRESET, SAMPLER_PRESET } from '../audio/synth';
import { trackFx } from '../audio/fx';
import { C, font, mono } from '../constants/theme';
import { noteName } from '../lib/midi';
import { DEFAULT_SYNTH, mapTrack, trackSynth } from '../lib/project';
import { updateProject, useStore } from '../lib/store';
import type { OscWave, SynthSettings, TrackFx } from '../types';
import { Btn, Chip, Txt } from './kit';
import { Sheet } from './Sheet';
import { Knob, KnobRow } from './synth/Knob';
import { Keys } from './synth/Keys';
import { SamplePeaks } from './synth/SamplePeaks';
import { EnvScope, FilterEnvMini, FilterScope, LfoScope, WaveGlyph, WaveScope } from './synth/Scopes';
import { Card, Tabs } from './synth/Tabs';

type Kind = 'synth' | 'sample' | 'kick' | 'noise';
const kindOf = (wave: SynthSettings['wave']): Kind => (wave === 'sample' ? 'sample' : wave === 'kick' ? 'kick' : wave === 'noise' ? 'noise' : 'synth');
const KINDS: { kind: Kind; title: string; sub: string }[] = [
  { kind: 'synth', title: 'Synth', sub: 'Oszillatoren' },
  { kind: 'sample', title: 'Sampler', sub: 'Dein Sample' },
  { kind: 'kick', title: 'Kick', sub: 'Synthetisch' },
  { kind: 'noise', title: 'Noise', sub: 'Hat · Snare' },
];
type Tab = 'osc' | 'sample' | 'filter' | 'env' | 'lfo' | 'fx';
const TABS: Record<Kind, { id: Tab; label: string }[]> = {
  synth: [{ id: 'osc', label: 'OSC' }, { id: 'filter', label: 'FILTER' }, { id: 'env', label: 'ENV' }, { id: 'lfo', label: 'LFO' }, { id: 'fx', label: 'FX' }],
  sample: [{ id: 'sample', label: 'SAMPLE' }, { id: 'filter', label: 'FILTER' }, { id: 'env', label: 'ENV' }, { id: 'fx', label: 'FX' }],
  kick: [{ id: 'env', label: 'ENV' }, { id: 'fx', label: 'FX' }],
  noise: [{ id: 'filter', label: 'FILTER' }, { id: 'env', label: 'ENV' }, { id: 'fx', label: 'FX' }],
};
const WAVES: OscWave[] = ['sawtooth', 'square', 'triangle', 'sine'];
const WAVE_NAMES: Record<OscWave, string> = { sawtooth: 'Saw', square: 'Square', triangle: 'Triangle', sine: 'Sine' };
const FILTERS: { type: NonNullable<SynthSettings['filterType']>; label: string }[] = [
  { type: 'lowpass', label: 'LOWPASS' },
  { type: 'highpass', label: 'HIGHPASS' },
  { type: 'bandpass', label: 'BANDPASS' },
];
/** LFO speeds in cycles per bar. */
const LFO_RATES = [0.25, 0.5, 1, 2, 4, 8, 16];
const lfoLabel = (r: number) => (r === 0.25 ? '¼' : r === 0.5 ? '½' : `${r}×`);
const SECOND = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2).replace('.', ',')} s`);
const HZ = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')} k` : `${Math.round(v)} Hz`);
const PCT = (v: number) => `${Math.round(v * 100)} %`;
const CT = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} ct`;
const SIGNED = (v: number) => (v > 0 ? `+${Math.round(v)}` : String(Math.round(v)));
const ACCENT_B = '#3dd6ff';

/**
 * The sound of the selected track, built like a plugin: a preset switcher on top, "load an instrument"
 * (synth, sampler or a synthesized drum), then tabs with knobs and live displays (oscillators, filter
 * response, envelope, LFO, effects) and a small keyboard to try it. Knob drags are one undo step each.
 */
export function InstrumentPanel() {
  const track = useStore((st) => st.project.tracks.find((t) => t.id === st.selectedTrackId));
  const samples = useStore((st) => st.samples);
  const [tabByKind, setTabByKind] = useState<Partial<Record<Kind, Tab>>>({});
  const [browse, setBrowse] = useState(false);
  const [category, setCategory] = useState<PresetCategory | null>(null);
  const [width, setWidth] = useState(330);
  const [keysLow, setKeysLow] = useState(48);
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
  const fx = trackFx(track.fx);
  const tabs = TABS[kind];
  const tab = tabs.some((t) => t.id === tabByKind[kind]) ? (tabByKind[kind] as Tab) : tabs[0].id;
  const inner = Math.max(200, width - 26); // a card is 12 px padding + 1 px border on each side
  const filterType: NonNullable<SynthSettings['filterType']> = kind === 'noise' ? 'highpass' : synth.filterType ?? 'lowpass';

  /** Knobs: a drag is one undo step. */
  const set = (patch: Partial<SynthSettings>) => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, synth: { ...trackSynth(t), ...patch } })), { merge: true });
  const setB = (patch: Partial<NonNullable<SynthSettings['oscB']>>) => set({ oscB: { ...(synth.oscB ?? { wave: 'sawtooth' as OscWave, octave: 0, detune: 0, level: 0.7 }), ...patch } });
  const setFx = (patch: TrackFx) => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, fx: { ...t.fx, ...patch } })), { reschedule: false });
  const hear = (sy: SynthSettings, pitch: number) => void engine.previewNote(sy, pitch);
  const auditionPitch = kind === 'synth' ? current?.note ?? 48 : 60;

  const pickPreset = (id: string) => {
    const preset = presetById(id);
    if (!preset) return;
    updateProject((p) => mapTrack(p, trackId, (t) => applyPreset(t, preset)));
    hear(preset.synth, preset.note);
    setKeysLow(Math.max(24, Math.floor((preset.note - 12) / 12) * 12));
  };
  /** Previous/next preset of the whole library, in browser order. */
  const stepPreset = (dir: 1 | -1) => {
    const i = PRESETS.findIndex((p) => p.id === synth.preset);
    const next = PRESETS[(i < 0 ? (dir > 0 ? 0 : PRESETS.length - 1) : (i + dir + PRESETS.length) % PRESETS.length)];
    pickPreset(next.id);
  };
  /** "Load an instrument": replaces the whole instrument and its sound effects, like dropping a device on a track. */
  const loadKind = (k: Kind) => {
    if (k === kind) return;
    const sampleId = synth.sampleId;
    const next: SynthSettings =
      k === 'synth' ? { ...DEFAULT_SYNTH, sampleId }
      : k === 'sample' ? ({ ...DEFAULT_SYNTH, ...SAMPLER_PRESET, sampleId: sampleId ?? samples[0]?.id } as SynthSettings)
      : k === 'kick' ? ({ ...DEFAULT_SYNTH, ...KICK_PRESET, sampleId } as SynthSettings)
      : ({ ...DEFAULT_SYNTH, ...NOISE_PRESET, sampleId } as SynthSettings);
    updateProject((p) => mapTrack(p, trackId, (t) => applyInstrument(t, next)));
    hear(next, 60);
    setKeysLow(48);
  };
  const b = synth.oscB;
  const shown = category ?? current?.category ?? 'Bass';

  return (
    <Sheet title="Sound">
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {/* preset switcher */}
        <View style={s.switcher}>
          <Btn small accessibilityLabel="Vorheriges Preset" onPress={() => stepPreset(-1)}>
            ◀
          </Btn>
          <Pressable accessibilityLabel="Preset-Browser" onPress={() => setBrowse((v) => !v)} style={s.nameBox}>
            <Txt numberOfLines={1} style={s.name}>
              {current ? current.name : track.synth ? 'Eigener Sound' : 'Standard-Synth'}
            </Txt>
            <Txt numberOfLines={1} style={s.nameSub}>{`${track.name} · ${KINDS.find((x) => x.kind === kind)!.title}`}</Txt>
          </Pressable>
          <Btn small accessibilityLabel="Nächstes Preset" onPress={() => stepPreset(1)}>
            ▶
          </Btn>
        </View>

        {browse && (
          <Card title="PRESETS">
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
          </Card>
        )}

        {/* load an instrument */}
        <Txt style={s.cap}>INSTRUMENT LADEN</Txt>
        <View style={s.tiles}>
          {KINDS.map((k) => (
            <Pressable key={k.kind} accessibilityLabel={`Instrument ${k.title}`} accessibilityState={{ selected: kind === k.kind }} onPress={() => loadKind(k.kind)} style={[s.tile, kind === k.kind && s.tileOn]}>
              <Txt style={[s.tileTitle, kind === k.kind && { color: C.accent }]}>{k.title}</Txt>
              <Txt numberOfLines={1} style={s.tileSub}>
                {k.sub}
              </Txt>
            </Pressable>
          ))}
        </View>

        <Tabs tabs={tabs} value={tab} onChange={(id) => setTabByKind((m) => ({ ...m, [kind]: id }))} />

        {/* ---------------- SYNTH ---------------- */}
        {kind === 'synth' && tab === 'osc' && (
          <>
            <Card title="OSC A">
              <WaveScope wave={synth.wave as OscWave} unison={synth.unison} spread={synth.spread} width={inner} />
              <WavePick value={synth.wave as OscWave} color={C.accent} onPick={(w) => set({ wave: w })} />
              <KnobRow>
                <Knob label="Unison" value={synth.unison ?? 1} min={1} max={7} step={1} reset={1} format={(v) => String(Math.round(v))} onChange={(v) => set({ unison: v, spread: v > 1 && !synth.spread ? 20 : synth.spread })} />
                <Knob label="Spread" value={synth.spread ?? 0} min={0} max={100} step={1} reset={0} format={CT} onChange={(v) => set({ spread: v })} />
              </KnobRow>
            </Card>
            <Card
              title="OSC B"
              right={
                <Chip variant={b ? 'on' : 'ghost'} onPress={() => (b ? set({ oscB: undefined }) : setB({}))}>
                  {b ? 'AN' : 'AUS'}
                </Chip>
              }
            >
              {b ? (
                <>
                  <WaveScope wave={b.wave} unison={synth.unison} spread={synth.spread} width={inner} color={ACCENT_B} />
                  <WavePick value={b.wave} color={ACCENT_B} onPick={(w) => setB({ wave: w })} />
                  <KnobRow>
                    <Knob label="Oktave" color={ACCENT_B} value={b.octave} min={-2} max={2} step={1} reset={0} format={SIGNED} onChange={(v) => setB({ octave: v })} />
                    <Knob label="Fine" color={ACCENT_B} value={b.detune} min={-50} max={50} step={1} reset={0} format={CT} onChange={(v) => setB({ detune: v })} />
                    <Knob label="Pegel" color={ACCENT_B} value={b.level} min={0} max={1} reset={0.7} format={PCT} onChange={(v) => setB({ level: Math.round(v * 100) / 100 })} />
                  </KnobRow>
                </>
              ) : (
                <Txt style={s.note}>Ein zweiter Oszillator macht den Klang dicker: Oktave, Verstimmung und Pegel einstellbar.</Txt>
              )}
            </Card>
            <Card title="SUB · NOISE">
              <KnobRow>
                <Knob label="Sub" value={synth.sub ?? 0} min={0} max={1} reset={0} format={PCT} onChange={(v) => set({ sub: Math.round(v * 100) / 100 })} />
                <Knob label="Noise" value={synth.noise ?? 0} min={0} max={1} reset={0} format={PCT} onChange={(v) => set({ noise: Math.round(v * 100) / 100 })} />
              </KnobRow>
            </Card>
          </>
        )}

        {kind === 'synth' && tab === 'lfo' && (
          <Card title="LFO → FILTER">
            <LfoScope rate={synth.lfoRate ?? 0} depth={synth.lfoRate ? synth.lfoDepth ?? 0.4 : 0} width={inner} />
            <Txt style={[s.note, { marginTop: 8 }]}>Zyklen pro Takt, synchron zum Tempo</Txt>
            <View style={s.chips}>
              <Chip variant={synth.lfoRate ? 'ghost' : 'on'} onPress={() => set({ lfoRate: undefined, lfoDepth: undefined })}>
                AUS
              </Chip>
              {LFO_RATES.map((r) => (
                <Chip key={r} variant={synth.lfoRate === r ? 'on' : 'ghost'} onPress={() => set({ lfoRate: r, lfoDepth: synth.lfoDepth || 0.4 })}>
                  {lfoLabel(r)}
                </Chip>
              ))}
            </View>
            {!!synth.lfoRate && (
              <KnobRow>
                <Knob label="Tiefe" value={synth.lfoDepth ?? 0} min={0} max={1} reset={0.4} format={PCT} onChange={(v) => set({ lfoDepth: Math.round(v * 100) / 100 })} />
              </KnobRow>
            )}
          </Card>
        )}

        {/* ---------------- SAMPLER ---------------- */}
        {kind === 'sample' && tab === 'sample' && (
          <Card title="SAMPLE">
            <SamplePeaks sampleId={synth.sampleId} width={inner} />
            <ScrollView style={s.sampleList} nestedScrollEnabled>
              {samples.length === 0 && <Txt style={[s.note, { padding: 12 }]}>Lade zuerst ein Sample in die Bibliothek (z. B. eine Kick, einen Hat oder einen Bass-Ton).</Txt>}
              {samples.map((x) => (
                <Pressable
                  key={x.id}
                  accessibilityLabel={`Instrument-Sample ${x.name}`}
                  accessibilityState={{ selected: synth.sampleId === x.id }}
                  onPress={() => {
                    set({ sampleId: x.id });
                    hear({ ...synth, sampleId: x.id }, synth.sampleRoot ?? 60);
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
            <KnobRow>
              <Knob label="Root" value={synth.sampleRoot ?? 60} min={24} max={96} step={1} reset={60} format={(v) => noteName(Math.round(v))} onChange={(v) => set({ sampleRoot: v })} />
              <Knob label="Tune" value={synth.tune ?? 0} min={-100} max={100} step={1} reset={0} format={CT} onChange={(v) => set({ tune: v })} />
              <Knob label="Gain" value={synth.gainDb ?? 0} min={-24} max={6} step={0.5} reset={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} dB`} onChange={(v) => set({ gainDb: v })} />
            </KnobRow>
            <Txt style={[s.note, { marginTop: 4 }]}>Root: die Note, auf der das Sample original klingt. Alle anderen Noten spielen es höher oder tiefer.</Txt>
            <View style={s.chips}>
              <Chip variant={synth.oneShot ? 'on' : 'ghost'} onPress={() => set({ oneShot: true })}>
                Ganz abspielen
              </Chip>
              <Chip variant={synth.oneShot ? 'ghost' : 'on'} onPress={() => set({ oneShot: false })}>
                Notenlänge
              </Chip>
            </View>
          </Card>
        )}

        {/* ---------------- FILTER (synth, sampler, noise) ---------------- */}
        {tab === 'filter' && (
          <Card title="FILTER">
            <FilterScope type={filterType} cutoff={synth.cutoff} resonance={synth.resonance} envOctaves={kind === 'synth' ? synth.filterEnv : 0} width={inner} />
            {kind === 'synth' && (
              <View style={s.chips}>
                {FILTERS.map((f) => (
                  <Chip key={f.type} variant={filterType === f.type ? 'on' : 'ghost'} onPress={() => set({ filterType: f.type })}>
                    {f.label}
                  </Chip>
                ))}
              </View>
            )}
            <KnobRow>
              <Knob label={kind === 'noise' ? 'Highpass' : 'Cutoff'} value={synth.cutoff} min={40} max={16000} curve="log" format={HZ} onChange={(v) => set({ cutoff: Math.round(v) })} />
              <Knob label="Reso" value={synth.resonance} min={0.5} max={20} step={0.1} reset={1} format={(v) => (filterType === 'bandpass' ? `Q ${v.toFixed(1)}` : `${v.toFixed(1)} dB`).replace('.', ',')} onChange={(v) => set({ resonance: v })} />
              {kind === 'synth' && <Knob label="Env" value={synth.filterEnv ?? 0} min={0} max={5} step={0.1} reset={0} format={(v) => (v ? `${v.toFixed(1).replace('.', ',')} Okt` : 'Aus')} onChange={(v) => set({ filterEnv: v })} />}
              {kind === 'synth' && !!synth.filterEnv && <Knob label="Decay" value={synth.filterDecay ?? 0.25} min={0.02} max={1.5} curve="log" format={SECOND} onChange={(v) => set({ filterDecay: Math.round(v * 100) / 100 })} />}
            </KnobRow>
            {kind === 'synth' && !!synth.filterEnv && (
              <>
                <Txt style={[s.note, { marginTop: 8, marginBottom: 6 }]}>Filter-Hüllkurve: der Cutoff startet höher und fällt zurück.</Txt>
                <FilterEnvMini cutoff={synth.cutoff} octaves={synth.filterEnv} decay={synth.filterDecay ?? 0.25} width={inner} />
              </>
            )}
          </Card>
        )}

        {/* ---------------- ENVELOPE (all) ---------------- */}
        {tab === 'env' && (
          <Card title="AMP-HÜLLKURVE">
            <EnvScope attack={synth.attack} decay={synth.decay} sustain={synth.sustain} release={synth.release} width={inner} />
            <KnobRow>
              <Knob label="Attack" value={synth.attack} min={0.001} max={2} curve="log" format={SECOND} onChange={(v) => set({ attack: v })} />
              <Knob label="Decay" value={synth.decay} min={0.01} max={1.5} curve="log" format={SECOND} onChange={(v) => set({ decay: v })} />
              <Knob label="Sustain" value={synth.sustain} min={0} max={1} format={PCT} onChange={(v) => set({ sustain: v })} />
              <Knob label="Release" value={synth.release} min={0.005} max={2.5} curve="log" format={SECOND} onChange={(v) => set({ release: v })} />
            </KnobRow>
            {kind !== 'synth' && kind !== 'sample' && (
              <KnobRow>
                <Knob label="Gain" value={synth.gainDb ?? 0} min={-24} max={6} step={0.5} reset={0} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} dB`} onChange={(v) => set({ gainDb: v })} />
              </KnobRow>
            )}
          </Card>
        )}

        {/* ---------------- FX = the track's sound effects ---------------- */}
        {tab === 'fx' && (
          <Card title="EFFEKTE DER SPUR">
            <KnobRow>
              <Knob label="Drive" value={fx.drive} min={0} max={1} reset={0} format={PCT} onChange={(v) => setFx({ drive: Math.round(v * 100) / 100 })} />
              <Knob label="Reverb" value={fx.reverb} min={0} max={1} reset={0} format={PCT} onChange={(v) => setFx({ reverb: Math.round(v * 100) / 100 })} />
              <Knob label="Delay" value={fx.delay} min={0} max={1} reset={0} format={PCT} onChange={(v) => setFx({ delay: Math.round(v * 100) / 100 })} />
              <Knob label="Pump" value={fx.pump} min={0} max={1} reset={0} format={PCT} onChange={(v) => setFx({ pump: Math.round(v * 100) / 100 })} />
            </KnobRow>
            <Txt style={[s.note, { marginTop: 6 }]}>Pump duckt die Spur auf jedem Beat wie ein Sidechain zur Kick. Doppeltippen setzt einen Regler zurück.</Txt>
          </Card>
        )}

        <Card title="TASTATUR">
          <Keys low={keysLow} onLow={setKeysLow} color={C.accent} onKey={(p) => hear(synth, p)} />
        </Card>

        <View style={s.chips}>
          <Btn kind="primary" onPress={() => hear(synth, auditionPitch)}>
            Anhören
          </Btn>
          <Btn onPress={() => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, synth: undefined })))}>Zurücksetzen</Btn>
        </View>
      </View>
    </Sheet>
  );
}

/** The four oscillator waves as small pictures to tap. */
function WavePick({ value, color, onPick }: { value: OscWave; color: string; onPick: (w: OscWave) => void }) {
  return (
    <View style={s.waves}>
      {WAVES.map((w) => (
        <Pressable key={w} accessibilityLabel={`Wellenform ${WAVE_NAMES[w]}`} accessibilityState={{ selected: value === w }} onPress={() => onPick(w)} style={[s.wave, value === w && { borderColor: color, backgroundColor: '#1a1a1f' }]}>
          <WaveGlyph wave={w} color={value === w ? color : C.muted} />
          <Txt style={[s.waveName, value === w && { color }]}>{WAVE_NAMES[w]}</Txt>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  switcher: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  nameBox: { flex: 1, backgroundColor: '#111114', borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  name: { ...font(700), fontSize: 15, color: C.accent },
  nameSub: { ...font(400), fontSize: 11, color: C.muted, marginTop: 1 },
  cap: { ...font(700), fontSize: 10, letterSpacing: 1.4, color: C.muted, marginBottom: 6 },
  tiles: { flexDirection: 'row', gap: 6 },
  tile: { flex: 1, backgroundColor: '#111114', borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 6, alignItems: 'center' },
  tileOn: { borderColor: C.accent, backgroundColor: 'rgba(198,255,61,0.07)' },
  tileTitle: { ...font(700), fontSize: 13 },
  tileSub: { ...font(400), fontSize: 9.5, color: C.muted, marginTop: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  list: { marginTop: 10, borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: 'hidden' },
  row: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line },
  rowOn: { backgroundColor: 'rgba(198,255,61,0.08)' },
  rowName: { fontSize: 14, ...font(600) },
  rowHint: { color: C.muted, fontSize: 11.5, marginTop: 2 },
  sampleList: { maxHeight: 150, marginTop: 10, borderWidth: 1, borderColor: C.line, borderRadius: 10 },
  sampleRow: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line },
  waves: { flexDirection: 'row', gap: 6, marginTop: 10 },
  wave: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingVertical: 4 },
  waveName: { ...mono(), fontSize: 9, color: C.muted, marginTop: -2 },
  note: { color: C.muted, fontSize: 12, lineHeight: 17 },
});
