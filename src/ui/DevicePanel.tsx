import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextStyle } from 'react-native';
import { echoSeconds } from '../audio/devicemath';
import { DEVICE_DEFS, deviceSummary, GROUP_LABELS, GROUP_ORDER, MAX_DEVICES, deviceParams, formatParam, type ParamDef } from '../audio/devices';
import { DEVICE_PRESETS, presetOf, presetParams } from '../audio/devicepresets';
import { presetById } from '../audio/presets';
import { C, font, mono } from '../constants/theme';
import { MASTER_ID, addDevice, copyDevices, moveDevice, removeDevice, trackKind, trackSynth, updateDevice } from '../lib/project';
import { getState, setState, toast, updateProject, useStore } from '../lib/store';
import { loadSampleIntoSampler } from '../lib/actions';
import { addDeviceFrom, deleteDevicePreset, loadSound, saveDevicePreset } from '../lib/browserActions';
import { reorderTarget } from '../lib/trackReorder';
import { freePresetName, userPresetOf, type UserDevicePreset } from '../lib/userPresets';
import type { Device, DeviceType, Track, TrackKind } from '../types';
import { Close } from './icons';
import { Chip, Txt } from './kit';
import { useDropTarget } from './dnd';
import { useDrag, web } from './drag';
import { openBrowserAt } from './commands';
import { Sheet } from './Sheet';
import { PluginFrame, SKIN } from './skin';
import { SpliceSearch } from './SpliceSearch';
import { ArpCard, CARD_W_FX, InstrumentCard, SeqCard } from './ChainCards';
import { Card } from './synth/Tabs';
import { Knob, KnobRow } from './synth/Knob';
import { CompScope, CycleScope, EchoScope, EqScope, LimiterScope, ReverbScope, SatScope, TransientScope } from './synth/DeviceScopes';
import { KICKSTART_CURVES, RHYTHM_RATES, SHAPER_SHAPES, SHAPER_TARGETS, kickstartCurve, shaperShape } from '../audio/rhythmmath';
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
let persistedFolded: ReadonlySet<string> = new Set(['arp', 'seq']); // the MIDI effects start folded: they are off until you want them

const SCOPE_FILTER: FilterKind[] = ['lowpass', 'highpass', 'bandpass'];

/**
 * The device chain of the selected track, like the device view of a DAW: the instrument (MIDI tracks) or the
 * clips, then the effects in signal order, each with a live picture and knobs. Effects can be bypassed,
 * moved and removed; everything happens on the running mix without restarting playback.
 */
const CARD_W = CARD_W_FX;
/** A folded device in the chain is a slim strip with its name on its side (Live). */
const FOLD_W = 34;
const GAP = 8;

