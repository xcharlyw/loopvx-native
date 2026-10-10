import {
  clipEnvelope,
  clipFades,
  clipGainAt,
  dbToGain,
  formatBarPosition,
  formatClock,
  loopEndSeconds,
  nextBoundary,
  parseSampleName,
  planClip,
  sampleLengthBars,
  secondsPerBar,
  warpRate,
} from './timing';

describe('tempo math', () => {
  it('computes seconds per bar', () => {
    expect(secondsPerBar(120)).toBeCloseTo(2);
    expect(secondsPerBar(160)).toBeCloseTo(1.5);
  });

  it('warps loops to the project tempo', () => {
    expect(warpRate(160, 160)).toBe(1);
    expect(warpRate(155, 150)).toBeCloseTo(155 / 150);
    expect(warpRate(150)).toBe(1);
  });

  it('measures loop length in bars and snaps to beats', () => {
    // 12.0 s at 160 BPM = 8 bars
    expect(sampleLengthBars(12.0, 155, 160)).toBe(8);
    // a few extra milliseconds of tail are ignored
    expect(sampleLengthBars(12.004, 155, 160)).toBe(8);
    expect(loopEndSeconds(12.004, 160)).toBeCloseTo(12.0);
  });

  it('finds the next bar boundary', () => {
    expect(nextBoundary(0.2, 0, 1.5)).toBeCloseTo(1.5);
    expect(nextBoundary(3.0, 0, 1.5)).toBeCloseTo(3.0);
    expect(nextBoundary(-1, 0, 1.5)).toBe(0);
  });
});

describe('clip gain and fades', () => {
  const clip = { id: 'c', sampleId: 's', start: 4, length: 8, offset: 0 };

  it('is flat without gain or fades', () => {
    expect(clipEnvelope(clip, 0, 8)).toEqual([
      { pos: 0, gain: 1 },
      { pos: 8, gain: 1 },
    ]);
  });

  it('ramps through fade in and fade out', () => {
    const c = { ...clip, fadeIn: 2, fadeOut: 1 };
    expect(clipEnvelope(c, 0, 8)).toEqual([
      { pos: 0, gain: 0 },
      { pos: 2, gain: 1 },
      { pos: 7, gain: 1 },
      { pos: 8, gain: 0 },
    ]);
    expect(clipGainAt(c, 1)).toBeCloseTo(0.5);
    expect(clipGainAt(c, 7.5)).toBeCloseTo(0.5);
  });

  it('starts mid-fade when the window starts inside it', () => {
    const c = { ...clip, fadeIn: 4 };
    expect(clipEnvelope(c, 1, 3)).toEqual([
      { pos: 1, gain: 0.25 },
      { pos: 3, gain: 0.75 },
    ]);
  });

  it('applies the clip gain in dB', () => {
    expect(clipGainAt({ ...clip, gainDb: -6 }, 3)).toBeCloseTo(0.501, 3);
    expect(dbToGain(0)).toBe(1);
  });

  it('shrinks fades that together exceed the clip', () => {
    expect(clipFades({ ...clip, length: 2, fadeIn: 2, fadeOut: 2 })).toEqual({ fadeIn: 1, fadeOut: 1 });
  });
});

describe('planClip', () => {
  const clip = { id: 'c', sampleId: 's', start: 4, length: 8, offset: 0 };

  it('skips clips with a broken position instead of scheduling NaN', () => {
    expect(planClip({ ...clip, start: NaN }, 0, 16, 2)).toBeNull();
    expect(planClip({ ...clip, offset: null as unknown as number }, 0, 16, 2)).toBeNull();
  });

  it('returns null outside the window', () => {
    expect(planClip(clip, 0, 4, 2)).toBeNull();
    expect(planClip(clip, 12, 16, 2)).toBeNull();
  });

  it('delays a clip that starts later in the window', () => {
    expect(planClip(clip, 2, 16, 2)).toEqual({ delayBars: 2, offsetBars: 0, durationBars: 8 });
  });

  it('starts mid-clip with the correct loop offset', () => {
    const plan = planClip(clip, 7, 9, 2)!;
    expect(plan.delayBars).toBe(0);
    expect(plan.offsetBars).toBeCloseTo(1); // 3 bars into a 2-bar loop
    expect(plan.durationBars).toBe(2);
  });
});

describe('formatting', () => {
  it('formats bar positions', () => {
    expect(formatBarPosition(0)).toBe('001.1.1');
    expect(formatBarPosition(14)).toBe('015.1.1');
    expect(formatBarPosition(1.3125)).toBe('002.2.2');
  });
  it('formats the clock', () => {
    expect(formatClock(28)).toBe('00:28.000');
    expect(formatClock(75.5)).toBe('01:15.500');
  });
});

describe('parseSampleName', () => {
  it('reads tempo, key and category from typical pack names', () => {
    expect(parseSampleName('ZEN_NST_160_kick_bass_loop_fiesta_E.wav')).toEqual({ bpm: 160, key: 'E', category: 'kick' });
    expect(parseSampleName('ZEN_NST_160_drums_loop_no_kick_fiesta_E.wav')).toMatchObject({ bpm: 160, category: 'top' });
    expect(parseSampleName('ZEN_PUM_150_lead_synth_dark_C#min.wav')).toEqual({ bpm: 150, key: 'C# minor', category: 'synth' });
    expect(parseSampleName('91V_HT_145_vocal_hook_hold_my_hand_lead_wet_Em.wav')).toEqual({ bpm: 145, key: 'E minor', category: 'vocal' });
    expect(parseSampleName('DS_HT_150_drum_kick_bomber_rumble_C#.wav')).toEqual({ bpm: 150, key: 'C#', category: 'kick' });
  });

  it('handles explicit bpm markers and leading numbers', () => {
    expect(parseSampleName('Bpm150_Bono_Kick.wav').bpm).toBe(150);
    expect(parseSampleName('019_Arp_-_Intro_Arp_160bpm_Ab_-_HMT.wav').bpm).toBe(160);
  });

  it('uses the folder name for the category', () => {
    expect(parseSampleName('loop_01.wav', 'Synths').category).toBe('synth');
    expect(parseSampleName('thing.wav', 'Kicks').category).toBe('kick');
  });
});
