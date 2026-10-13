import type { AudioNode, AudioParam, BaseAudioContext, ConvolverNode, DelayNode, GainNode, OscillatorNode, WaveShaperNode } from 'react-native-audio-api';
import type { DeviceType } from '../types';
import {
  BUTTERWORTH_DB,
  PEAK_LOOP_SAMPLES,
  FILTER_KINDS,
  chorusSwing,
  compCurve,
  dbToGain,
  echoSeconds,
  eqBands,
  filterDeviceQ,
  followerCutoff,
  limiterGains,
  peakDecay,
  satCurve,
  satPreGain,
} from './devicemath';
import { limiterCurve, reverbImpulse } from './fx';

// The Web Audio graph of each device. Every builder returns an `input`, an `output` and an `update` that moves the
// parameters to new values (gliding while playing, jumping when rendering offline). Where a plugin would run
// DSP code, this uses only nodes react-native-audio-api has on every platform: biquads, waveshapers, delays,
// gains, oscillators, a convolver. No DynamicsCompressor and no channel splitter exist there, so the compressor
// builds its own detector (see `buildComp`).

type Param = { setTargetAtTime: (v: number, t: number, c: number) => unknown; setValueAtTime: (v: number, t: number) => unknown; linearRampToValueAtTime: (v: number, t: number) => unknown; cancelScheduledValues: (t: number) => unknown };

export interface UpdateEnv {
  bpm: number;
  /** Glide to the new values (live) or jump (offline render). */
  smooth: boolean;
  /** Automation: set the values at this context time (a jump, or with `ramp` a linear ramp ending there). */
  at?: number;
  ramp?: boolean;
  /** Collects every AudioParam an automation event touched, so the events can be cancelled later. */
  touched?: Set<Param>;
}

export interface DeviceNode {
  input: AudioNode;
  output: AudioNode;
  update(p: Record<string, number>, env: UpdateEnv): void;
  /** Stop oscillators and cut the connections: the device is gone from the chain. */
  dispose(): void;
}

const TIME_CONSTANT = 0.015;

/** Moves an AudioParam to `v`: a short glide while playing, a jump at time 0 when rendering, or an automation event at `env.at`. */
export function setParam(ctx: BaseAudioContext, param: Param, v: number, mode: boolean | UpdateEnv) {
  const env = typeof mode === 'boolean' ? { smooth: mode } : mode;
  if ('at' in env && env.at !== undefined) {
    env.touched?.add(param);
    if (env.ramp) param.linearRampToValueAtTime(v, env.at);
    else param.setValueAtTime(v, env.at);
    return;
  }
  if (env) param.setTargetAtTime(v, ctx.currentTime, TIME_CONSTANT);
  else param.setValueAtTime(v, 0);
}
export type { Param as DeviceParam };

const WAVESHAPER_OVERSAMPLE = '4x' as const;

/** `connect` has one overload for nodes and one for params; this picks the right one for either. */
function wire(from: AudioNode, to: AudioNode | AudioParam) {
  if ('numberOfInputs' in to) from.connect(to);
  else from.connect(to);
}

/** Small toolkit shared by the builders: remembers every node so `dispose` can disconnect them all. */
class Kit {
  readonly nodes: AudioNode[] = [];
  readonly oscillators: OscillatorNode[] = [];
  constructor(readonly ctx: BaseAudioContext) {}

  gain(value = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    this.nodes.push(g);
    return g;
  }

  biquad(type: 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf', frequency: number, q = 0) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    this.nodes.push(f);
    return f;
  }

  shaper(curve: Float32Array<ArrayBuffer>, oversample = false): WaveShaperNode {
    const s = this.ctx.createWaveShaper();
    s.curve = curve;
    if (oversample) {
      try {
        s.oversample = WAVESHAPER_OVERSAMPLE;
      } catch {
        // not supported by this platform's build: aliasing is the price
      }
    }
    this.nodes.push(s);
    return s;
  }

