import { planMissing } from './missingSamples';

describe('planMissing', () => {
  const local = [
    { id: 'a', name: 'Kick.wav' },
    { id: 'b', name: 'AI Vocal.mp3' },
    { id: 'drive:x', name: 'Loop.wav', driveId: 'x' },
    { id: 'c', name: 'Only here.wav' },
  ];
  const remote = new Map([
    ['b', { fileId: 'f1', name: 'AI Vocal.mp3' }],
    ['p', { fileId: 'f2', name: 'Project only.mp3' }],
  ]);

  it('finds samples without audio and where to load them from, project samples first', () => {
    const plan = planMissing(['p', 'a'], local, new Set(['a']), remote);
    expect(plan).toEqual([
      { id: 'p', name: 'Project only.mp3', from: 'sync', fileId: 'f2' },
      { id: 'b', name: 'AI Vocal.mp3', from: 'sync', fileId: 'f1' },
      { id: 'drive:x', name: 'Loop.wav', from: 'original', fileId: 'x' },
      { id: 'c', name: 'Only here.wav', from: 'none' },
    ]);
  });

  it('is empty when every sample has its audio', () => {
    expect(planMissing(['a'], local.slice(0, 1), new Set(['a']), remote)).toEqual([]);
  });

  it('a project sample that is nowhere stays missing under its id', () => {
    expect(planMissing(['zz'], [], new Set(), new Map())).toEqual([{ id: 'zz', name: 'zz', from: 'none' }]);
  });
});
