import type { AudioNode, BaseAudioContext, GainNode } from 'react-native-audio-api';
import type { Device } from '../types';
import { deviceParams } from './devices';
import { buildDevice, setParam, type DeviceNode, type DeviceParam, type RhythmEnv } from './devicenodes';

/** One device in the chain: its nodes, plus a bypass path so switching it off is a click-free crossfade. */
class Slot {
  readonly input: GainNode;
  readonly output: GainNode;
  private inner: GainNode;
  private bypass: GainNode;

  constructor(
    private ctx: BaseAudioContext,
    readonly id: string,
    readonly type: Device['type'],
    private node: DeviceNode,
  ) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.inner = ctx.createGain();
    this.bypass = ctx.createGain();
    this.input.connect(this.inner);
    this.inner.connect(node.input);
    node.output.connect(this.output);
    this.input.connect(this.bypass);
    this.bypass.connect(this.output);
  }

  /** Params an automation lane drives right now: `update` leaves the device's values alone while set. */
  private touched = new Set<DeviceParam>();
  automated = false;

  update(device: Device, bpm: number, smooth: boolean) {
    setParam(this.ctx, this.inner.gain, device.on ? 1 : 0, smooth);
    setParam(this.ctx, this.bypass.gain, device.on ? 0 : 1, smooth);
    if (!this.automated) this.node.update(deviceParams(device), { bpm, smooth });
  }

  /** One automation step: the device's values with `override` on top, at context time `at` (a ramp ending there, or a jump). */
  automate(device: Device, override: Record<string, number>, bpm: number, at: number, ramp: boolean) {
    this.automated = true;
    this.node.update(deviceParams({ type: device.type, params: { ...device.params, ...override } }), { bpm, smooth: false, at, ramp, touched: this.touched });
  }

  /** Drop the automation events and go back to the device's own values. */
  resetAutomation(device: Device | undefined, bpm: number) {
    if (!this.automated) return;
    for (const p of this.touched) p.cancelScheduledValues(0);
    this.touched.clear();
    this.automated = false;
    if (device) this.node.update(deviceParams(device), { bpm, smooth: true });
  }

  /** Tempo-synced devices (Kickstart, ShaperBox): schedule one window. Off devices are skipped (the bypass carries the sound). */
  rhythm(device: Device, env: RhythmEnv) {
    if (device.on && this.node.rhythm) this.node.rhythm(deviceParams(device), env);
  }

  resetRhythm() {
    this.node.resetRhythm?.();
  }

  dispose() {
    this.node.dispose();
    for (const n of [this.input, this.output, this.inner, this.bypass]) n.disconnect();
  }
}

/**
 * The plugin slots of one track: `input` -> device 1 -> device 2 ... -> `output`. Devices keep their nodes (and
 * their reverb tails) while others are added, removed or moved; only the wiring between them changes.
 */
export class DeviceBay {
  private slots: Slot[] = [];
  private order = '';

  constructor(
    private ctx: BaseAudioContext,
    private input: AudioNode,
    private output: AudioNode,
  ) {
    input.connect(output);
  }

  /** Make the chain match `devices` and move every parameter to its value. */
  sync(devices: Device[] | undefined, bpm: number, smooth: boolean) {
    const list = devices ?? [];
    const order = list.map((d) => `${d.id}:${d.type}`).join(',');
    if (order !== this.order) this.rebuild(list);
    list.forEach((d, i) => this.slots[i]?.update(d, bpm, smooth));
  }

  /** The slot of a device, for automation. */
  slot(id: string): Slot | undefined {
    return this.slots.find((s) => s.id === id);
  }

  /** Schedule the tempo-synced devices of the chain for one window. */
  scheduleRhythm(devices: Device[] | undefined, env: RhythmEnv) {
    for (const d of devices ?? []) this.slot(d.id)?.rhythm(d, env);
  }

  resetRhythm() {
    for (const s of this.slots) s.resetRhythm();
  }

  /** Every automated slot back to its device's values (`devices` = the chain as it is now). */
  resetAutomation(devices: Device[] | undefined, bpm: number) {
    for (const s of this.slots) s.resetAutomation(devices?.find((d) => d.id === s.id), bpm);
  }

  private rebuild(list: Device[]) {
    const old = new Map(this.slots.map((s) => [`${s.id}:${s.type}`, s]));
    const next: Slot[] = [];
    for (const d of list) {
      const key = `${d.id}:${d.type}`;
      const reused = old.get(key);
      if (reused) {
        old.delete(key);
        next.push(reused);
        continue;
      }
      const node = buildDevice(this.ctx, d.type);
      if (node) next.push(new Slot(this.ctx, d.id, d.type, node));
    }
    for (const gone of old.values()) gone.dispose();
    // Re-wire the chain: the survivors keep their insides.
    this.input.disconnect();
    for (const s of next) s.output.disconnect();
    let prev: AudioNode = this.input;
    for (const s of next) {
      prev.connect(s.input);
      prev = s.output;
    }
    prev.connect(this.output);
    this.slots = next;
    this.order = list.map((d) => `${d.id}:${d.type}`).join(',');
  }
}
