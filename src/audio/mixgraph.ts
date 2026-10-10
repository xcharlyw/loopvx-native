import type { AudioNode, BaseAudioContext, BiquadFilterNode, DelayNode, GainNode, StereoPannerNode } from 'react-native-audio-api';
import { audibleGain } from '../lib/project';
import type { Project, Track } from '../types';
import { DELAY_FEEDBACK, delaySeconds, djFilter, driveCurve, driveGains, reverbImpulse, trackFx } from './fx';

/** One track's strip: input -> highpass -> lowpass -> drive (dry + shaped) -> pan -> fader. */
class TrackChain {
  readonly input: GainNode;
  readonly fader: GainNode;
  private hp: BiquadFilterNode;
  private lp: BiquadFilterNode;
  private dry: GainNode;
  private pre: GainNode;
  private wet: GainNode;
  private pan: StereoPannerNode;
  reverbSend: GainNode | null = null;
  delaySend: GainNode | null = null;

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.input = ctx.createGain();
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
    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.fader = ctx.createGain();

    this.input.connect(this.hp);
    this.hp.connect(this.lp);
    this.lp.connect(this.dry);
    this.lp.connect(this.pre);
    this.pre.connect(shaper);
    shaper.connect(this.wet);
    this.dry.connect(this.pan);
    this.wet.connect(this.pan);
    this.pan.connect(this.fader);
    this.fader.connect(out);
  }

  /** Move every parameter to the track's settings: glide while playing (`smooth`), jump when rendering. */
  apply(ctx: BaseAudioContext, track: Track, gain: number, graph: MixGraph, smooth: boolean) {
    const fx = trackFx(track.fx);
    const { lowpass, highpass } = djFilter(fx.filter);
    const drive = driveGains(fx.drive);
    const set = (param: { setTargetAtTime: (v: number, t: number, c: number) => unknown; setValueAtTime: (v: number, t: number) => unknown }, v: number) =>
      smooth ? param.setTargetAtTime(v, ctx.currentTime, 0.015) : param.setValueAtTime(v, 0);
    set(this.lp.frequency, lowpass);
    set(this.hp.frequency, highpass);
    set(this.dry.gain, drive.dry);
    set(this.pre.gain, drive.pre);
    set(this.wet.gain, drive.wet);
    set(this.pan.pan, Math.max(-1, Math.min(1, fx.pan)));
    set(this.fader.gain, gain);
    // Sends exist only once a track uses them, so projects without effects carry no reverb at all.
    if (fx.reverb > 0 || this.reverbSend) {
      this.reverbSend ??= graph.connectSend(this.fader, 'reverb');
      set(this.reverbSend.gain, fx.reverb);
    }
    if (fx.delay > 0 || this.delaySend) {
      this.delaySend ??= graph.connectSend(this.fader, 'delay');
      set(this.delaySend.gain, fx.delay);
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
    for (const t of project.tracks) this.chain(t).apply(this.ctx, t, audibleGain(t, anySolo), this, smooth);
    if (this.delay) {
      const seconds = delaySeconds(project.bpm);
      if (smooth) this.delay.delayTime.setTargetAtTime(seconds, this.ctx.currentTime, 0.05);
      else this.delay.delayTime.setValueAtTime(seconds, 0);
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
