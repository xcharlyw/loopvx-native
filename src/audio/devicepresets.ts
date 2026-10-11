import type { Device, DeviceType } from '../types';
import { deviceParams } from './devices';

// Factory presets of the devices, in the spirit of the stock presets of a DAW: a few useful starting points per effect.
// A preset lists only what differs from the device's defaults; "Standard" is the device as it comes.

export interface DevicePreset {
  id: string;
  name: string;
  params: Record<string, number>;
}

const P = (id: string, name: string, params: Record<string, number> = {}): DevicePreset => ({ id, name, params });

export const DEVICE_PRESETS: Record<DeviceType, DevicePreset[]> = {
  eq: [
    P('default', 'Standard'),
    P('lowcut-30', 'Low Cut 30 Hz', { hp: 30 }),
    P('lowcut-100', 'Low Cut 100 Hz', { hp: 100 }),
    P('bass-boost', 'Bass Boost', { lsF: 90, lsG: 6 }),
    P('kick-punch', 'Kick Punch', { lsF: 55, lsG: 3, p1F: 300, p1G: -4, p1Q: 1.2, p2F: 3500, p2G: 3, p2Q: 1.5 }),
    P('mud-cut', 'Mud Cut', { p1F: 250, p1G: -5, p1Q: 1.2 }),
    P('vocal-presence', 'Vocal Presence', { hp: 100, p1F: 300, p1G: -2, p2F: 3000, p2G: 3, hsF: 10000, hsG: 2 }),
    P('air', 'Air', { hsF: 10000, hsG: 5 }),
    P('hat-clean', 'Hat Clean', { hp: 300, hsF: 9000, hsG: 2 }),
    P('dark', 'Dark', { hsF: 6000, hsG: -6, lp: 9000 }),
    P('telephone', 'Telephone', { hp: 400, lp: 3500, p2F: 1500, p2G: 4, p2Q: 1 }),
    P('sub-only', 'Sub Only', { hp: 30, lp: 120 }),
  ],
  comp: [
    P('default', 'Standard'),
    P('glue', 'Glue', { threshold: -20, ratio: 2, attack: 30, release: 200, knee: 8, makeup: 2 }),
    P('punchy', 'Punchy', { threshold: -22, ratio: 4, attack: 25, release: 80, knee: 4, makeup: 3 }),
    P('bass-tight', 'Bass Tight', { threshold: -24, ratio: 6, attack: 10, release: 120, knee: 3, makeup: 3 }),
    P('vocal-leveler', 'Vocal Leveler', { threshold: -26, ratio: 3, attack: 8, release: 150, knee: 10, makeup: 4 }),
    P('squash', 'Squash', { threshold: -30, ratio: 12, attack: 3, release: 60, knee: 0, makeup: 8 }),
    P('parallel-crush', 'Parallel Crush', { threshold: -34, ratio: 10, attack: 5, release: 80, knee: 0, makeup: 6, mix: 0.4 }),
  ],
  sat: [
    P('default', 'Standard'),
    P('gentle-warmth', 'Gentle Warmth', { mode: 0, drive: 4, out: -1, mix: 0.5 }),
    P('warm-tube', 'Warm Tube', { mode: 3, drive: 6, tone: 12000, out: -2 }),
    P('soft-clip', 'Soft Clip', { mode: 0, drive: 12, out: -4 }),
    P('hard-drive', 'Hard Drive', { mode: 1, drive: 15, out: -6 }),
    P('wavefold', 'Wavefold Crunch', { mode: 2, drive: 10, out: -5, mix: 0.6 }),
    P('dirty-sub', 'Dirty Sub', { mode: 3, drive: 14, tone: 3000, out: -6, mix: 0.5 }),
    P('techno-dist', 'Techno Distortion', { mode: 1, drive: 20, tone: 5000, out: -8, mix: 0.7 }),
  ],
  echo: [
    P('default', 'Standard'),
    P('dub-dotted', 'Dub Dotted 1/8', { sync: 1, division: 2, feedback: 0.5, hp: 200, lp: 4000, mix: 0.35 }),
    P('slapback', 'Slapback', { sync: 0, time: 110, feedback: 0.15, mix: 0.25 }),
    P('pingpong-quarter', 'Ping Pong 1/4', { sync: 1, division: 3, feedback: 0.45, pingpong: 1, mix: 0.3 }),
    P('tape-echo', 'Tape Echo', { sync: 0, time: 320, feedback: 0.55, hp: 150, lp: 3000, mix: 0.3 }),
    P('techno-sixteenth', 'Techno 1/16', { sync: 1, division: 0, feedback: 0.4, hp: 400, lp: 6000, mix: 0.3 }),
    P('ambient-long', 'Ambient Long', { sync: 1, division: 4, feedback: 0.7, lp: 3500, pingpong: 1, mix: 0.4 }),
  ],
  reverb: [
    P('default', 'Standard'),
    P('small-room', 'Small Room', { size: 0.6, lowcut: 150, damp: 8000, mix: 0.2 }),
    P('plate', 'Plate', { size: 1.4, predelay: 10, lowcut: 200, damp: 10000, mix: 0.25 }),
    P('hall', 'Hall', { size: 3, predelay: 25, lowcut: 150, damp: 7000, mix: 0.3 }),
    P('cathedral', 'Cathedral', { size: 5.5, predelay: 40, lowcut: 200, damp: 5000, mix: 0.35 }),
    P('dark-room', 'Dark Room', { size: 2, lowcut: 250, damp: 3000, mix: 0.3 }),
    P('rave-wash', 'Rave Wash', { size: 4, lowcut: 300, damp: 9000, mix: 0.5 }),
    P('short-gate', 'Short Burst', { size: 0.4, damp: 6000, mix: 0.3 }),
  ],
  chorus: [
    P('default', 'Standard'),
    P('classic', 'Classic', { rate: 0.5, depth: 0.4, delay: 12, mix: 0.4 }),
    P('wide-ensemble', 'Wide Ensemble', { rate: 0.3, depth: 0.7, delay: 18, mix: 0.5 }),
    P('subtle', 'Subtle Thickener', { rate: 0.8, depth: 0.2, delay: 9, mix: 0.3 }),
    P('flanger', 'Flanger', { rate: 0.25, depth: 0.6, delay: 3, feedback: 0.6, mix: 0.5 }),
    P('vibrato', 'Vibrato', { rate: 5, depth: 0.3, delay: 6, mix: 1 }),
  ],
  filter: [
    P('default', 'Standard'),
    P('lp-warm', 'LP Warm', { type: 0, cutoff: 1200, res: 2 }),
    P('lp-sweep', 'LP Sweep', { type: 0, cutoff: 800, res: 8, lfoRate: 0.25, lfoDepth: 2 }),
    P('hp-clean', 'HP Clean', { type: 1, cutoff: 200, res: 0 }),
    P('band-wah', 'Band Wah', { type: 2, cutoff: 900, res: 8, lfoRate: 1.5, lfoDepth: 1.2 }),
    P('acid', 'Acid Squelch', { type: 0, cutoff: 600, res: 18, lfoRate: 0.5, lfoDepth: 1.5 }),
  ],
  limiter: [
    P('default', 'Standard'),
    P('gentle-guard', 'Gentle Guard', { gain: 0, ceiling: -2 }),
    P('loud-3', 'Loud +3 dB', { gain: 3, ceiling: -0.5 }),
    P('loud-6', 'Loud +6 dB', { gain: 6, ceiling: -0.5 }),
    P('brickwall', 'Brickwall -1 dB', { gain: 2, ceiling: -1 }),
  ],
  utility: [
    P('default', 'Standard'),
    P('minus-6', '-6 dB', { gain: -6 }),
    P('minus-12', '-12 dB', { gain: -12 }),
    P('plus-6', '+6 dB', { gain: 6 }),
    P('invert', 'Phase invertiert', { invert: 1 }),
    P('pan-left', 'Pan links', { pan: -1 }),
    P('pan-right', 'Pan rechts', { pan: 1 }),
  ],
};

/** The parameter set of a preset: every parameter, the ones it does not mention at their defaults. */
export const presetParams = (type: DeviceType, preset: DevicePreset): Record<string, number> => deviceParams({ type, params: preset.params });

/** The preset a device currently matches exactly (the first one, so "Standard" wins for an untouched device), if any. */
export function presetOf(device: Pick<Device, 'type' | 'params'>): DevicePreset | undefined {
  const own = deviceParams(device);
  return DEVICE_PRESETS[device.type]?.find((preset) => {
    const wanted = presetParams(device.type, preset);
    return Object.keys(wanted).every((k) => Math.abs(wanted[k] - own[k]) < 1e-9);
  });
}
