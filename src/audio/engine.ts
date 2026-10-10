import {
  AnalyserNode,
  AudioBuffer,
  AudioBufferSourceNode,
  AudioContext,
  AudioManager,
  AudioNode,
  BaseAudioContext,
  GainNode,
  OfflineAudioContext,
  OscillatorNode,
} from 'react-native-audio-api';
import { Platform } from 'react-native';
import type { Clip, Project, Sample, SynthSettings, Track } from '../types';
import { midiToHz } from '../lib/midi';
import { arrangementSampleIds, trackSynth } from '../lib/project';
import { sampleSource } from '../lib/samples';
import { MixGraph } from './mixgraph';
import { preparePageAudio } from './pageAudio';
import { adsrPoints, pitchRate, voicePeak } from './synth';
import { beatsInWindow, clipEnvelope, clipGainAt, loopEndSeconds, nextBoundary, planClip, projectEndBars, sampleLengthBars, secondsPerBar, warpRate } from './timing';

type AnyContext = BaseAudioContext;

interface Segment {
  /** Context time at which this window starts. */
  time: number;
  fromBar: number;
  toBar: number;
}

interface SessionVoice {
  source: AudioBufferSourceNode;
  sampleId: string;
  scene: number;
}

/** Wait for `promise`, but give up after `ms`: iOS leaves resume() pending on a stuck context. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise.catch(() => undefined), new Promise<undefined>((resolve) => setTimeout(resolve, ms))]);
}

/**
 * On web a stretching voice sets itself up asynchronously: a worklet that queues our messages
 * (buffer, start, loop) until its WASM is ready. Every request to it is answered in order, so
 * answering a no-op request (dropping buffers that end before 0 s) means all earlier ones landed.
 * Plain voices and native ones are ready at once.
 */
async function voiceReady(src: Voice): Promise<void> {
  type Stretcher = { dropBuffers: (toSeconds: number) => Promise<unknown> };
  const node = (src as unknown as { node?: { _operationChain?: Promise<unknown>; stretcherPromise?: Promise<Stretcher> | null } }).node;
  if (!node?.stretcherPromise) return;
  await withTimeout(
    (async () => {
      await node._operationChain;
      await (await node.stretcherPromise!).dropBuffers(0);
    })(),
    10000,
  );
}

const usesStretch = (project: Project, samples: Map<string, Sample>) =>
  project.tracks.some((t) => t.clips.some((c) => samples.get(c.sampleId)?.warp === 'stretch'));

const LOOKAHEAD = 1.0; // seconds of audio scheduled ahead
const TICK_MS = 100;

/** Start a looping, tempo-warped sample voice. */
function startVoice(
  ctx: AnyContext,
  buffer: AudioBuffer,
  sample: Sample,
  projectBpm: number,
  dest: AudioNode,
  when: number,
  offsetBars: number,
  durationBars: number | null,
): AudioBufferSourceNode {
  const rate = warpRate(projectBpm, sample.bpm);
  // 'stretch' keeps the pitch: the library's time-stretcher (Signalsmith Stretch on web).
  const src = ctx.createBufferSource({ pitchCorrection: sample.warp === 'stretch' && Math.abs(rate - 1) > 1e-4 });
  src.buffer = buffer;
  src.playbackRate.value = rate;
  src.loop = true;
  src.loopStart = 0;
  src.loopEnd = loopEndSeconds(buffer.duration, sample.bpm);
  src.connect(dest);
  const nativeSpb = secondsPerBar(sample.bpm ?? projectBpm);
  const offsetSec = Math.min(offsetBars * nativeSpb, Math.max(0, src.loopEnd - 0.001));
  src.start(when, offsetSec);
  if (durationBars !== null) src.stop(when + durationBars * secondsPerBar(projectBpm));
  return src;
}

/** A playing sound: a sample voice or a synth note. Both stop and report their end the same way. */
type Voice = AudioBufferSourceNode | OscillatorNode;

/**
 * One instrument note: oscillator (or the instrument's sample, re-pitched) -> lowpass -> ADSR gain
 * -> destination. A sample instrument without its sample loaded stays silent (null).
 */