export function DevicePanel() {
  const forMaster = useStore((st) => st.devicesFor === 'master');
  const selected = useStore((st) => st.project.tracks.find((t) => t.id === st.selectedTrackId));
  const masterDevices = useStore((st) => st.project.master?.devices);
  // The master bus shows as a track without clips: same cards, same functions (MASTER_ID in project.ts).
  const track: Track | undefined = forMaster ? { id: MASTER_ID, name: 'Master', category: 'other', color: C.accent, volume: 1, muted: false, solo: false, clips: [], slots: [], kind: 'audio', devices: masterDevices } : selected;
  const bpm = useStore((st) => st.project.bpm);
  const [width, setWidth] = useState(330);
  const [adding, setAdding] = useState(false);
  const [copying, setCopying] = useState(false);
  const [replace, setReplace] = useState(false);
  const allTracks = useStore((st) => st.project.tracks);
  const [folded, setFoldedState] = useState<ReadonlySet<string>>(persistedFolded);
  // A device dragged by its grip along the chain: where it is and how far it moved (it lands on release).
  const [moving, setMoving] = useState<{ id: string; dx: number } | null>(null);
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
  // A wide detail view (desktop) lays the chain out left to right like Live's device view.
  const chain = width > 760;
  const inner = chain ? CARD_W - 18 : Math.max(200, width - 26);
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
  const copyTo = (toId: string, name: string) => {
    const had = (toId === MASTER_ID ? getState().project.master?.devices?.length : getState().project.tracks.find((t) => t.id === toId)?.devices?.length) ?? 0;
    updateProject((p) => copyDevices(p, trackId, toId, replace ? 'replace' : 'append'), { reschedule: false });
    const now = (toId === MASTER_ID ? getState().project.master?.devices?.length : getState().project.tracks.find((t) => t.id === toId)?.devices?.length) ?? 0;
    toast(now === had && !replace ? `„${name}“ hat schon ${MAX_DEVICES} Geräte, nichts kopiert.` : `Effektkette auf „${name}“ kopiert (${devices.length} Gerät${devices.length === 1 ? '' : 'e'}${replace ? ', ersetzt' : ', angehängt'}).`);
    setCopying(false);
  };
  const allFolded = devices.length > 0 && devices.every((d) => folded.has(d.id));
  const widths = devices.map((d) => (folded.has(d.id) ? FOLD_W : CARD_W_FX) + GAP);
  const movingFrom = moving ? devices.findIndex((d) => d.id === moving.id) : -1;
  const movingTo = moving && movingFrom >= 0 ? reorderTarget(widths, movingFrom, moving.dx) : -1;
  const drag = (id: string, dx: number, phase: 'move' | 'end' | 'cancel') => {
    if (phase === 'cancel') return setMoving(null);
    if (phase === 'move') return setMoving({ id, dx });
    const from = devices.findIndex((d) => d.id === id);
    const to = reorderTarget(widths, from, dx);
    setMoving(null);
    if (from >= 0 && to !== from) updateProject((p) => moveDevice(p, trackId, id, to - from), { reschedule: false });
  };
  // "+ Gerät": on a wide web screen the browser opens on its Audio-Effekte (Live's way: pick there, or drag into the chain).
  const browse = Platform.OS === 'web' && chain;
  const plus = () => (browse ? openBrowserAt('fx') : setAdding(!adding));

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
    <Sheet title={chain ? `Geräte · ${forMaster ? 'Master' : track.name}` : 'Geräte'} compact={chain}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {!chain && <Txt style={s.sub}>{forMaster ? 'Master · Summe aller Spuren, vor dem Sicherheits-Limiter' : `${track.name} · ${kind === 'midi' ? 'MIDI-Spur' : kind === 'group' ? 'Gruppe' : 'Audio-Spur'}`}</Txt>}

        {!forMaster && !chain && <Source track={track} kind={kind} />}

        {chain && (
          <View style={s.toolbar}>
            <Chip variant={adding ? 'on' : 'ghost'} onPress={plus} textStyle={{ fontSize: 11 }} accessibilityLabel="Gerät hinzufügen">
              + Gerät
            </Chip>
            {devices.length > 0 && (
              <Chip variant={copying ? 'on' : 'ghost'} onPress={() => setCopying(!copying)} textStyle={{ fontSize: 11 }} accessibilityLabel="Effektkette kopieren">
                Kette kopieren
              </Chip>
            )}
            {devices.length > 1 && (
              <Chip onPress={() => foldAll(!allFolded)} textStyle={{ fontSize: 11 }}>
                {allFolded ? 'Alle ausklappen' : 'Alle einklappen'}
              </Chip>
            )}
          </View>
        )}

        {!chain && devices.length > 0 && (
          <View style={s.foldRow}>
            <Chip variant={copying ? 'on' : 'ghost'} onPress={() => setCopying(!copying)} textStyle={{ fontSize: 12 }} accessibilityLabel="Effektkette kopieren">
              Kette kopieren auf …
            </Chip>
          </View>
        )}
        {copying && (
          <View style={[s.foldRow, { flexWrap: 'wrap' }]}>
            <Chip variant={!replace ? 'on' : 'ghost'} onPress={() => setReplace(false)} textStyle={{ fontSize: 12 }}>
              Anhängen
            </Chip>
            <Chip variant={replace ? 'on' : 'ghost'} onPress={() => setReplace(true)} textStyle={{ fontSize: 12 }}>
              Ersetzen
            </Chip>
            {allTracks.filter((t) => t.id !== trackId).map((t) => (
              <Chip key={t.id} onPress={() => copyTo(t.id, t.name)} textStyle={{ fontSize: 12 }} accessibilityLabel={`Kette auf ${t.name} kopieren`}>
                {t.name}
              </Chip>
            ))}
            {!forMaster && (
              <Chip onPress={() => copyTo(MASTER_ID, 'Master')} textStyle={{ fontSize: 12 }}>
                Master
              </Chip>
            )}
          </View>
        )}

        {!chain && devices.length > 1 && (
          <View style={s.foldRow}>
            <Chip onPress={() => foldAll(!allFolded)} textStyle={{ fontSize: 12 }}>
              {allFolded ? 'Alle ausklappen' : 'Alle einklappen'}
            </Chip>
          </View>
        )}

        <ScrollView horizontal scrollEnabled={chain} contentContainerStyle={chain ? s.chain : s.stack} style={!chain && { overflow: 'visible' }}>
          {chain && !forMaster && kind === 'midi' && (
            <>
              <ArpCard track={track} folded={folded.has('arp')} onFold={() => toggle('arp')} />
              <SeqCard track={track} folded={folded.has('seq')} onFold={() => toggle('seq')} />
              <InstrumentCard track={track} folded={folded.has('inst')} onFold={() => toggle('inst')} />
            </>
          )}
          {chain && !forMaster && kind === 'audio' && (
            <View style={{ width: 150 }}>
              <Source track={track} kind={kind} fill />
            </View>
          )}
          {devices.map((d, i) => {
            const isMoving = moving?.id === d.id;
            // The slot the dragged device would land in shows a lime edge on the side it would go to.
            const mark = moving && !isMoving && i === movingTo ? (movingTo > movingFrom ? s.markRight : s.markLeft) : null;
            return (
              <View key={d.id} style={[chain ? { width: folded.has(d.id) ? FOLD_W : CARD_W_FX } : { alignSelf: 'stretch' }, isMoving && s.moving, isMoving && { transform: [{ translateX: moving.dx }] }, mark]}>
                <DeviceCard compact={chain} track={track} device={d} folded={folded.has(d.id)} onToggle={() => toggle(d.id)} index={i} count={devices.length} bpm={bpm} width={inner} onChange={(patch) => change(d.id, patch)} onMove={(delta) => updateProject((p) => moveDevice(p, trackId, d.id, delta), { reschedule: false })} onDrag={(dx, phase) => drag(d.id, dx, phase)} onRemove={() => updateProject((p) => removeDevice(p, trackId, d.id), { reschedule: false })} />
              </View>
            );
          })}
          {chain && adding && (
            <View style={{ width: 260 }}>
              <PickList forMaster={forMaster} onPick={add} onCancel={() => setAdding(false)} />
            </View>
          )}
          {chain && <ChainDrop trackId={trackId} empty={!devices.length} onPlus={plus} />}
        </ScrollView>

        {!chain && devices.length === 0 && <Txt style={[s.note, { marginBottom: 10 }]}>Noch keine Effekte. Füge Geräte hinzu: EQ, Compressor, Saturator, Echo, Reverb ...</Txt>}

        {!chain &&
          (adding ? (
            <PickList forMaster={forMaster} onPick={add} onCancel={() => setAdding(false)} />
          ) : (
            <ChainDrop trackId={trackId} empty={!devices.length} onPlus={() => setAdding(true)} wide />
          ))}
        {!chain && <Txt style={[s.note, { marginTop: 12 }]}>
          {forMaster
            ? 'Die Master-Geräte bearbeiten die ganze Summe (auch Hall und Echo), danach kommt nur noch der Sicherheits-Limiter. Sie stecken auch im Export.'
            : 'Die Geräte arbeiten in dieser Reihenfolge, danach folgen DJ-Filter, Drive, Pan und der Fader der Spur. Sends (Reverb, Delay) hängen hinter dem Fader.'}
        </Txt>}
      </View>
    </Sheet>
  );
}

