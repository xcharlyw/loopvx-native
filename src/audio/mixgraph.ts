import type { AudioNode, BaseAudioContext, BiquadFilterNode, DelayNode, GainNode, StereoPannerNode, WaveShaperNode } from 'react-native-audio-api';
import { sampleLane } from '../lib/automation';
import { audibleGain } from '../lib/project';
import type { AutoParam, Project, Track } from '../types';
import { DELAY_FEEDBACK, LIMITER_RANGE, delaySeconds, djFilter, driveCurve, driveGains, limiterCurve, pumpEvents, reverbImpulse, trackFx } from './fx';
import { DeviceBay } from './devicebay';
import { beatsInWindow, secondsPerBar } from './timing';

/** Oversampling keeps a shaper's harmonics from folding back as inharmonic hash; not every platform has it. */
function oversample(shaper: WaveShaperNode, mode: 'none' | '2x' | '4x') {
  try {
    shaper.oversample = mode;
  } catch {
    // unsupported: the shaper runs without
  }
}

/**
 * Safety limiter for the master sum: connect the sources to `.input`, take the result from `.output`.
 * Below 0.8 full scale the signal passes untouched; peaks above are rounded off up to +6 dBFS.
 */
export function createLimiter(ctx: BaseAudioContext): { input: AudioNode; output: AudioNode } {
  const input = ctx.createGain();
  input.gain.value = 1 / LIMITER_RANGE;
  const shaper = ctx.createWaveShaper();
  shaper.curve = limiterCurve();
  oversample(shaper, '2x'); // peaks that reach the shoulder would alias without it
  input.connect(shaper);
  return { input, output: shaper };
}

/** One track's strip: input -> devices -> highpass -> lowpass -> drive (dry + shaped) -> pan -> pump -> fader. */
class TrackChain {
  readonly input: GainNode;
  readonly fader: GainNode;
  private bay: DeviceBay;
  private hp: BiquadFilterNode;
  private lp: BiquadFilterNode;
  private dry: GainNode;
  private pre: GainNode;
  private shaper: WaveShaperNode;
  private wet: GainNode;
  private pan: StereoPannerNode;
  /** Ducking on the beat; automated by the scheduler, never by `apply`. */
  readonly pump: GainNode;
  reverbSend: GainNode | null = null;
  delaySend: GainNode | null = null;
  /** Parameters an automation lane drives right now: `apply` leaves them alone so a project edit cannot fight the curve. */
  readonly automated = new Set<AutoParam>();
  private lastApply: { ctx: BaseAudioContext; track: Track; gain: number; graph: MixGraph; bpm: number } | null = null;

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.input = ctx.createGain();
    const afterDevices = ctx.createGain();
    this.bay = new DeviceBay(ctx, this.input, afterDevices);
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    for (const f of [this.hp, this.lp]) {
      f.frequency.value = f === this.hp ? 10 : 22000;
      f.Q.value = 1;
    }
    this.dry = ctx.createGain();
    this.pre = ctx.createGain();
    this.pre.gain.value = 1;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = driveCurve();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.pump = ctx.createGain();
    this.fader = ctx.createGain();

