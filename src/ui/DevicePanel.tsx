import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { echoSeconds } from '../audio/devicemath';
import { DEVICE_DEFS, deviceSummary, GROUP_LABELS, GROUP_ORDER, MAX_DEVICES, deviceParams, formatParam, type ParamDef } from '../audio/devices';
import { DEVICE_PRESETS, presetOf, presetParams } from '../audio/devicepresets';
import { presetById } from '../audio/presets';
import { C, font } from '../constants/theme';
import { addDevice, moveDevice, removeDevice, trackKind, trackSynth, updateDevice } from '../lib/project';
import { setState, toast, updateProject, useStore } from '../lib/store';
import type { Device, DeviceType, Track } from '../types';
import { Close } from './icons';
import { Btn, Chip, Txt } from './kit';
import { Sheet } from './Sheet';
import { SpliceSearch } from './SpliceSearch';
import { Card } from './synth/Tabs';
import { Knob, KnobRow } from './synth/Knob';
import { CompScope, EchoScope, EqScope, LimiterScope, ReverbScope, SatScope } from './synth/DeviceScopes';
import { FilterScope } from './synth/Scopes';
import type { FilterKind } from '../audio/scopes';

/** Rows of knobs per device (default: all parameters in one wrapping row). */
const LAYOUT: Partial<Record<DeviceType, { title?: string; keys: string[] }[]>> = {
  eq: [
    { title: 'SCHNITT', keys: ['hp', 'lp'] },
    { title: 'BASS', keys: ['lsF', 'lsG'] },
    { title: 'MITTE 1', keys: ['p1F', 'p1G', 'p1Q'] },
    { title: 'MITTE 2', keys: ['p2F', 'p2G', 'p2Q'] },
    { title: 'HÖHEN', keys: ['hsF', 'hsG'] },
  ],
};

/** Parameters that only make sense in some states of the device. */
function visible(type: DeviceType, key: string, p: Record<string, number>): boolean {
  if (type === 'echo' && key === 'division') return p.sync >= 0.5;
  if (type === 'echo' && key === 'time') return p.sync < 0.5;
  if (type === 'filter' && key === 'lfoRate') return p.lfoDepth > 0;
  return true;
}

/** Folded cards, kept while the app runs so the panel opens the way you left it (replaced, never mutated: React state). */
let persistedFolded: ReadonlySet<string> = new Set();

const SCOPE_FILTER: FilterKind[] = ['lowpass', 'highpass', 'bandpass'];

/**
 * The device chain of the selected track, like the device view of a DAW: the instrument (MIDI tracks) or the
 * clips, then the effects in signal order, each with a live picture and knobs. Effects can be bypassed,
 * moved and removed; everything happens on the running mix without restarting playback.
 */