/** The list of devices to add. */
function PickList({ forMaster, onPick, onCancel }: { forMaster: boolean; onPick: (type: DeviceType) => void; onCancel: () => void }) {
  return (
    <Card title="GERÄT HINZUFÜGEN" right={<Chip onPress={onCancel}>Abbrechen</Chip>}>
      {GROUP_ORDER.map((g) => (
        <View key={g} style={{ marginTop: 6 }}>
          <Txt style={s.cap}>{GROUP_LABELS[g].toUpperCase()}</Txt>
          {Object.values(DEVICE_DEFS)
            .filter((d) => d.group === g && !(forMaster && d.type === 'splice'))
            .map((d) => (
              <Pressable key={d.type} accessibilityLabel={`Gerät ${d.label} hinzufügen`} onPress={() => onPick(d.type)} style={s.pick}>
                <Txt style={s.pickName}>{d.label}</Txt>
                <Txt style={s.pickBlurb}>{d.blurb}</Txt>
              </Pressable>
            ))}
        </View>
      ))}
    </Card>
  );
}

/**
 * The end of the chain, like Live's "Drop Audio Effects Here": an effect dragged from the browser lands here (at the end), and "+" opens
 * the browser's Audio-Effekte (web, wide) or the list of devices.
 */
function ChainDrop({ trackId, empty, onPlus, wide }: { trackId: string; empty: boolean; onPlus: () => void; wide?: boolean }) {
  const drop = useDropTarget(`chain:${trackId}`, { device: (p) => addDeviceFrom(p.device, { presetId: p.presetId, trackId }) });
  return (
    <View ref={drop.ref} style={[wide ? s.dropWide : s.drop, drop.dragging && s.dropLive, drop.over && s.dropOver]}>
      <Pressable accessibilityLabel="Gerät hinzufügen" onPress={onPlus} style={s.dropPlus}>
        <Txt style={s.dropPlusText}>+</Txt>
      </Pressable>
      <Txt style={s.dropText}>{drop.over ? 'Loslassen: Effekt hier einfügen' : empty ? 'Audio-Effekte hierher ziehen oder + tippen' : 'Effekte hierher ziehen'}</Txt>
    </View>
  );
}