    afterDevices.connect(this.hp);
    this.hp.connect(this.lp);
    this.lp.connect(this.dry);
    this.lp.connect(this.pre);
    this.pre.connect(this.shaper);
    this.shaper.connect(this.wet);
    this.dry.connect(this.pan);
    this.wet.connect(this.pan);
    this.pan.connect(this.pump);
    this.pump.connect(this.fader);
    this.fader.connect(out);
  }

  /** Move every parameter to the track's settings: glide while playing (`smooth`), jump when rendering. */
  apply(ctx: BaseAudioContext, track: Track, gain: number, graph: MixGraph, smooth: boolean, bpm: number) {
    this.lastApply = { ctx, track, gain, graph, bpm };
    this.bay.sync(track.devices, bpm, smooth);
    const fx = trackFx(track.fx);
    const auto = this.automated;
    const { lowpass, highpass } = djFilter(fx.filter);
    const drive = driveGains(fx.drive);
    const set = (param: { setTargetAtTime: (v: number, t: number, c: number) => unknown; setValueAtTime: (v: number, t: number) => unknown }, v: number) =>
      smooth ? param.setTargetAtTime(v, ctx.currentTime, 0.015) : param.setValueAtTime(v, 0);
    // Oversampling costs CPU: only while the distortion is on.
    if (!auto.has('drive')) oversample(this.shaper, fx.drive > 0 ? '4x' : 'none');
    if (!auto.has('filter')) {
      set(this.lp.frequency, lowpass);
      set(this.hp.frequency, highpass);
    }
    if (!auto.has('drive')) {
      set(this.dry.gain, drive.dry);
      set(this.pre.gain, drive.pre);
      set(this.wet.gain, drive.wet);
    }
    if (!auto.has('pan')) set(this.pan.pan, Math.max(-1, Math.min(1, fx.pan)));
    if (!auto.has('volume')) set(this.fader.gain, gain);
    // Sends exist only once a track uses them, so projects without effects carry no reverb at all.
    if (fx.reverb > 0 || this.reverbSend || auto.has('reverb')) {
      this.reverbSend ??= graph.connectSend(this.fader, 'reverb');
      if (!auto.has('reverb')) set(this.reverbSend.gain, fx.reverb);
    }
    if (fx.delay > 0 || this.delaySend || auto.has('delay')) {
      this.delaySend ??= graph.connectSend(this.fader, 'delay');
      if (!auto.has('delay')) set(this.delaySend.gain, fx.delay);
    }
  }

  /** One automation event for `param` at context time `t`: a jump (`set`) or a linear ramp ending there. */
  automate(param: AutoParam, value: number, t: number, kind: 'set' | 'ramp', gain: (v: number) => number, graph: MixGraph) {
    this.automated.add(param);
    const to = (p: { setValueAtTime: (v: number, t: number) => unknown; linearRampToValueAtTime: (v: number, t: number) => unknown }, v: number) =>
      kind === 'set' ? p.setValueAtTime(v, t) : p.linearRampToValueAtTime(v, t);
    switch (param) {
      case 'filter': {
        const f = djFilter(value);
        to(this.lp.frequency, f.lowpass);
        to(this.hp.frequency, f.highpass);
        break;
      }
      case 'drive': {
        const d = driveGains(value);
        oversample(this.shaper, '4x');
        to(this.dry.gain, d.dry);
        to(this.pre.gain, d.pre);
        to(this.wet.gain, d.wet);
        break;
      }
      case 'pan':
        to(this.pan.pan, Math.max(-1, Math.min(1, value)));
        break;
      case 'volume':
        to(this.fader.gain, gain(value));
        break;
      case 'reverb':
        this.reverbSend ??= graph.connectSend(this.fader, 'reverb');
        to(this.reverbSend.gain, value);
        break;
      case 'delay':
        this.delaySend ??= graph.connectSend(this.fader, 'delay');
        to(this.delaySend.gain, value);
        break;
    }
  }

  /** Drop every automation event and go back to the track's own settings. */
  resetAutomation() {
    if (!this.automated.size) return;
    const params: { cancelScheduledValues: (t: number) => unknown }[] = [this.lp.frequency, this.hp.frequency, this.dry.gain, this.pre.gain, this.wet.gain, this.pan.pan, this.fader.gain];
    if (this.reverbSend) params.push(this.reverbSend.gain);
    if (this.delaySend) params.push(this.delaySend.gain);
    for (const p of params) p.cancelScheduledValues(0);
    this.automated.clear();
    if (this.lastApply) {
      const { ctx, track, gain, graph, bpm } = this.lastApply;
      this.apply(ctx, track, gain, graph, true, bpm);
    }
  }
}

/**
 * The mixing graph of one context (the live one or an offline render): a strip per track and
 * shared reverb and delay returns, all summed into `out`.
 */
export class MixGraph {
  private chains = new Map<string, TrackChain>();
  private reverbIn: GainNode | null = null;
  private delayIn: GainNode | null = null;
  private delay: DelayNode | null = null;

  constructor(
    private ctx: BaseAudioContext,
    private out: AudioNode,
  ) {}

  /** Where a track's voices connect. */
  input(track: Track): AudioNode {
    return this.chain(track).input;
  }

  private chain(track: Track): TrackChain {
    let c = this.chains.get(track.id);
    if (!c) {
      c = new TrackChain(this.ctx, this.out);
      this.chains.set(track.id, c);
    }
    return c;
  }

  /** Volumes, mute/solo, effects and the delay time. Safe to call on every project change. */
  apply(project: Project, smooth = true) {
    const anySolo = project.tracks.some((t) => t.solo);
    for (const t of project.tracks) this.chain(t).apply(this.ctx, t, audibleGain(t, anySolo), this, smooth, project.bpm);
    if (this.delay) {
      const seconds = delaySeconds(project.bpm);
      if (smooth) this.delay.delayTime.setTargetAtTime(seconds, this.ctx.currentTime, 0.05);
      else this.delay.delayTime.setValueAtTime(seconds, 0);
    }
  }