export function DevicePanel() {
  const track = useStore((st) => st.project.tracks.find((t) => t.id === st.selectedTrackId));
  const bpm = useStore((st) => st.project.bpm);
  const [width, setWidth] = useState(330);
  const [adding, setAdding] = useState(false);
  const [folded, setFoldedState] = useState<ReadonlySet<string>>(persistedFolded);
  const setFolded = (next: Set<string>) => {
    persistedFolded = next;
    setFoldedState(next);
  };
  if (!track) {
    return (
      <Sheet title="Geräte">
        <Txt style={s.note}>Wähle im Arrangement eine Spur aus.</Txt>
      </Sheet>
    );
  }
  const trackId = track.id;
  const devices = track.devices ?? [];
  const kind = trackKind(track);
  const inner = Math.max(200, width - 26);
  const toggle = (id: string) => {
    const next = new Set(folded);
    if (!next.delete(id)) next.add(id);
    setFolded(next);
  };
  const foldAll = (fold: boolean) => {
    const next = new Set(folded);
    for (const d of devices) {
      if (fold) next.add(d.id);
      else next.delete(d.id);
    }
    setFolded(next);
  };
  const allFolded = devices.length > 0 && devices.every((d) => folded.has(d.id));

  const change = (id: string, patch: { on?: boolean; params?: Record<string, number> }) => updateProject((p) => updateDevice(p, trackId, id, patch), { reschedule: false });
  const add = (type: DeviceType) => {
    if (devices.length >= MAX_DEVICES) {
      toast(`Mehr als ${MAX_DEVICES} Geräte pro Spur sind nicht möglich.`);
      return;
    }
    updateProject((p) => addDevice(p, trackId, type), { reschedule: false });
    setAdding(false);
  };

  return (
    <Sheet title="Geräte">
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <Txt style={s.sub}>{`${track.name} · ${kind === 'midi' ? 'MIDI-Spur' : 'Audio-Spur'}`}</Txt>

        <Source track={track} kind={kind} />

        {devices.length > 1 && (
          <View style={s.foldRow}>
            <Chip onPress={() => foldAll(!allFolded)} textStyle={{ fontSize: 12 }}>
              {allFolded ? 'Alle ausklappen' : 'Alle einklappen'}
            </Chip>
          </View>
        )}

        {devices.map((d, i) => (
          <DeviceCard key={d.id} track={track} device={d} folded={folded.has(d.id)} onToggle={() => toggle(d.id)} index={i} count={devices.length} bpm={bpm} width={inner} onChange={(patch) => change(d.id, patch)} onMove={(delta) => updateProject((p) => moveDevice(p, trackId, d.id, delta), { reschedule: false })} onRemove={() => updateProject((p) => removeDevice(p, trackId, d.id), { reschedule: false })} />
        ))}

        {devices.length === 0 && <Txt style={[s.note, { marginBottom: 10 }]}>Noch keine Effekte. Füge Geräte hinzu: EQ, Compressor, Saturator, Echo, Reverb ...</Txt>}

        {adding ? (
          <Card title="GERÄT HINZUFÜGEN" right={<Chip onPress={() => setAdding(false)}>Abbrechen</Chip>}>
            {GROUP_ORDER.map((g) => (
              <View key={g} style={{ marginTop: 6 }}>
                <Txt style={s.cap}>{GROUP_LABELS[g].toUpperCase()}</Txt>
                {Object.values(DEVICE_DEFS)
                  .filter((d) => d.group === g)
                  .map((d) => (
                    <Pressable key={d.type} accessibilityLabel={`Gerät ${d.label} hinzufügen`} onPress={() => add(d.type)} style={s.pick}>
                      <Txt style={s.pickName}>{d.label}</Txt>
                      <Txt style={s.pickBlurb}>{d.blurb}</Txt>
                    </Pressable>
                  ))}
              </View>
            ))}
          </Card>
        ) : (
          <Btn kind="primary" accessibilityLabel="Gerät hinzufügen" onPress={() => setAdding(true)}>
            + Gerät hinzufügen
          </Btn>
        )}
        <Txt style={[s.note, { marginTop: 12 }]}>Die Geräte arbeiten in dieser Reihenfolge, danach folgen DJ-Filter, Drive, Pan und der Fader der Spur. Sends (Reverb, Delay) hängen hinter dem Fader.</Txt>
      </View>
    </Sheet>
  );
}

/** The first slot of the chain: what makes the sound (the instrument or the audio clips). */
function Source({ track, kind }: { track: Track; kind: 'audio' | 'midi' }) {
  if (kind === 'audio') {
    return (
      <View style={s.source}>
        <View style={{ flex: 1 }}>
          <Txt style={s.sourceName}>Audio-Clips</Txt>
          <Txt style={s.sourceSub}>{`${track.clips.length} ${track.clips.length === 1 ? 'Clip' : 'Clips'} auf dieser Spur`}</Txt>
        </View>
      </View>
    );
  }
  const synth = trackSynth(track);
  const preset = presetById(synth.preset);
  const name = preset ? preset.name : synth.wave === 'sample' ? 'Sampler' : synth.wave === 'kick' ? 'Synth-Kick' : synth.wave === 'noise' ? 'Noise / Hat' : track.synth ? 'Eigener Sound' : 'Standard-Synth';
  const type = synth.wave === 'sample' ? 'Sampler' : synth.wave === 'kick' || synth.wave === 'noise' ? 'Drum-Synth' : synth.wave === 'kit909' ? '909 Kit' : 'Synth';
  return (
    <Pressable accessibilityLabel="Instrument öffnen" onPress={() => setState({ panel: 'instrument' })} style={[s.source, { borderColor: C.accent }]}>
      <View style={{ flex: 1 }}>
        <Txt style={[s.sourceName, { color: C.accent }]}>{name}</Txt>
        <Txt style={s.sourceSub}>{`Instrument · ${type}`}</Txt>
      </View>
      <Txt style={s.open}>Öffnen ›</Txt>
    </Pressable>
  );
}

