import { DEFAULT_SEQ } from '../audio/notefx';
import type { Clip, Project, Track } from '../types';
import { exportableTracks, instrumentText, midiTrackNotes, projectInfoText, readmeText, trackEffectHints, trackFileName } from './abletonExport';

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
    const info = projectInfoText(project([t]), [], [{ track: t, file: '01 Bass.wav' }]);
    expect(info).toContain('Tempo: 156 BPM');
    expect(info).toContain('Takt 17: Drop');
    expect(info).toContain('-6.0 dB');
    expect(info).toContain('Pan L 50 %');
  });

  it('describes instruments and the how-to', () => {
    expect(instrumentText(track({ synth: { wave: 'kit909', cutoff: 1, resonance: 0 } as Track['synth'] }), [])).toContain('Drum Rack');
    expect(instrumentText(track({ synth: { wave: 'sawtooth', cutoff: 2400, resonance: 0 } as Track['synth'] }), [])).toContain('2400 Hz');
    expect(readmeText(project([]), 64.2)).toContain('65 Takte');
    expect(readmeText(project([]), 64)).toContain('156 BPM');
  });
});
