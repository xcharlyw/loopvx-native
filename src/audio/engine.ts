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
} from 'react-native-audio-api';
import type { Project, Sample, Track } from '../types';
import { audibleGain } from '../lib/project';
import { loopEndSeconds, nextBoundary, planClip, projectEndBars, sampleLengthBars, secondsPerBar, warpRate } from './timing';

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
  const src = ctx.createBufferSource({ pitchCorrection: false });
  src.buffer = buffer;
  src.playbackRate.value = warpRate(projectBpm, sample.bpm);
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
): AudioBufferSourceNode[] {
  const spb = secondsPerBar(project.bpm);
  const sources: AudioBufferSourceNode[] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const sample = samples.get(clip.sampleId);
      const buffer = buffers.get(clip.sampleId);
      if (!sample || !buffer) continue;
      const loopBars = sampleLengthBars(buffer.duration, project.bpm, sample.bpm);
      const plan = planClip(clip, fromBar, toBar, loopBars);
      if (!plan) continue;
      const when = time + plan.delayBars * spb;
      sources.push(startVoice(ctx, buffer, sample, project.bpm, trackDest(track), when, plan.offsetBars, plan.durationBars));
    }
  }
  return sources;
}

export type EngineMode = 'arrange' | 'session';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  analyser: AnalyserNode | null = null;
  private trackGains = new Map<string, GainNode>();
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer>>();
  private samples = new Map<string, Sample>();
  private project: Project | null = null;

  playing = false;
  /** Bumped whenever session clips start or stop, for UI subscriptions. */
  sessionVersion = 0;
  mode: EngineMode = 'arrange';
  private sources: AudioBufferSourceNode[] = [];
  private segments: Segment[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private sessionOrigin = 0;
  private sessionVoices = new Map<string, SessionVoice>();
  private previewSource: AudioBufferSourceNode | null = null;
  private listeners = new Set<() => void>();

  /** Called with the decoded duration so the sample record can be updated. */
  onDuration?: (sampleId: string, duration: number) => void;

  /** Create/activate the AudioContext and its session. Call from a user gesture (e.g. tapping play). */
  async unlock(): Promise<AudioContext> {
    if (!this.ctx) {
      AudioManager.setAudioSessionOptions({ iosCategory: 'playback' });
      await AudioManager.setAudioSessionActivity(true);
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx;
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
    if (!sample.uri) throw new Error(`Audio für "${sample.name}" nicht gefunden`);
    const p = (async () => {
      const ctx = await this.unlock();
      const buffer = await ctx.decodeAudioData(sample.uri!);
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

  private trackGain(track: Track): GainNode {
    let g = this.trackGains.get(track.id);
    if (!g) {
      g = this.ctx!.createGain();
      g.connect(this.master!);
      this.trackGains.set(track.id, g);
    }
    return g;
  }

  /** Apply volumes, mute and solo. Safe to call on every project change. */
  syncMixer(project: Project) {
    this.project = project;
    if (!this.ctx) return;
    const anySolo = project.tracks.some((t) => t.solo);
    for (const t of project.tracks) {
      this.trackGain(t).gain.setTargetAtTime(audibleGain(t, anySolo), this.ctx.currentTime, 0.015);
    }
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
    const ids = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.sampleId)));
    await Promise.all([...ids].map((id) => this.loadBuffer(id).catch(() => undefined)));
    this.syncMixer(project);
    const ctx = this.ctx!;
    const start = ctx.currentTime + 0.06;
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
      this.playing = true;
      this.timer = setInterval(() => this.tick(), TICK_MS);
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

  async preview(sample: Sample, projectBpm: number) {
    const buffer = await this.loadBuffer(sample.id);
    const ctx = await this.unlock();
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
    const ids = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.sampleId)));
    await Promise.all([...ids].map((id) => this.loadBuffer(id)));
    const sampleRate = 44100;
    const seconds = (region.to - region.from) * secondsPerBar(project.bpm);
    const off = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate) + sampleRate, sampleRate);
    const anySolo = project.tracks.some((t) => t.solo);
    const gains = new Map<string, GainNode>();
    for (const t of project.tracks) {
      const g = off.createGain();
      g.gain.value = audibleGain(t, anySolo);
      g.connect(off.destination);
      gains.set(t.id, g);
    }
    scheduleWindow(off, project, this.samples, this.buffers, (t) => gains.get(t.id)!, 0, region.from, region.to);
    const rendered = await off.startRendering();
    return trimTo(rendered, seconds);
  }
}

function trimTo(buffer: AudioBuffer, seconds: number): AudioBuffer {
  const frames = Math.min(buffer.length, Math.ceil(seconds * buffer.sampleRate));
  const out = new AudioBuffer({ length: frames, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).subarray(0, frames), c);
  return out;
}

export const engine = new AudioEngine();
