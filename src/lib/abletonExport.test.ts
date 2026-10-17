import { DEFAULT_SEQ } from '../audio/notefx';
import type { Clip, Project, Track } from '../types';
import { hasEffects, wetProject, noteName, samplerFileName, samplerSample, clipNotes, exportableTracks, instrumentText, liveColor, midiTrackNotes, projectInfoText, readmeText, trackEffectHints, trackFileName, wavInfo } from './abletonExport';
import { encodeWav } from '../audio/wav';

const clip = (start: number, length: number, notes?: Clip['notes'], extra: Partial<Clip> = {}): Clip => ({ id: `c${start}`, sampleId: notes ? '' : 's1', start, length, offset: 0, notes, ...extra });
const track = (over: Partial<Track> = {}): Track => ({ id: 't', name: 'Lead', category: 'synth', color: '#fff', volume: 1, muted: false, solo: false, clips: [], ...over }) as Track;
const project = (tracks: Track[]): Project => ({ id: 'p', name: 'Vocal Session', bpm: 156, key: 'F minor', tracks, sceneCount: 4, loop: { enabled: false, start: 0, end: 4 }, markers: [{ id: 'm', bar: 16, name: 'Drop' }], updatedAt: 0 }) as Project;

describe('ableton export', () => {
  it('names files with the track number and a safe name', () => {
    expect(trackFileName(0, 'Kick + Bass/Rumble', 'wav')).toBe('01 Kick + Bass Rumble.wav');
    expect(trackFileName(11, '???', 'mid')).toBe('12 Spur.mid');
  });

  it('puts the notes of all clips on one timeline, cut at their clip and without deactivated clips', () => {
    const t = track({
      clips: [
        clip(0, 2, [{ pitch: 60, start: 0, length: 1, velocity: 1 }, { pitch: 62, start: 1.5, length: 2, velocity: 1 }]),
        clip(4, 2, [{ pitch: 64, start: 0.5, length: 1, velocity: 0.5 }]),
        clip(8, 2, [{ pitch: 65, start: 0, length: 1, velocity: 1 }], { muted: true }),
      ],
    });
    const notes = midiTrackNotes(t);
    expect(notes.map((n) => [n.pitch, n.start, n.length])).toEqual([[60, 0, 1], [62, 1.5, 0.5], [64, 4.5, 1]]);
  });

  it('exports the notes as they sound: the sequencer is applied', () => {
    const base = { pitch: 36, start: 0, length: 1, velocity: 1 };
    const plain = midiTrackNotes(track({ clips: [clip(0, 1, [base])] }));
    const seq = midiTrackNotes(track({ clips: [clip(0, 1, [base])], seq: { ...DEFAULT_SEQ, on: true } }));
    expect(plain).toHaveLength(1);
    expect(seq.length).toBeGreaterThan(1);
  });

  it('only exports tracks that have an active clip', () => {
    const a = track({ id: 'a', clips: [clip(0, 4)] });
    const b = track({ id: 'b', clips: [clip(0, 4, undefined, { muted: true })] });
    const c = track({ id: 'c', clips: [] });
    expect(exportableTracks(project([a, b, c])).map((t) => t.id)).toEqual(['a']);
  });

  it('describes what does not travel and the Live device for it', () => {
    const t = track({ name: 'Bass', volume: 0.5, fx: { pan: -0.5, drive: 0.4, reverb: 0.2 }, devices: [{ id: 'd', type: 'comp', on: true, params: {} }, { id: 'e', type: 'kickstart', on: false, params: {} }] });
    const hints = trackEffectHints(t);
    expect(hints.join('\n')).toContain('Saturator');
    expect(hints.join('\n')).toContain('Compressor → Compressor');
    expect(hints.join('\n')).toMatch(/Kickstart.*\(aus\)/);
    const info = projectInfoText(project([t]), [], [{ track: t, file: '01 Bass.wav' }], ['Spur „X“: Audio fehlt']);
    expect(info).toContain('Spur „X“: Audio fehlt');
    expect(info).toContain('Tempo: 156 BPM');
    expect(info).toContain('Takt 17: Drop');
    expect(info).toContain('-6.0 dB');
    expect(info).toContain('Pan L 50 %');
    expect(info).toContain('Wet-Version (mit den LOOPVX-Effekten, in Live stummgeschaltet): 01 Bass wet.wav');
  });

  it('describes instruments and the how-to', () => {
    expect(instrumentText(track({ synth: { wave: 'kit909', cutoff: 1, resonance: 0 } as Track['synth'] }), [])).toContain('Drum Rack');
    expect(instrumentText(track({ synth: { wave: 'sawtooth', cutoff: 2400, resonance: 0 } as Track['synth'] }), [])).toContain('2400 Hz');
    const smp = [{ id: 's9', name: 'Vocal Chop #3.mp3' }];
    const sampler = track({ synth: { wave: 'sample', sampleId: 's9', sampleRoot: 62, tune: -20, oneShot: true, cutoff: 1, resonance: 0 } as Track['synth'] });
    expect(instrumentText(sampler, smp)).toContain('Samples/Sampler/Vocal Chop 3.mp3');
    expect(instrumentText(sampler, smp)).toContain('Grundton D3, -20 Cent, One-Shot');
    expect(samplerSample(sampler, smp)?.id).toBe('s9');
    expect(samplerSample(track({ synth: { wave: 'sawtooth', cutoff: 1, resonance: 0 } as Track['synth'] }), smp)).toBeUndefined();
    expect(noteName(60)).toBe('C3');
    expect(noteName(36)).toBe('C1');
    expect(samplerFileName({ name: 'a/b:c' })).toBe('a b c.wav');
    expect(readmeText(project([]), 64.2, 'X Project')).toContain('65 Takte');
    expect(readmeText(project([]), 64, 'X Project')).toContain('156 BPM');
  });

  it('knows which tracks have effects and builds their wet render without fader and pan', () => {
    expect(hasEffects(track())).toBe(false);
    expect(hasEffects(track({ fx: { pan: 0.4 } }))).toBe(false);
    expect(hasEffects(track({ fx: { reverb: 0.2 } }))).toBe(true);
    expect(hasEffects(track({ devices: [{ id: 'd', type: 'eq', on: false, params: {} }] }))).toBe(false);
    expect(hasEffects(track({ devices: [{ id: 'd', type: 'eq', on: true, params: {} }] }))).toBe(true);
    const kick = track({ id: 'kick', name: 'Kick', volume: 0.7, clips: [clip(0, 4, [{ pitch: 36, start: 0, length: 1, velocity: 1 }])] });
    const bass = track({ id: 'bass', volume: 0.5, fx: { pump: 0.8, pumpFrom: 'kick', pan: -0.3, reverb: 0.1 }, clips: [clip(0, 4, undefined, { muted: false }), clip(8, 2, undefined, { muted: true })] });
    const w = wetProject(project([kick, bass]), bass);
    expect(w.tracks.map((t) => [t.id, t.volume])).toEqual([['bass', 1], ['kick', 0]]);
    expect(w.tracks[0].fx).toMatchObject({ pump: 0.8, pumpFrom: 'kick', reverb: 0.1, pan: 0 });
    expect(w.tracks[0].clips).toHaveLength(1);
    expect(wetProject(project([kick]), kick).tracks).toHaveLength(1);
  });

  it('cuts the notes of one clip and reads WAV headers', () => {
    const t = track({ clips: [clip(0, 1, [{ pitch: 60, start: 0.5, length: 2, velocity: 1 }, { pitch: 62, start: 1.5, length: 1, velocity: 1 }])] });
    expect(clipNotes(t, t.clips[0])).toEqual([{ pitch: 60, start: 0.5, length: 0.5, velocity: 1 }]);
    const wav = new Uint8Array(encodeWav({ sampleRate: 44100, channels: [new Float32Array(1000), new Float32Array(1000)] }));
    expect(wavInfo(wav)).toEqual({ frames: 1000, sampleRate: 44100 });
    expect(new Set([0, 1, 2, 3, 4].map(liveColor)).size).toBe(5);
  });
});