/** The first slot of the chain: what makes the sound (the instrument or the audio clips). */
function Source({ track, kind, fill }: { track: Track; kind: TrackKind; /** In the chain: as tall as the devices. */ fill?: boolean }) {
  const drop = useDropTarget(`source:${track.id}`, kind === 'midi' ? { sample: (p) => loadSampleIntoSampler(track.id, p.sampleId), sound: (p) => loadSound(p.presetId, track.id) } : {});
  if (kind === 'group') {
    return (
      <View style={s.source}>
        <View style={{ flex: 1 }}>
          <Txt style={s.sourceName}>Gruppe</Txt>
          <Txt style={s.sourceSub}>Alles, was in diese Gruppe gespielt wird, läuft durch ihre Geräte und ihren Fader</Txt>
        </View>
      </View>
    );
  }
  if (kind === 'audio') {
    return (
      <View style={[s.source, fill && s.sourceFill]}>
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
    <View ref={drop.ref}>
      <Pressable accessibilityLabel="Instrument öffnen" onPress={() => setState({ panel: 'instrument' })} style={[s.source, { borderColor: C.accent }, drop.dragging && { borderStyle: 'dashed' }, drop.over && { backgroundColor: 'rgba(198,255,61,0.12)' }]}>
        <View style={{ flex: 1 }}>
          <Txt style={[s.sourceName, { color: C.accent }]}>{name}</Txt>
          <Txt style={s.sourceSub}>{drop.dragging ? (drop.over ? 'Loslassen: hier laden' : 'Sample oder Sound hierher ziehen') : `Instrument · ${type}`}</Txt>
        </View>
        <Txt style={s.open}>Öffnen ›</Txt>
      </Pressable>
    </View>
  );
}

function DeviceCard({ compact, track, device, folded: isFolded, onToggle, index, count, bpm, width, onChange, onMove, onDrag, onRemove }: { compact?: boolean; track: Track; device: Device; folded: boolean; onToggle: () => void; index: number; count: number; bpm: number; width: number; onChange: (p: { on?: boolean; params?: Record<string, number> }) => void; onMove: (delta: number) => void; onDrag: (dx: number, phase: 'move' | 'end' | 'cancel') => void; onRemove: () => void }) {
  const [listOpen, setListOpen] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const userPresets = useStore((st) => st.devicePresets);
  // An effect dragged from the browser onto a card goes in front of it (Live inserts where you drop).
  const drop = useDropTarget(`devslot:${track.id}:${device.id}`, { device: (p) => addDeviceFrom(p.device, { presetId: p.presetId, trackId: track.id, index }) });
  const grip = useDrag('start', !!compact, (dx, _dy, phase) => onDrag(dx, phase));
  const def = DEVICE_DEFS[device.type];
  if (!def) return null;
  const p = deviceParams(device);
  const own = userPresets.filter((x) => x.type === device.type);
  const presets: (UserDevicePreset | (typeof DEVICE_PRESETS)[DeviceType][number])[] = [...own, ...DEVICE_PRESETS[device.type]];
  const mine = userPresetOf(own, device);
  const current = mine ?? presetOf(device);
  const pick = (i: number) => {
    const next = presets[(i + presets.length) % presets.length];
    onChange({ params: 'user' in next ? deviceParams({ type: device.type, params: next.params }) : presetParams(device.type, next) });
  };
  const at = current ? presets.indexOf(current) : -1;
  const set = (key: string, v: number) => onChange({ params: { [key]: v } });
  const dim = !device.on;
  // In the chain all knobs wrap in one block (Live's devices keep one height); the stacked card groups them under titles.
  const rows = (!compact && LAYOUT[device.type]) || [{ keys: def.params.map((x) => x.key) }];
  const byKey = new Map(def.params.map((x) => [x.key, x]));
  const save = () => {
    if (naming === null) return;
    saveDevicePreset(device, naming);
    setNaming(null);
  };
  const power =
    device.type !== 'splice' &&
    (compact ? (
      <Pressable accessibilityLabel={`${def.label} ${device.on ? 'ausschalten' : 'einschalten'}`} onPress={() => onChange({ on: !device.on })} hitSlop={8} style={{ paddingHorizontal: 2 }}>
        <View style={[s.led, device.on && s.ledOn]} />
      </Pressable>
    ) : (
      <Chip variant={device.on ? 'on' : 'ghost'} onPress={() => onChange({ on: !device.on })} textStyle={{ fontSize: 11 }}>
        {device.on ? 'AN' : 'AUS'}
      </Chip>
    ));

  // Folded in the chain: a slim strip, power on top, the name on its side, tap to open (Live's folded device).
  if (compact && isFolded) {
    return (
      <View ref={drop.ref} style={[s.fill, dim && { opacity: 0.55 }, drop.over && s.slotOver]}>
        <PluginFrame style={[s.fill, s.strip]} radius={8}>
          {power}
          <Pressable accessibilityRole="button" accessibilityLabel={`${def.label} ausklappen`} onPress={onToggle} style={s.stripBody}>
            <Txt style={[s.stripText, NOWRAP]}>
              {`${def.label.toUpperCase()}${current && current.id !== 'default' ? ` · ${current.name}` : ''}`}
            </Txt>
          </Pressable>
          <View {...grip} accessibilityLabel={`${def.label} verschieben`} style={[s.gripV, web({ touchAction: 'none', cursor: 'grab' })]}>
            <Txt style={s.gripText}>⋮⋮</Txt>
          </View>
        </PluginFrame>
      </View>
    );
  }

  const header = (
    <View style={s.controls}>
      {!compact && power}
      {!compact && (
        <>
          <Pressable accessibilityLabel={`${def.label} nach vorne`} disabled={index === 0} onPress={() => onMove(-1)} style={[s.small, index === 0 && s.disabled]}>
            <Txt style={s.smallText}>▲</Txt>
          </Pressable>
          <Pressable accessibilityLabel={`${def.label} nach hinten`} disabled={index === count - 1} onPress={() => onMove(1)} style={[s.small, index === count - 1 && s.disabled]}>
            <Txt style={s.smallText}>▼</Txt>
          </Pressable>
        </>
      )}
      <Pressable accessibilityLabel={`${def.label} entfernen`} onPress={onRemove} style={compact ? s.tiny : s.small}>
        <Close size={compact ? 11 : 14} />
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
              <Chip key={o} variant={Math.round(p[def.key]) === i ? 'on' : 'ghost'} onPress={() => set(def.key, i)} textStyle={{ fontSize: compact ? 11 : 12 }} style={compact ? s.chipC : undefined}>
                {o}
              </Chip>
            ))}
          </View>
        </View>
      );
    }
    return <Knob key={def.key} {...(compact ? { size: 36, width: 50 } : {})} label={def.label} value={p[def.key]} min={def.min} max={def.max} curve={def.curve} step={def.step} reset={def.def} format={(v) => formatParam(def, v)} onChange={(v) => set(def.key, v)} />;
  };

  return (
    <View ref={drop.ref} style={[compact && s.fill, dim && { opacity: 0.55 }, drop.over && s.slotOver]}>
      <PluginFrame style={[compact ? s.cardC : s.card, compact && s.fill]} radius={compact ? 8 : 12}>
        <View style={[s.cardHead, compact && s.cardHeadC]}>
          {compact && (
            <View {...grip} accessibilityLabel={`${def.label} verschieben`} style={[s.grip, web({ touchAction: 'none', cursor: 'grab' })]}>
              <Txt style={s.gripText}>⋮⋮</Txt>
            </View>
          )}
          {compact && power}
          <Pressable accessibilityRole="button" accessibilityLabel={`${def.label} ${isFolded ? 'ausklappen' : 'einklappen'}`} accessibilityState={{ expanded: !isFolded }} onPress={onToggle} style={[s.titleBox, compact && { minHeight: 24 }]}>
            {!compact && <Txt style={s.chevron}>{isFolded ? '▸' : '▾'}</Txt>}
            <View style={{ flex: 1 }}>
              <View style={s.titleLine}>
                <Txt numberOfLines={1} style={s.cardTitle}>
                  {def.label.toUpperCase()}
                </Txt>
                {device.preset && (
                  <View style={s.soundTag} accessibilityLabel="Gehört zum Sound-Preset: wechselt mit dem nächsten Sound">
                    <Txt style={s.soundTagText}>SOUND</Txt>
                  </View>
                )}
              </View>
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
            <View style={[s.presetRow, compact && { marginBottom: 6, gap: 4 }]}>
              <Pressable accessibilityLabel={`${def.label} vorheriges Preset`} onPress={() => pick(at < 0 ? presets.length - 1 : at - 1)} style={compact ? s.tiny : s.small}>
                <Txt style={s.smallText}>◀</Txt>
              </Pressable>
              <Pressable accessibilityLabel={`${def.label} Presets`} onPress={() => setListOpen((v) => !v)} style={[s.presetName, compact && { height: 24 }]}>
                <Txt numberOfLines={1} style={[s.presetText, !current && { color: C.muted }]}>
                  {current ? `${mine ? '★ ' : ''}${current.name}` : 'Eigene Einstellung'}
                </Txt>
              </Pressable>
              <Pressable accessibilityLabel={`${def.label} nächstes Preset`} onPress={() => pick(at + 1)} style={compact ? s.tiny : s.small}>
                <Txt style={s.smallText}>▶</Txt>
              </Pressable>
              <Pressable accessibilityLabel={`${def.label} als Preset speichern`} onPress={() => setNaming(naming === null ? (mine?.name ?? freePresetName(userPresets, device.type, def.label)) : null)} style={[compact ? s.tiny : s.small, naming !== null && s.saveOn]}>
                <Txt style={[s.smallText, naming !== null && { color: C.accentInk }]}>💾</Txt>
              </Pressable>
            </View>
            {naming !== null && (
              <View style={[s.presetRow, { marginTop: -2 }]}>
                <TextInput style={s.nameInput} autoFocus value={naming} onChangeText={setNaming} onSubmitEditing={save} selectTextOnFocus placeholder="Name des Presets" placeholderTextColor={C.dim} accessibilityLabel="Name des Presets" />
                <Chip variant="on" onPress={save} textStyle={{ fontSize: 11 }}>
                  Speichern
                </Chip>
              </View>
            )}
            {listOpen && (
              <View style={s.presetList}>
                {own.map((preset) => (
                  <View key={preset.id} style={s.ownChip}>
                    <Chip variant={mine?.id === preset.id ? 'on' : 'ghost'} onPress={() => (pick(presets.indexOf(preset)), setListOpen(false))} textStyle={{ fontSize: 12 }}>
                      {`★ ${preset.name}`}
                    </Chip>
                    <Pressable accessibilityLabel={`Preset ${preset.name} löschen`} onPress={() => deleteDevicePreset(preset.id)} hitSlop={6} style={s.ownDel}>
                      <Close size={10} />
                    </Pressable>
                  </View>
                ))}
                {DEVICE_PRESETS[device.type].map((preset) => (
                  <Chip key={preset.id} variant={!mine && current?.id === preset.id ? 'on' : 'ghost'} onPress={() => (pick(presets.indexOf(preset)), setListOpen(false))} textStyle={{ fontSize: 12 }}>
                    {preset.name}
                  </Chip>
                ))}
              </View>
            )}
            <Scope device={device} p={p} bpm={bpm} width={width} compact={compact} />
            {rows.map((row, i) => (
              <View key={i}>
                {row.title && <Txt style={[s.cap, { marginTop: 8 }]}>{row.title}</Txt>}
                <KnobRow>{row.keys.map((k) => byKey.get(k)).filter((x): x is ParamDef => !!x).map(control)}</KnobRow>
              </View>
            ))}
          </>
        )}
      </PluginFrame>
    </View>
  );
}