  /**
   * Pump automation for the beats in [fromBar, toBar) of a window starting at context time `time`.
   * Beats already in the past (a late window) are skipped.
   */
  schedulePump(project: Project, time: number, fromBar: number, toBar: number, automation = true) {
    if (automation) this.scheduleAutomation(project, time, fromBar, toBar);
    const pumped = project.tracks.filter((t) => trackFx(t.fx).pump > 0);
    if (!pumped.length) return;
    const spb = secondsPerBar(project.bpm);
    const beat = spb / 4;
    for (const t of pumped) {
      const g = this.chain(t).pump.gain;
      for (const b of beatsInWindow(fromBar, toBar)) {
        const when = time + (b.bar - fromBar) * spb;
        if (when < this.ctx.currentTime) continue;
        for (const e of pumpEvents(when, trackFx(t.fx).pump, beat)) {
          if (e.kind === 'set') g.setValueAtTime(e.v, e.t);
          else if (e.kind === 'ramp') g.linearRampToValueAtTime(e.v, e.t);
          else g.setTargetAtTime(e.v, e.t, e.tau);
        }
      }
    }
  }

  /**
   * The automation lanes over [fromBar, toBar) of a window starting at context time `time`: the curve sampled every
   * 1/16 bar, a jump to the first value and linear ramps after it. Samples already in the past just land immediately.
   */
  scheduleAutomation(project: Project, time: number, fromBar: number, toBar: number) {
    const anySolo = project.tracks.some((t) => t.solo);
    const spb = secondsPerBar(project.bpm);
    for (const t of project.tracks) {
      const chain = t.automation?.some((l) => l.points.length) ? this.chain(t) : null;
      if (!chain) continue;
      for (const lane of t.automation!) {
        const samples = sampleLane(lane.points, fromBar, toBar);
        samples.forEach((p, i) => chain.automate(lane.param, p.value, time + (p.bar - fromBar) * spb, i === 0 ? 'set' : 'ramp', (v) => audibleGain({ ...t, volume: t.volume * v }, anySolo), this));
      }
    }
  }

  /** Drop all pump and automation events (transport stopped or rescheduled). */
  resetPump() {
    for (const c of this.chains.values()) c.resetAutomation();
    const now = this.ctx.currentTime;
    for (const c of this.chains.values()) {
      c.pump.gain.cancelScheduledValues(0);
      c.pump.gain.setValueAtTime(1, now);
    }
  }

  /** A send gain from `from` into the reverb or delay return (built on first use). */
  connectSend(from: AudioNode, to: 'reverb' | 'delay'): GainNode {
    const send = this.ctx.createGain();
    send.gain.value = 0;
    from.connect(send);
    send.connect(to === 'reverb' ? this.reverbReturn() : this.delayReturn());
    return send;
  }

  private reverbReturn(): GainNode {
    if (!this.reverbIn) {
      const ctx = this.ctx;
      this.reverbIn = ctx.createGain();
      const [l, r] = reverbImpulse(ctx.sampleRate);
      const ir = ctx.createBuffer(2, l.length, ctx.sampleRate);
      ir.copyToChannel(l, 0);
      ir.copyToChannel(r, 1);
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      // Keep the rumble clean: no sub in the reverb.
      const lowCut = ctx.createBiquadFilter();
      lowCut.type = 'highpass';
      lowCut.frequency.value = 120;
      // The normalized impulse comes back quiet: lift the return so a full send sounds properly wet.
      const level = ctx.createGain();
      level.gain.value = 1.6;
      this.reverbIn.connect(lowCut);
      lowCut.connect(conv);
      conv.connect(level);
      level.connect(this.out);
    }
    return this.reverbIn;
  }

  private delayReturn(): GainNode {
    if (!this.delayIn) {
      const ctx = this.ctx;
      this.delayIn = ctx.createGain();
      this.delay = ctx.createDelay(2);
      this.delay.delayTime.value = delaySeconds(120);
      const tone = ctx.createBiquadFilter();
      tone.type = 'bandpass';
      tone.frequency.value = 1800;
      tone.Q.value = 0.5;
      const feedback = ctx.createGain();
      feedback.gain.value = DELAY_FEEDBACK;
      this.delayIn.connect(this.delay);
      this.delay.connect(tone);
      tone.connect(feedback);
      feedback.connect(this.delay);
      tone.connect(this.out);
    }
    return this.delayIn;
  }
}