function startSynthVoice(
  ctx: AnyContext,
  synth: SynthSettings,
  pitch: number,
  level: number,
  when: number,
  hold: number,
  dest: AudioNode,
  buffers: Map<string, AudioBuffer>,
): Voice | null {
  let osc: Voice;
  if (synth.wave === 'sample') {
    const buffer = synth.sampleId ? buffers.get(synth.sampleId) : undefined;
    if (!buffer) return null;
    const src = ctx.createBufferSource({ pitchCorrection: false });
    src.buffer = buffer;
    src.playbackRate.value = pitchRate(pitch);
    // One-shot: the sample plays out (drums); otherwise the note length gates it like a synth.
    if (synth.oneShot) hold = Math.max(hold, buffer.duration / src.playbackRate.value);
    osc = src;
  } else {
    const o = ctx.createOscillator();
    o.type = synth.wave;
    o.frequency.value = midiToHz(pitch);
    osc = o;
  }
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = synth.cutoff;
  filter.Q.value = synth.resonance;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, when);
  const points = adsrPoints(synth, level, hold);
  for (const p of points) amp.gain.linearRampToValueAtTime(p.v, when + p.t);
  osc.connect(filter);
  filter.connect(amp);
  amp.connect(dest);
  osc.start(when);
  osc.stop(when + points[points.length - 1].t + 0.01);
  return osc;
}

/** The notes of a MIDI clip that start sounding inside [fromBar, toBar); cut at the window end (loop end). */
function scheduleNotes(
  ctx: AnyContext,
  clip: Clip,
  synth: SynthSettings,
  buffers: Map<string, AudioBuffer>,
  dest: AudioNode,
  spb: number,
  time: number,
  fromBar: number,
  toBar: number,
): Voice[] {
  const voices: Voice[] = [];
  const clipEnd = clip.start + clip.length;
  for (const note of clip.notes ?? []) {
    const start = clip.start + note.start;
    const end = Math.min(start + note.length, clipEnd, toBar);
    const begin = Math.max(start, fromBar);
    if (begin >= end - 1e-9 || start >= clipEnd) continue;
    const level = voicePeak(synth, note.velocity) * clipGainAt(clip, begin - clip.start);
    const voice = startSynthVoice(ctx, synth, note.pitch, level, time + (begin - fromBar) * spb, (end - begin) * spb, dest, buffers);
    if (voice) voices.push(voice);
  }
  return voices;
}

/** Schedule all arrangement clips that sound inside [fromBar, toBar) starting at context time `time`. */
function scheduleWindow(
  ctx: AnyContext,
  project: Project,
  samples: Map<string, Sample>,
  buffers: Map<string, AudioBuffer>,
  trackDest: (track: Track) => AudioNode,
  time: number,
  fromBar: number,
  toBar: number,
): Voice[] {
  const spb = secondsPerBar(project.bpm);
  const sources: Voice[] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.notes) {
        sources.push(...scheduleNotes(ctx, clip, trackSynth(track), buffers, trackDest(track), spb, time, fromBar, toBar));
        continue;
      }
      const sample = samples.get(clip.sampleId);
      const buffer = buffers.get(clip.sampleId);
      if (!sample || !buffer) continue;
      const loopBars = sampleLengthBars(buffer.duration, project.bpm, sample.bpm);
      const plan = planClip(clip, fromBar, toBar, loopBars);
      if (!plan) continue;
      const when = time + plan.delayBars * spb;
      // Clip gain and fades: a gain node per voice, automated along the clip's envelope.
      const from = fromBar + plan.delayBars - clip.start;
      const envelope = clipEnvelope(clip, from, from + plan.durationBars);
      let dest = trackDest(track);
      if (envelope.some((p) => p.gain !== 1)) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(envelope[0].gain, when);
        for (const p of envelope.slice(1)) g.gain.linearRampToValueAtTime(p.gain, when + (p.pos - from) * spb);
        g.connect(dest);
        dest = g;
      }
      sources.push(startVoice(ctx, buffer, sample, project.bpm, dest, when, plan.offsetBars, plan.durationBars));
    }
  }
  return sources;
}