function DeviceCard({ track, device, folded: isFolded, onToggle, index, count, bpm, width, onChange, onMove, onRemove }: { track: Track; device: Device; folded: boolean; onToggle: () => void; index: number; count: number; bpm: number; width: number; onChange: (p: { on?: boolean; params?: Record<string, number> }) => void; onMove: (delta: number) => void; onRemove: () => void }) {
  const [listOpen, setListOpen] = useState(false);
  const def = DEVICE_DEFS[device.type];
  if (!def) return null;
  const p = deviceParams(device);
  const presets = DEVICE_PRESETS[device.type];
  const current = presetOf(device);
  const pick = (i: number) => {
    const next = presets[(i + presets.length) % presets.length];
    onChange({ params: presetParams(device.type, next) });
  };
  const at = current ? presets.indexOf(current) : -1;
  const set = (key: string, v: number) => onChange({ params: { [key]: v } });
  const dim = !device.on;
  const rows = LAYOUT[device.type] ?? [{ keys: def.params.map((x) => x.key) }];
  const byKey = new Map(def.params.map((x) => [x.key, x]));

  const header = (
    <View style={s.controls}>
      {device.type !== 'splice' && (
        <Chip variant={device.on ? 'on' : 'ghost'} onPress={() => onChange({ on: !device.on })} textStyle={{ fontSize: 11 }}>
          {device.on ? 'AN' : 'AUS'}
        </Chip>
      )}
      <Pressable accessibilityLabel={`${def.label} nach vorne`} disabled={index === 0} onPress={() => onMove(-1)} style={[s.small, index === 0 && s.disabled]}>
        <Txt style={s.smallText}>▲</Txt>
      </Pressable>
      <Pressable accessibilityLabel={`${def.label} nach hinten`} disabled={index === count - 1} onPress={() => onMove(1)} style={[s.small, index === count - 1 && s.disabled]}>
        <Txt style={s.smallText}>▼</Txt>
      </Pressable>
      <Pressable accessibilityLabel={`${def.label} entfernen`} onPress={onRemove} style={s.small}>
        <Close size={14} />
      </Pressable>
    </View>
  );

  const control = (def: ParamDef) => {
    if (!visible(device.type, def.key, p)) return null;
    if (def.unit === 'enum' || def.unit === 'switch') {
      return (
        <View key={def.key} style={s.choice}>
          <Txt style={s.cap}>{def.label.toUpperCase()}</Txt>
          <View style={s.chips}>
            {def.options!.map((o, i) => (
              <Chip key={o} variant={Math.round(p[def.key]) === i ? 'on' : 'ghost'} onPress={() => set(def.key, i)} textStyle={{ fontSize: 12 }}>
                {o}
              </Chip>
            ))}
          </View>
        </View>
      );
    }
    return <Knob key={def.key} label={def.label} value={p[def.key]} min={def.min} max={def.max} curve={def.curve} step={def.step} reset={def.def} format={(v) => formatParam(def, v)} onChange={(v) => set(def.key, v)} />;
  };

  return (
    <View style={dim && { opacity: 0.55 }}>
      <View style={s.card}>
        <View style={s.cardHead}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${def.label} ${isFolded ? 'ausklappen' : 'einklappen'}`} accessibilityState={{ expanded: !isFolded }} onPress={onToggle} style={s.titleBox}>
            <Txt style={s.chevron}>{isFolded ? '▸' : '▾'}</Txt>
            <View style={{ flex: 1 }}>
              <Txt style={s.cardTitle}>{def.label.toUpperCase()}</Txt>
              {isFolded && (
                <Txt numberOfLines={1} style={s.summary}>
                  {current && current.id !== 'default' ? current.name : deviceSummary(device)}
                </Txt>
              )}
            </View>
          </Pressable>
          {header}
        </View>
        {!isFolded && device.type === 'splice' && (
          <View style={{ marginTop: 8 }}>
            <SpliceSearch track={track} />
          </View>
        )}
        {!isFolded && device.type !== 'splice' && (
          <>
            <View style={s.presetRow}>
              <Pressable accessibilityLabel={`${def.label} vorheriges Preset`} onPress={() => pick(at < 0 ? presets.length - 1 : at - 1)} style={s.small}>
                <Txt style={s.smallText}>◀</Txt>
              </Pressable>
              <Pressable accessibilityLabel={`${def.label} Presets`} onPress={() => setListOpen((v) => !v)} style={s.presetName}>
                <Txt numberOfLines={1} style={[s.presetText, !current && { color: C.muted }]}>
                  {current ? current.name : 'Eigene Einstellung'}
                </Txt>
              </Pressable>
              <Pressable accessibilityLabel={`${def.label} nächstes Preset`} onPress={() => pick(at + 1)} style={s.small}>
                <Txt style={s.smallText}>▶</Txt>
              </Pressable>
            </View>
            {listOpen && (
              <View style={s.presetList}>
                {presets.map((preset, i) => (
                  <Chip
                    key={preset.id}
                    variant={current?.id === preset.id ? 'on' : 'ghost'}
                    onPress={() => {
                      pick(i);
                      setListOpen(false);
                    }}
                    textStyle={{ fontSize: 12 }}
                  >
                    {preset.name}
                  </Chip>
                ))}
              </View>
            )}
            <Scope device={device} p={p} bpm={bpm} width={width} />
            {rows.map((row, i) => (
              <View key={i}>
                {row.title && <Txt style={[s.cap, { marginTop: 8 }]}>{row.title}</Txt>}
                <KnobRow>{row.keys.map((k) => byKey.get(k)).filter((x): x is ParamDef => !!x).map(control)}</KnobRow>
              </View>
            ))}
          </>
        )}
      </View>
    </View>
  );
}

/** The live picture of a device (none for the plain ones). */
function Scope({ device, p, bpm, width }: { device: Device; p: Record<string, number>; bpm: number; width: number }) {
  switch (device.type) {
    case 'eq':
      return <EqScope params={p} width={width} />;
    case 'comp':
      return <CompScope threshold={p.threshold} ratio={p.ratio} knee={p.knee} makeup={p.makeup} width={width} />;
    case 'sat':
      return <SatScope mode={p.mode} drive={p.drive} width={width} />;
    case 'echo':
      return <EchoScope seconds={echoSeconds(p as { sync: number; division: number; time: number }, bpm)} feedback={p.feedback} pingpong={p.pingpong >= 0.5} width={width} />;
    case 'reverb':
      return <ReverbScope size={p.size} width={width} />;
    case 'filter':
      return <FilterScope type={SCOPE_FILTER[Math.round(p.type)] ?? 'lowpass'} cutoff={p.cutoff} resonance={p.type === 2 ? 0.5 + p.res * 0.6 : p.res} width={width} />;
    case 'limiter':
      return <LimiterScope gain={p.gain} ceiling={p.ceiling} width={width} />;
    default:
      return null;
  }
}

const s = StyleSheet.create({
  sub: { ...font(400), fontSize: 12, color: C.muted, marginBottom: 10 },
  presetRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  presetName: { flex: 1, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: '#0c0c0e', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  presetText: { ...font(600), fontSize: 13, color: C.accent },
  presetList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  foldRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 },
  card: { backgroundColor: '#111114', borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, marginBottom: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 36 },
  titleBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  chevron: { fontSize: 14, color: C.accent, width: 14 },
  cardTitle: { ...font(700), fontSize: 10.5, letterSpacing: 1.4, color: C.muted },
  summary: { ...font(400), fontSize: 11.5, color: C.text, marginTop: 2 },
  note: { color: C.muted, fontSize: 12, lineHeight: 17 },
  cap: { ...font(700), fontSize: 10, letterSpacing: 1.4, color: C.muted, marginBottom: 4 },
  source: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111114', borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, marginBottom: 10 },
  sourceName: { ...font(700), fontSize: 15 },
  sourceSub: { ...font(400), fontSize: 11, color: C.muted, marginTop: 2 },
  open: { ...font(600), fontSize: 12, color: C.accent },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  small: { width: 30, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  smallText: { fontSize: 11, color: C.text },
  disabled: { opacity: 0.35 },
  choice: { width: '100%', marginVertical: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pick: { paddingVertical: 9, paddingHorizontal: 10, borderWidth: 1, borderColor: C.line, borderRadius: 10, marginBottom: 6 },
  pickName: { ...font(700), fontSize: 14 },
  pickBlurb: { color: C.muted, fontSize: 11.5, marginTop: 2 },
});