  /**
   * A waveshaper whose curve can be replaced later: a node accepts its curve only once, so a changed curve means a
   * new node between the same neighbours.
   */
  swappableShaper(curve: Float32Array<ArrayBuffer>, from: AudioNode, to: AudioNode | AudioParam, oversample = false): { set(c: Float32Array<ArrayBuffer>): void } {
    let current = this.shaper(curve, oversample);
    from.connect(current);
    wire(current, to);
    return {
      set: (next) => {
        const fresh = this.shaper(next, oversample);
        from.connect(fresh);
        wire(fresh, to);
        from.disconnect(current);
        current.disconnect();
        const at = this.nodes.indexOf(current);
        if (at >= 0) this.nodes.splice(at, 1);
        current = fresh;
      },
    };
  }

  delay(max: number, seconds: number): DelayNode {
    const d = this.ctx.createDelay(max);
    d.delayTime.value = seconds;
    this.nodes.push(d);
    return d;
  }

  lfo(): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.start();
    this.oscillators.push(o);
    this.nodes.push(o);
    return o;
  }

  dispose() {
    for (const o of this.oscillators) {
      try {
        o.stop();
      } catch {
        // already stopped
      }
    }
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        // already disconnected
      }
    }
  }
}

/** Input and output are plain gains so the neighbours connect to something stable while the inside is rewired. */
function shell(k: Kit): { input: GainNode; output: GainNode } {
  return { input: k.gain(), output: k.gain() };
}

type Builder = (k: Kit) => Pick<DeviceNode, 'input' | 'output'> & { update: DeviceNode['update'] };

/** Equal-power blend: at 50 % both paths are -3 dB. */
const blend = (mix: number) => ({ dry: Math.cos((mix * Math.PI) / 2), wet: Math.sin((mix * Math.PI) / 2) });

// ---------------------------------------------------------------- EQ

const buildEq: Builder = (k) => {
  const { input, output } = shell(k);
  const bands = eqBands({ hp: 20, lsF: 100, lsG: 0, p1F: 400, p1G: 0, p1Q: 1, p2F: 2500, p2G: 0, p2Q: 1, hsF: 8000, hsG: 0, lp: 20000 });
  const filters = bands.map((b) => k.biquad(b.kind, b.freq, b.q));
  let prev: AudioNode = input;
  for (const f of filters) {
    prev.connect(f);
    prev = f;
  }
  prev.connect(output);
  return {
    input,
    output,
    update(p, env) {
      eqBands(p).forEach((b, i) => {
        const f = filters[i];
        setParam(k.ctx, f.frequency, b.freq, env);
        if (b.kind === 'peaking' || b.kind === 'highpass' || b.kind === 'lowpass') setParam(k.ctx, f.Q, b.q, env);
        if (b.kind === 'peaking' || b.kind === 'lowshelf' || b.kind === 'highshelf') setParam(k.ctx, f.gain, b.gainDb, env);
      });
    },
  };
};

// ---------------------------------------------------------------- compressor

/**
 * Feed-forward compressor from plain nodes:
 *
 *   in ──> vca (a gain node whose gain is driven) ──> makeup ──> wet
 *   in ──> |x| ──> peak hold with decay (release) ──> lowpass (attack) ──> gain curve ──> vca.gain
 *
 * The peak detector is a loop: peak = max(|x|, decay * peak one block ago), with max(a, b) = (a + b)/2 + |a - b|/2
 * built from gains and a waveshaper. The loop runs through a DelayNode (one render block, 128 samples), so the
 * decay per pass is `peakDecay`. The lowpass after it is the attack: how fast the detector may rise.
 * (A slow lowpass instead of the decay loop would need a cutoff of about 1 Hz, which is where 32-bit biquad
 * coefficients stop being accurate.)
 */