/** The live picture of a device (none for the plain ones). */
function Scope({ device, p, bpm, width, compact }: { device: Device; p: Record<string, number>; bpm: number; width: number; compact?: boolean }) {
  const height = compact ? 56 : undefined;
  switch (device.type) {
    case 'eq':
      return <EqScope params={p} width={width} height={height} />;
    case 'comp':
      return <CompScope threshold={p.threshold} ratio={p.ratio} knee={p.knee} makeup={p.makeup} width={width} height={height} />;
    case 'sat':
      return <SatScope mode={p.mode} drive={p.drive} width={width} height={height} />;
    case 'echo':
      return <EchoScope seconds={echoSeconds(p as { sync: number; division: number; time: number }, bpm)} feedback={p.feedback} pingpong={p.pingpong >= 0.5} width={width} />;
    case 'reverb':
      return <ReverbScope size={p.size} width={width} height={height} />;
    case 'filter':
      return <FilterScope type={SCOPE_FILTER[Math.round(p.type)] ?? 'lowpass'} cutoff={p.cutoff} resonance={p.type === 2 ? 0.5 + p.res * 0.6 : p.res} width={width} height={height} />;
    case 'limiter':
      return <LimiterScope gain={p.gain} ceiling={p.ceiling} width={width} height={height} />;
    case 'transient':
      return <TransientScope attack={p.attack} sustain={p.sustain} width={width} height={height} />;
    case 'kickstart':
      return <CycleScope values={kickstartCurve(p.curve, p.mix, 64)} label={`${KICKSTART_CURVES[Math.round(p.curve)]} · ${RHYTHM_RATES[Math.round(p.rate)]}`} width={width} height={height} />;
    case 'shaper':
      return <CycleScope values={Array.from({ length: 128 }, (_, i) => 1 - p.depth * (1 - shaperShape(p.shape, i / 128)))} label={`${SHAPER_TARGETS[Math.round(p.target)]} · ${SHAPER_SHAPES[Math.round(p.shape)]} · ${RHYTHM_RATES[Math.round(p.rate)]}`} cycles={2} width={width} />;
    default:
      return null;
  }
}

