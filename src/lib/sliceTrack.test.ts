import { toSlices } from '../audio/slicing';
import { SLICE_ROOT } from '../audio/synth';
import { slicerTrack } from './sliceTrack';

const sample = { id: 'loop', name: 'Rolling Top Loop.wav', bpm: 150 };
// two bars at 150 BPM = 3.2 s, cut into 8 equal slices
const slices = toSlices(Array.from({ length: 8 }, (_, i) => i * 0.4), 3.2);
const base = { projectBpm: 150, sceneCount: 4 };

describe('slicerTrack', () => {
  it('sets up a MIDI track with a slicer instrument on the sample', () => {
    const t = slicerTrack(sample, slices, { ...base, mode: 'pads' });
    expect(t.kind).toBe('midi');
    expect(t.name).toBe('Rolling Top Loop Slices');
    expect(t.clips).toEqual([]);
    expect(t.synth).toMatchObject({ wave: 'sample', sampleId: 'loop', oneShot: true, sliceBpm: 150 });
    expect(t.synth?.slices).toHaveLength(8);
    expect(t.synth?.slices?.[1]).toBeCloseTo(0.4, 6);
  });
  it('plays the loop back in its original order as MIDI notes on pads 36..', () => {
    const t = slicerTrack(sample, slices, { ...base, mode: 'midi', startBar: 4 });
    const [clip] = t.clips;
    expect(clip.start).toBe(4);
    expect(clip.length).toBe(2);
    expect(clip.notes!.map((n) => n.pitch)).toEqual(Array.from({ length: 8 }, (_, i) => SLICE_ROOT + i));
    expect(clip.notes![1].start).toBeCloseTo(0.25, 6);
    expect(clip.notes![1].length).toBeCloseTo(0.25, 6);
    expect(clip.notes![7].start + clip.notes![7].length).toBeCloseTo(2, 6);
  });
  it('lays the notes out at the project tempo when the loop has another tempo', () => {
    // the same loop played at 160 BPM is shorter: 2 bars of 1.5 s = 3 s, slices keep their share
    const t = slicerTrack(sample, slices, { ...base, projectBpm: 160, mode: 'midi' });
    expect(t.clips[0].length).toBe(2);
    expect(t.clips[0].notes![4].start).toBeCloseTo(1, 6);
  });
  it('a loop without a tempo is not warped and has no sliceBpm', () => {
    const t = slicerTrack({ id: 'x', name: 'Hit', bpm: undefined }, toSlices([0, 0.8], 1.6), { ...base, mode: 'midi' });
    expect(t.synth?.sliceBpm).toBeUndefined();
    expect(t.clips[0].notes![1].start).toBeCloseTo(0.5, 6);
    expect(t.clips[0].length).toBe(1);
  });
  it('makes no clip without slices', () => {
    expect(slicerTrack(sample, [], { ...base, mode: 'midi' }).clips).toEqual([]);
  });
});
