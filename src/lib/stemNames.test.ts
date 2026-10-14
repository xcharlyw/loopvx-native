import { byStemOrder, stemFolder, stemSample, tuneName } from './stemNames';

describe('stem names', () => {
  it('makes a folder per tune under Stems Export', () => {
    expect(tuneName('Carl Haze - Rave/Machine (155 BPM, Fmin).wav')).toBe('Carl Haze - Rave Machine (155 BPM, Fmin)');
    expect(stemFolder('My Tune')).toBe('Stems Export/My Tune');
  });
  it('gives every stem the tune tempo and key and a category by stem', () => {
    const s = stemSample('My Tune 155 BPM Fmin.wav', { id: 'abc', name: 'My Tune 155 BPM Fmin - Drums.mp3', stem: 'Drums', size: 10 });
    expect(s).toMatchObject({ id: 'drive:abc', driveId: 'abc', folder: 'Stems Export/My Tune 155 BPM Fmin', category: 'kick', bpm: 155, key: 'F minor' });
    expect(stemSample('x.wav', { id: 'v', name: 'x - Vocal.mp3', stem: 'Vocal' }).category).toBe('vocal');
    expect(stemSample('x.wav', { id: 'o', name: 'x - Synth + FX.mp3', stem: 'Synth + FX' }).category).toBe('synth');
  });
  it('sorts drums, bass, synth first and vocal last', () => {
    expect(byStemOrder([{ stem: 'Vocal' }, { stem: 'Synth + FX' }, { stem: 'Drums' }, { stem: 'Bass' }]).map((x) => x.stem)).toEqual(['Drums', 'Bass', 'Synth + FX', 'Vocal']);
  });
});