const buildComp: Builder = (k) => {
  const { input, output } = shell(k);
  const vca = k.gain(0); // its own gain is 0: the shaper's output is added to it through the param connection
  const makeup = k.gain();
  const dry = k.gain(0);
  const wet = k.gain(1);
  input.connect(vca);
  vca.connect(makeup);
  makeup.connect(wet);
  wet.connect(output);
  input.connect(dry);
  dry.connect(output);

  const rectifier = k.shaper(new Float32Array([1, 0, 1]));
  input.connect(rectifier);
  const mean = k.gain(0.5);
  const half = k.gain(0.5);
  const negate = k.gain(-1);
  const decay = k.gain(0.97);
  const loop = k.delay(0.05, PEAK_LOOP_SAMPLES / k.ctx.sampleRate);
  const peak = k.gain();
  rectifier.connect(mean);
  rectifier.connect(half);
  decay.connect(mean);
  decay.connect(negate);
  negate.connect(half);
  const abs = k.shaper(new Float32Array([1, 0, 1]));
  half.connect(abs);
  mean.connect(peak);
  abs.connect(peak);
  peak.connect(loop);
  loop.connect(decay);
  const attackLp = k.biquad('lowpass', 100, BUTTERWORTH_DB);
  peak.connect(attackLp);
  const curve = k.swappableShaper(compCurve({ threshold: -18, ratio: 4, knee: 6 }), attackLp, vca.gain);

  let shapeKey = '';
  return {
    input,
    output,
    update(p, env) {
      const key = `${p.threshold}|${p.ratio}|${p.knee}`;
      if (key !== shapeKey) {
        shapeKey = key;
        curve.set(compCurve({ threshold: p.threshold, ratio: p.ratio, knee: p.knee }));
      }
      setParam(k.ctx, attackLp.frequency, followerCutoff(p.attack), env);
      setParam(k.ctx, decay.gain, peakDecay(p.release, k.ctx.sampleRate), env);
      setParam(k.ctx, makeup.gain, dbToGain(p.makeup), env);
      setParam(k.ctx, wet.gain, p.mix, env);
      setParam(k.ctx, dry.gain, 1 - p.mix, env);
    },
  };
};

// ---------------------------------------------------------------- saturator

const buildSat: Builder = (k) => {
  const { input, output } = shell(k);
  const pre = k.gain();
  const dcBlock = k.biquad('highpass', 8, BUTTERWORTH_DB);
  const tone = k.biquad('lowpass', 30000, BUTTERWORTH_DB);
  const out = k.gain();
  const wet = k.gain();
  const dry = k.gain(0);
  input.connect(pre);
  const shaper = k.swappableShaper(satCurve(0), pre, dcBlock, true);
  dcBlock.connect(tone);
  tone.connect(out);
  out.connect(wet);
  wet.connect(output);
  input.connect(dry);
  dry.connect(output);
  let mode = -1;
  return {
    input,
    output,
    update(p, env) {
      if (Math.round(p.mode) !== mode) {
        mode = Math.round(p.mode);
        shaper.set(satCurve(mode));
      }
      setParam(k.ctx, pre.gain, satPreGain(p.drive), env);
      setParam(k.ctx, tone.frequency, p.tone >= 19999 ? 30000 : p.tone, env);
      setParam(k.ctx, out.gain, dbToGain(p.out), env);
      setParam(k.ctx, wet.gain, p.mix, env);
      setParam(k.ctx, dry.gain, 1 - p.mix, env);
    },
  };
};

// ---------------------------------------------------------------- echo

/**
 * Two delay lines in a loop. Normal: the first one feeds itself, both echoes sit in the middle. Ping-pong: the
 * second one (same time) feeds the first, so echoes alternate left, right, left; the loop is two delays long.
 */