export type EngineMode = 'arrange' | 'session';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  analyser: AnalyserNode | null = null;
  /** Track strips (effects, faders) and the reverb/delay returns of the live context. */
  private mix: MixGraph | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer>>();
  private samples = new Map<string, Sample>();
  private project: Project | null = null;

  playing = false;
  /** Bumped whenever session clips start or stop, for UI subscriptions. */
  sessionVersion = 0;
  mode: EngineMode = 'arrange';
  private sources: Voice[] = [];
  /** Metronome on/off and its scheduled clicks (straight to the output: not metered, never exported). */
  metronome = false;
  private clicks: OscillatorNode[] = [];
  /** Session mode: bars since the session clock started that already have their clicks. */
  private sessionClickedTo = 0;
  /** Session mode: bars since the session clock started that already have their pump automation. */
  private sessionPumpedTo = 0;
  private segments: Segment[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private sessionOrigin = 0;
  private sessionVoices = new Map<string, SessionVoice>();
  private previewSource: AudioBufferSourceNode | null = null;
  private unlocking: Promise<AudioContext> | null = null;
  private listeners = new Set<() => void>();

  /** Called with the decoded duration so the sample record can be updated. */
  onDuration?: (sampleId: string, duration: number) => void;

  /** Create the AudioContext (suspended until `unlock`); enough for decoding. */
  private async ensureContext(): Promise<AudioContext> {
    if (!this.ctx && Platform.OS !== 'web') {
      AudioManager.setAudioSessionOptions({ iosCategory: 'playback' });
      await AudioManager.setAudioSessionActivity(true);
    }
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.mix = new MixGraph(this.ctx, this.master);
    }
    return this.ctx;
  }

  /**
   * Start audio output. Call from a user gesture (e.g. tapping play): on the web, Safari only lets a
   * context start inside a tap, so everything up to resume() runs synchronously there.
   */
  unlock(): Promise<AudioContext> {
    // One start at a time: the tap handler and the play button both call this for the same tap.
    this.unlocking ??= this.startOutput().finally(() => {
      this.unlocking = null;
    });
    return this.unlocking;
  }

  private async startOutput(): Promise<AudioContext> {
    preparePageAudio();
    let ctx = this.ctx ?? (await this.ensureContext());
    if (ctx.state !== 'running') await withTimeout(ctx.resume(), 1000);
    if (ctx.state !== 'running' && Platform.OS === 'web') {
      // iOS can leave a context stuck "interrupted" after a call or lock; a fresh one starts fine.
      ctx = await this.rebuildContext();
      await withTimeout(ctx.resume(), 1000);
    }
    if (ctx.state !== 'running') throw new Error(`Audio konnte nicht gestartet werden (${ctx.state}). Bitte noch einmal tippen.`);
    return ctx;
  }

  /** Replace the AudioContext (and everything wired to it). Decoded buffers stay: they are context-independent. */
  private async rebuildContext(): Promise<AudioContext> {
    const wasPlaying = this.playing;
    this.stopPreview();
    this.stopAll();
    this.playing = false;
    const old = this.ctx;
    this.ctx = null;
    this.master = null;
    this.analyser = null;
    this.mix = null;
    void old?.close().catch(() => undefined);
    const ctx = await this.ensureContext();
    if (this.project) this.syncMixer(this.project);
    if (wasPlaying) this.emit();
    return ctx;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  setSamples(samples: Sample[]) {
    this.samples = new Map(samples.map((s) => [s.id, s]));
  }

  async loadBuffer(sampleId: string): Promise<AudioBuffer> {
    const ready = this.buffers.get(sampleId);
    if (ready) return ready;
    const pending = this.loading.get(sampleId);
    if (pending) return pending;
    const sample = this.samples.get(sampleId);
    if (!sample) throw new Error('Sample nicht in der Library');
    const p = (async () => {
      // Decoding works on a suspended context, so loading waveforms never starts audio outside a tap.
      const ctx = await this.ensureContext();
      const buffer = await ctx.decodeAudioData(await sampleSource(sample));
      this.buffers.set(sampleId, buffer);
      if (sample.duration !== buffer.duration) this.onDuration?.(sampleId, buffer.duration);
      return buffer;
    })();
    this.loading.set(sampleId, p);
    try {
      return await p;
    } finally {
      this.loading.delete(sampleId);
    }
  }

  getBuffer(sampleId: string): AudioBuffer | undefined {
    return this.buffers.get(sampleId);
  }

  /** Where a track's voices connect: the start of its effect strip. */
  private trackGain(track: Track): AudioNode {
    return this.mix!.input(track);
  }

  /** Apply volumes, mute, solo and track effects. Safe to call on every project change. */
  syncMixer(project: Project) {
    this.project = project;
    this.mix?.apply(project);
  }

  setMasterVolume(v: number) {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015);
  }

  // ---------------- arrangement transport ----------------

  async play(project: Project, fromBar: number) {
    await this.unlock();
    this.stopAll();
    this.project = project;
    this.mode = 'arrange';
    const ids = arrangementSampleIds(project);
    await Promise.all([...ids].map((id) => this.loadBuffer(id).catch(() => undefined)));
    this.syncMixer(project);
    const ctx = this.ctx!;
    // Stretching voices need a moment to set up on web; start a little later so they come in on time.
    const start = ctx.currentTime + (Platform.OS === 'web' && usesStretch(project, this.samples) ? 0.4 : 0.06);
    const end = project.loop.enabled && fromBar < project.loop.end ? project.loop.end : projectEndBars(project);
    this.segments = [];
    this.queueSegment(start, fromBar, Math.max(fromBar + 0.25, end));
    this.playing = true;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.emit();
  }

  private queueSegment(time: number, fromBar: number, toBar: number) {
    const project = this.project!;
    this.segments.push({ time, fromBar, toBar });
    if (this.segments.length > 8) this.segments.shift();
    const created = scheduleWindow(this.ctx!, project, this.samples, this.buffers, (t) => this.trackGain(t), time, fromBar, toBar);
    for (const s of created) {
      s.onEnded = () => {
        this.sources = this.sources.filter((x) => x !== s);
      };
    }
    this.sources.push(...created);
    this.mix?.schedulePump(project, time, fromBar, toBar);
    this.scheduleClicks(time, fromBar, toBar);
  }

  /** Clicks for the beats in [fromBar, toBar), starting at context time `time`. */
  private scheduleClicks(time: number, fromBar: number, toBar: number) {
    if (!this.metronome || !this.ctx || !this.project) return;
    const ctx = this.ctx;
    const spb = secondsPerBar(this.project.bpm);
    for (const beat of beatsInWindow(fromBar, toBar)) {
      const when = time + (beat.bar - fromBar) * spb;
      if (when < ctx.currentTime) continue;
      const osc = ctx.createOscillator();
      osc.frequency.value = beat.accent ? 1600 : 1000;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, when);
      env.gain.linearRampToValueAtTime(beat.accent ? 0.5 : 0.3, when + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      osc.connect(env);
      env.connect(ctx.destination);
      osc.start(when);
      osc.stop(when + 0.06);
      osc.onEnded = () => {
        this.clicks = this.clicks.filter((c) => c !== osc);
      };
      this.clicks.push(osc);
    }
  }

  setMetronome(on: boolean) {
    this.metronome = on;
    if (!on) {
      this.stopClicks();
      return;
    }
    if (!this.playing || !this.ctx || !this.project) return;
    // Click the rest of what is already scheduled.
    const spb = secondsPerBar(this.project.bpm);
    if (this.mode === 'arrange') {
      for (const seg of this.segments) this.scheduleClicks(seg.time, seg.fromBar, seg.toBar);
    } else {
      const now = (this.ctx.currentTime - this.sessionOrigin) / spb;
      this.sessionClickedTo = Math.max(this.sessionClickedTo, now);
      this.tick();
    }
  }

  private stopClicks() {
    const now = this.ctx?.currentTime ?? 0;
    for (const c of this.clicks) {
      try {
        c.stop(now);
      } catch {
        /* already stopped */
      }
    }
    this.clicks = [];
  }

  private tick() {
    const ctx = this.ctx!;
    const project = this.project!;
    if (this.mode === 'arrange' && this.segments.length) {
      const last = this.segments[this.segments.length - 1];
      const lastEnd = last.time + (last.toBar - last.fromBar) * secondsPerBar(project.bpm);
      if (lastEnd - ctx.currentTime < LOOKAHEAD) {
        if (project.loop.enabled && project.loop.end > project.loop.start) {
          this.queueSegment(lastEnd, project.loop.start, project.loop.end);
        } else if (ctx.currentTime >= lastEnd) {
          this.stop();
          return;
        }
      }
    }
    if (this.mode === 'session') {
      const spb = secondsPerBar(project.bpm);
      const until = (ctx.currentTime + LOOKAHEAD - this.sessionOrigin) / spb;
      if (this.metronome && until > this.sessionClickedTo) {
        this.scheduleClicks(this.sessionOrigin + this.sessionClickedTo * spb, this.sessionClickedTo, until);
        this.sessionClickedTo = until;
      }
      if (until > this.sessionPumpedTo) {
        this.mix?.schedulePump(project, this.sessionOrigin + this.sessionPumpedTo * spb, this.sessionPumpedTo, until);
        this.sessionPumpedTo = until;
      }
    }
    this.emit();
  }

  /** Current transport position in bars. */
  position(): number {
    if (!this.ctx || !this.playing || !this.project) return 0;
    const now = this.ctx.currentTime;
    const spb = secondsPerBar(this.project.bpm);
    if (this.mode === 'session') return Math.max(0, (now - this.sessionOrigin) / spb);
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      if (now >= s.time) return Math.min(s.toBar, s.fromBar + (now - s.time) / spb);
    }
    return this.segments[0]?.fromBar ?? 0;
  }

  /** Re-schedule after edits while playing, keeping the playhead. */
  async refresh(project: Project) {
    if (!this.playing || this.mode !== 'arrange') {
      this.project = project;
      this.syncMixer(project);
      return;
    }
    const pos = this.position();
    await this.play(project, pos);
  }

  stop() {
    this.stopAll();
    this.playing = false;
    this.emit();
  }

  private stopAll() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx?.currentTime ?? 0;
    for (const s of this.sources) {
      try {
        s.stop(now);
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.segments = [];
    for (const v of this.sessionVoices.values()) {
      try {
        v.source.stop(now);
      } catch {
        /* already stopped */
      }
    }
    this.sessionVoices.clear();
    this.stopClicks();
    this.mix?.resetPump();
    this.sessionVersion++;
  }

  // ---------------- session (clip launching) ----------------

  private async ensureSessionClock(project: Project) {
    await this.unlock();
    this.project = project;
    if (!this.playing || this.mode !== 'session') {
      this.stopAll();
      this.mode = 'session';
      this.sessionOrigin = this.ctx!.currentTime + 0.06;
      this.sessionClickedTo = 0;
      this.sessionPumpedTo = 0;
      this.playing = true;
      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.tick(); // schedule right away, or the first downbeat's click is already in the past
    }
    this.syncMixer(project);
  }

  /** Next bar boundary of the session clock. */
  private nextBar(): number {
    const spb = secondsPerBar(this.project!.bpm);
    return nextBoundary(this.ctx!.currentTime + 0.03, this.sessionOrigin, spb);
  }

  async launchSlot(project: Project, trackId: string, scene: number) {
    const track = project.tracks.find((t) => t.id === trackId);
    const slot = track?.slots[scene];
    if (!track || !slot) return;
    const sample = this.samples.get(slot.sampleId);
    if (!sample) return;
    const buffer = await this.loadBuffer(slot.sampleId);
    await this.ensureSessionClock(project);
    const when = this.nextBar();
    const prev = this.sessionVoices.get(trackId);
    if (prev) prev.source.stop(when);
    const source = startVoice(this.ctx!, buffer, sample, project.bpm, this.trackGain(track), when, 0, null);
    this.sessionVoices.set(trackId, { source, sampleId: slot.sampleId, scene });
    this.sessionVersion++;
    this.emit();
  }

  async launchScene(project: Project, scene: number) {
    await Promise.all(
      project.tracks.map((t) => (t.slots[scene] ? this.launchSlot(project, t.id, scene) : this.stopTrack(t.id))),
    );
  }

  stopTrack(trackId: string) {
    const v = this.sessionVoices.get(trackId);
    if (!v || !this.ctx) return;
    const when = this.nextBar();
    v.source.stop(when);
    this.sessionVoices.delete(trackId);
    this.sessionVersion++;
    this.emit();
  }

  /** Scene index currently playing per track (session mode). */
  activeSlots(): Map<string, number> {
    return new Map([...this.sessionVoices].map(([id, v]) => [id, v.scene]));
  }

  // ---------------- preview ----------------

  /** Play one synth note now (piano roll taps). */
  async previewNote(synth: SynthSettings, pitch: number) {
    const ctx = await this.unlock();
    if (synth.wave === 'sample' && synth.sampleId) await this.loadBuffer(synth.sampleId).catch(() => undefined);
    startSynthVoice(ctx, synth, pitch, voicePeak(synth, 0.8), ctx.currentTime + 0.01, 0.2, this.master!, this.buffers);
  }

  async preview(sample: Sample, projectBpm: number) {
    const ctx = await this.unlock();
    const buffer = await this.loadBuffer(sample.id);
    this.stopPreview();
    const src = ctx.createBufferSource({ pitchCorrection: false });
    src.buffer = buffer;
    src.playbackRate.value = warpRate(projectBpm, sample.bpm);
    src.connect(this.master!);
    src.start();
    src.onEnded = () => {
      if (this.previewSource === src) this.previewSource = null;
      this.emit();
    };
    this.previewSource = src;
    this.emit();
  }

  stopPreview() {
    try {
      this.previewSource?.stop();
    } catch {
      /* already stopped */
    }
    this.previewSource = null;
  }

  isPreviewing(): boolean {
    return this.previewSource !== null;
  }

  // ---------------- offline render ----------------

  /** Render the arrangement (or the loop region) to an AudioBuffer. */
  async render(project: Project, region: { from: number; to: number }): Promise<AudioBuffer> {
    const ids = arrangementSampleIds(project);
    await Promise.all([...ids].map((id) => this.loadBuffer(id)));
    const sampleRate = 44100;
    const seconds = (region.to - region.from) * secondsPerBar(project.bpm);
    // Stretchers compensate their latency only for audio scheduled ahead: give them a short lead-in.
    const lead = Platform.OS === 'web' && usesStretch(project, this.samples) ? 0.1 : 0;
    const off = new OfflineAudioContext(2, Math.ceil((seconds + lead) * sampleRate) + sampleRate, sampleRate);
    const mix = new MixGraph(off, off.destination);
    mix.apply(project, false);
    mix.schedulePump(project, lead, region.from, region.to);
    const voices = scheduleWindow(off, project, this.samples, this.buffers, (t) => mix.input(t), lead, region.from, region.to);
    // Offline rendering runs far faster than real time: stretchers must have everything first.
    // (Pausing the render with suspend() instead crashes Chromium together with the worklet.)
    await Promise.all(voices.map(voiceReady));
    const rendered = await off.startRendering();
    return trimTo(rendered, seconds, lead);
  }
}

/** `seconds` of audio starting `skip` seconds in. */
function trimTo(buffer: AudioBuffer, seconds: number, skip = 0): AudioBuffer {
  const start = Math.round(skip * buffer.sampleRate);
  const frames = Math.min(buffer.length - start, Math.ceil(seconds * buffer.sampleRate));
  const out = new AudioBuffer({ length: frames, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).subarray(start, start + frames), c);
  return out;
}

export const engine = new AudioEngine();
