import { pickDriveFile } from './fxPick';

const f = (name: string, size = 3_000_000, mimeType = 'audio/wav') => ({ id: name, name, size: String(size), mimeType });
const karls = [
  f('006_PSP_PYREZ_SCREECH_LOOP_160_BPM_D.wav'),
  f('RY_WRAITH_HARDDANCE_SCREECH_LOOP_032_A_155BPM.wav'),
  f('KSHMR Riser (C#) - Screech.wav'),
  f('KSHMR Synth - PAJANE - Screech Mymind (F).wav', 165_420),
  f('RY_GLYPH_MIDI_SCREECH_LOOP_064_160BPM_F.mid', 300, 'audio/midi'),
  f('Screech Synth Loop 155 BPM Fmin.wav'),
];

describe('pickDriveFile', () => {
  it('takes the screech in F (a loop for a long request), never a MIDI file or another key', () => {
    const hit = { search: ['screech', 'synth'], key: 'F minor', length: 32 };
    expect(pickDriveFile(karls, hit, 155)?.name).toBe('Screech Synth Loop 155 BPM Fmin.wav');
    expect(pickDriveFile(karls.slice(0, 5), hit, 155)?.name).toBe('KSHMR Synth - PAJANE - Screech Mymind (F).wav');
  });
  it('finds nothing when only other keys or MIDI match', () => {
    expect(pickDriveFile(karls.slice(0, 3), { search: ['screech'], key: 'F minor' }, 155)).toBeUndefined();
    expect(pickDriveFile([karls[4]], { search: ['screech'] }, 155)).toBeUndefined();
  });
  it('needs a sound word, a key alone is not enough', () => {
    expect(pickDriveFile(karls, { search: ['fmin'], key: 'F minor' }, 155)).toBeUndefined();
  });
});

import { pickSpliceResult } from './fxPick';
describe('pickSpliceResult', () => {
  const r = (name: string, key: string | undefined, bpm: number, type: 'loop' | 'oneshot' = 'loop', tags: string[] = ['synth']) => ({ uuid: name, name, key, bpm, type, tags });
  it('takes the screech loop in F near the project tempo, not another key', () => {
    const list = [r('ZEN_NST_158_screech_synth_loop_dystopia_A.wav', 'a', 158), r('ZEN_NST_155_screech_synth_loop_plasma_F.wav', 'f', 155), r('ESM_150_synth_lead_kiss_fm.wav', 'f minor', 150)];
    expect(pickSpliceResult(list, { search: ['screech', 'synth'], key: 'F minor', length: 32 }, 155)?.name).toBe('ZEN_NST_155_screech_synth_loop_plasma_F.wav');
  });
  it('finds nothing without a word match', () => {
    expect(pickSpliceResult([r('kick_f.wav', 'f', 155, 'oneshot', ['kick'])], { search: ['screech'] }, 155)).toBeUndefined();
  });
});