const buildEcho: Builder = (k) => {
  const { input, output } = shell(k);
  const dry = k.gain();
  input.connect(dry);
  dry.connect(output);
  const hp = k.biquad('highpass', 150, BUTTERWORTH_DB);
  const lp = k.biquad('lowpass', 5000, BUTTERWORTH_DB);
  const d1 = k.delay(4, 0.3);
  const d2 = k.delay(4, 0.3);
  input.connect(hp);
  hp.connect(lp);
  lp.connect(d1);
  // Between the two lines the echo already loses its feedback share, so every echo is quieter than the last
  // (without it ping-pong would play the first two echoes at the same level).
  const mid = k.gain(0);
  d1.connect(mid);
  mid.connect(d2);
  const fb1 = k.gain(0);
  const fb2 = k.gain(0);
  d1.connect(fb1);
  d2.connect(fb2);
  fb1.connect(hp);
  fb2.connect(hp);
  const pan1 = k.ctx.createStereoPanner();
  const pan2 = k.ctx.createStereoPanner();
  k.nodes.push(pan1, pan2);
  const tap1 = k.gain();
  const tap2 = k.gain(0);
  d1.connect(tap1);
  d2.connect(tap2);
  tap1.connect(pan1);
  tap2.connect(pan2);
  const wet = k.gain();
  pan1.connect(wet);
  pan2.connect(wet);
  wet.connect(output);
  return {
    input,
    output,
    update(p, env) {
      const ping = p.pingpong >= 0.5;
      const seconds = echoSeconds(p as { sync: number; division: number; time: number }, env.bpm);
      setParam(k.ctx, d1.delayTime, seconds, env);
      setParam(k.ctx, d2.delayTime, seconds, env);
      setParam(k.ctx, fb1.gain, ping ? 0 : p.feedback, env);
      setParam(k.ctx, mid.gain, p.feedback, env);
      setParam(k.ctx, fb2.gain, ping ? p.feedback : 0, env);
      setParam(k.ctx, tap2.gain, ping ? 1 : 0, env);
      setParam(k.ctx, pan1.pan, ping ? -0.85 : 0, env);
      setParam(k.ctx, pan2.pan, ping ? 0.85 : 0, env);
      setParam(k.ctx, hp.frequency, p.hp <= 20.5 ? 5 : p.hp, env);
      setParam(k.ctx, lp.frequency, p.lp >= 19999 ? 30000 : p.lp, env);
      setParam(k.ctx, wet.gain, p.mix, env);
    },
  };
};

// ---------------------------------------------------------------- reverb

/** A convolution reverb; the room is a generated impulse that is made again when the size changes noticeably. */
const buildReverb: Builder = (k) => {
  const { input, output } = shell(k);
  const dry = k.gain();
  const wet = k.gain();
  const pre = k.delay(0.25, 0);
  const lowCut = k.biquad('highpass', 120, BUTTERWORTH_DB);
  const damp = k.biquad('lowpass', 12000, BUTTERWORTH_DB);
  input.connect(dry);
  dry.connect(output);
  input.connect(pre);
  pre.connect(lowCut);
  const link = k.gain();
  damp.connect(link);
  link.connect(wet);
  wet.connect(output);

  let conv: ConvolverNode | null = null;
  let size = 0;
  const room = (seconds: number) => {
    const [l, r] = reverbImpulse(k.ctx.sampleRate, seconds);
    const ir = k.ctx.createBuffer(2, l.length, k.ctx.sampleRate);
    ir.copyToChannel(l, 0);
    ir.copyToChannel(r, 1);
    const next = k.ctx.createConvolver();
    next.buffer = ir;
    // A fresh node each time: setting a convolver's buffer a second time is not allowed everywhere.
    lowCut.connect(next);
    next.connect(damp);
    if (conv) {
      lowCut.disconnect(conv);
      conv.disconnect();
      const at = k.nodes.indexOf(conv);
      if (at >= 0) k.nodes.splice(at, 1);
    }
    k.nodes.push(next);
    conv = next;
    size = seconds;
  };
  return {
    input,
    output,
    update(p, env) {
      if (!conv || Math.abs(Math.log(p.size / size)) > 0.03) room(p.size);
      const { dry: d, wet: w } = blend(p.mix);
      setParam(k.ctx, dry.gain, d, env);
      // The normalised impulse comes back quiet: the same lift as the shared reverb return.
      setParam(k.ctx, wet.gain, w * 1.6, env);
      setParam(k.ctx, pre.delayTime, p.predelay / 1000, env);
      setParam(k.ctx, lowCut.frequency, p.lowcut, env);
      setParam(k.ctx, damp.frequency, p.damp >= 19999 ? 30000 : p.damp, env);
    },
  };
};

// ---------------------------------------------------------------- chorus