/** One line at its own width (RN-web's numberOfLines would cap it at the narrow strip's width). */
const NOWRAP = web({ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) as TextStyle;

const s = StyleSheet.create({
  sub: { ...font(400), fontSize: 12, color: C.muted, marginBottom: 10 },
  presetRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  presetName: { flex: 1, height: 30, borderRadius: 5, borderWidth: 1, borderColor: SKIN.lcdEdge, backgroundColor: SKIN.lcd, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  presetText: { ...mono(500), fontSize: 12, color: SKIN.lcdText, textShadowColor: 'rgba(198,255,61,0.55)', textShadowRadius: 6 },
  presetList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  foldRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 },
  card: { padding: 12, marginBottom: 10 },
  cardC: { padding: 8 },
  toolbar: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 6 },
  chain: { gap: GAP, alignItems: 'stretch', paddingBottom: 6 },
  fill: { flexGrow: 1 },
  led: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2a3238', borderWidth: 1, borderColor: '#3a4248' },
  ledOn: { backgroundColor: C.accent, borderColor: C.accent, shadowColor: C.accent, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  cardHeadC: { minHeight: 26, gap: 6, marginBottom: 4 },
  grip: { width: 14, height: 24, alignItems: 'center', justifyContent: 'center' },
  gripV: { height: 24, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  gripText: { fontSize: 10, color: C.dim, letterSpacing: -1 },
  tiny: { minWidth: 24, height: 22, borderRadius: 5, borderWidth: 1, borderColor: '#3a3a42', backgroundColor: '#1c1c21', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  strip: { paddingVertical: 8, alignItems: 'center', gap: 8 },
  stripBody: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'flex-start', overflow: 'hidden' },
  // Turned on its side: a 220 px line rotated about its centre, which sits in the middle of the strip, the text starting at the top.
  stripText: { ...font(700), fontSize: 10, letterSpacing: 1.4, color: C.accent, position: 'absolute', top: 112, left: -93, width: 220, textAlign: 'right', transform: [{ rotate: '-90deg' }] },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  soundTag: { paddingHorizontal: 4, height: 13, borderRadius: 3, borderWidth: 1, borderColor: '#5b6b3a', justifyContent: 'center' },
  soundTagText: { ...font(700), fontSize: 7.5, letterSpacing: 1, color: '#9fbf55' },
  moving: { zIndex: 5, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  slotOver: { borderLeftWidth: 3, borderLeftColor: C.accent },
  markLeft: { borderLeftWidth: 3, borderLeftColor: C.accent },
  markRight: { borderRightWidth: 3, borderRightColor: C.accent },
  saveOn: { backgroundColor: C.accent, borderColor: C.accent },
  nameInput: { flex: 1, height: 28, borderRadius: 5, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, paddingHorizontal: 8, color: C.text, ...font(400), fontSize: 12, outlineWidth: 0 },
  ownChip: { flexDirection: 'row', alignItems: 'center' },
  ownDel: { width: 18, height: 18, marginLeft: -6, borderRadius: 9, backgroundColor: '#2a2a31', alignItems: 'center', justifyContent: 'center' },
  chipC: { height: 24, paddingHorizontal: 9 },
  drop: { width: 150, minHeight: 120, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: C.line, alignItems: 'center', justifyContent: 'flex-start', gap: 8, padding: 10, paddingTop: 36 },
  dropWide: { minHeight: 64, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, marginTop: 4 },
  dropLive: { borderColor: C.accent },
  dropOver: { backgroundColor: 'rgba(198,255,61,0.12)' },
  dropPlus: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  dropPlusText: { ...font(700), fontSize: 18, color: C.accentInk, lineHeight: 20 },
  dropText: { ...font(500), fontSize: 11, color: C.muted, textAlign: 'center', flexShrink: 1 },
  stack: { flexDirection: 'column', width: '100%' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 36 },
  titleBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  chevron: { fontSize: 14, color: C.accent, width: 14 },
  cardTitle: { ...font(700), fontSize: 10.5, letterSpacing: 1.6, color: C.accent },
  summary: { ...font(400), fontSize: 11.5, color: C.text, marginTop: 2 },
  note: { color: C.muted, fontSize: 12, lineHeight: 17 },
  cap: { ...font(700), fontSize: 10, letterSpacing: 1.4, color: C.muted, marginBottom: 4 },
  sourceFill: { flexGrow: 1, marginBottom: 0, alignItems: 'flex-start', borderRadius: 8 },
  source: { flexDirection: 'row', alignItems: 'center', backgroundColor: SKIN.panelBottom, borderWidth: 1, borderColor: SKIN.edge, borderRadius: 12, padding: 12, marginBottom: 10 },
  sourceName: { ...font(700), fontSize: 15 },
  sourceSub: { ...font(400), fontSize: 11, color: C.muted, marginTop: 2 },
  open: { ...font(600), fontSize: 12, color: C.accent },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  small: { width: 30, height: 28, borderRadius: 5, borderWidth: 1, borderColor: '#3a3a42', backgroundColor: '#1c1c21', alignItems: 'center', justifyContent: 'center' },
  smallText: { fontSize: 11, color: C.text },
  disabled: { opacity: 0.35 },
  choice: { width: '100%', marginVertical: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pick: { paddingVertical: 9, paddingHorizontal: 10, borderWidth: 1, borderColor: C.line, borderRadius: 10, marginBottom: 6 },
  pickName: { ...font(700), fontSize: 14 },
  pickBlurb: { color: C.muted, fontSize: 11.5, marginTop: 2 },
});