/** Two modulated delays (swinging in opposite directions), panned apart; short delay plus feedback gives a flanger. */
const buildChorus: Builder = (k) => {
  const { input, output } = shell(k);
  const dry = k.gain();
  const wet = k.gain();
  input.connect(dry);
  dry.connect(output);
  const lfo = k.lfo();
  const swingA = k.gain(0);
  const swingB = k.gain(0);
  lfo.connect(swingA);
  lfo.connect(swingB);
  const delays = [0, 1].map((i) => {
    const d = k.delay(0.06, 0.01);
    input.connect(d);
    (i === 0 ? swingA : swingB).connect(d.delayTime as unknown as AudioNode);
    const fb = k.gain(0);
    d.connect(fb);
    fb.connect(d);
    const pan = k.ctx.createStereoPanner();
    pan.pan.value = i === 0 ? -0.7 : 0.7;
    k.nodes.push(pan);
    d.connect(pan);
    pan.connect(wet);
    return { d, fb };
  });
  wet.connect(output);
  return {
    input,
    output,
    update(p, env) {
      const { dry: d, wet: w } = blend(p.mix);
      setParam(k.ctx, dry.gain, d, env);
      setParam(k.ctx, wet.gain, w, env);
      setParam(k.ctx, lfo.frequency, p.rate, env);
      const swing = chorusSwing(p.depth, p.delay);
      setParam(k.ctx, swingA.gain, swing, env);
      setParam(k.ctx, swingB.gain, -swing, env);
      for (const { d: delay, fb } of delays) {
        setParam(k.ctx, delay.delayTime, p.delay / 1000, env);
        setParam(k.ctx, fb.gain, p.feedback, env);
      }
    },
  };
};

// ---------------------------------------------------------------- filter

/** A resonant filter whose cutoff can sweep: an LFO moves the biquad's detune (in cents, so octaves feel even). */
const buildFilter: Builder = (k) => {
  const { input, output } = shell(k);
  const f = k.biquad('lowpass', 2000, 6);
  input.connect(f);
  f.connect(output);
  const lfo = k.lfo();
  const depth = k.gain(0);
  lfo.connect(depth);
  depth.connect(f.detune as unknown as AudioNode);
  let type = -1;
  return {
    input,
    output,
    update(p, env) {
      if (Math.round(p.type) !== type) {
        type = Math.round(p.type);
        f.type = FILTER_KINDS[Math.max(0, Math.min(2, type))];
      }
      setParam(k.ctx, f.frequency, p.cutoff, env);
      setParam(k.ctx, f.Q, filterDeviceQ(p.type, p.res), env);
      setParam(k.ctx, lfo.frequency, p.lfoRate, env);
      setParam(k.ctx, depth.gain, p.lfoDepth * 1200, env);
    },
  };
};

// ---------------------------------------------------------------- limiter, utility

const buildLimiter: Builder = (k) => {
  const { input, output } = shell(k);
  const pre = k.gain();
  const shaper = k.shaper(limiterCurve(), true);
  const post = k.gain();
  input.connect(pre);
  pre.connect(shaper);
  shaper.connect(post);
  post.connect(output);
  return {
    input,
    output,
    update(p, env) {
      const g = limiterGains(p.gain, p.ceiling);
      setParam(k.ctx, pre.gain, g.pre, env);
      setParam(k.ctx, post.gain, g.post, env);
    },
  };
};

const buildUtility: Builder = (k) => {
  const { input, output } = shell(k);
  const gain = k.gain();
  const pan = k.ctx.createStereoPanner();
  k.nodes.push(pan);
  input.connect(gain);
  gain.connect(pan);
  pan.connect(output);
  return {
    input,
    output,
    update(p, env) {
      setParam(k.ctx, gain.gain, dbToGain(p.gain) * (p.invert >= 0.5 ? -1 : 1), env);
      setParam(k.ctx, pan.pan, p.pan, env);
    },
  };
};

/** The Splice slot makes no sound of its own: it is a place to search and load sounds from, so the signal passes through. */
const buildSplice: Builder = (k) => {
  const { input, output } = shell(k);
  input.connect(output);
  return { input, output, update() {} };
};

const BUILDERS: Record<DeviceType, Builder> = {
  splice: buildSplice,
  eq: buildEq,
  comp: buildComp,
  sat: buildSat,
  echo: buildEcho,
  reverb: buildReverb,
  chorus: buildChorus,
  filter: buildFilter,
  limiter: buildLimiter,
  utility: buildUtility,
};

/** Builds the nodes of a device (unconnected to anything but themselves), or null for an unknown type. */
export function buildDevice(ctx: BaseAudioContext, type: DeviceType): DeviceNode | null {
  const build = BUILDERS[type];
  if (!build) return null;
  const k = new Kit(ctx);
  const node = build(k);
  return { ...node, dispose: () => k.dispose() };
}
