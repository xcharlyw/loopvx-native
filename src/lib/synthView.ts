import { activeMods } from '../audio/synth';
import type { ModTarget, SynthSettings } from '../types';

// What the synth's page shows, as pure functions: how much of each knob's dial a modulation sweeps (the rings of a wavetable synth)
// and which layout fits the window.

/** The knobs that carry a modulation ring, and how far one full mod amount moves them on their dial. */
const DIAL_SPAN: Partial<Record<ModTarget, number>> = {
  // cutoff: ±4 octaves on a 40 Hz..16 kHz log knob
  cutoff: 4 / Math.log2(16000 / 40),
  // resonance: ±12 dB on the 0.5..20 knob
  reso: 12 / (20 - 0.5),
  // wavetable positions: the whole table
  posA: 1,
  posB: 1,
};

export type RingTarget = 'cutoff' | 'reso' | 'posA' | 'posB';

/** The signed part of the dial each modulated knob sweeps, summed over the audible routings to it (clamped to the whole dial). */
export function modRings(synth: Pick<SynthSettings, 'mods' | 'tableA' | 'oscB'>): Record<RingTarget, number> {
  const out: Record<RingTarget, number> = { cutoff: 0, reso: 0, posA: 0, posB: 0 };
  for (const m of activeMods(synth)) {
    const span = DIAL_SPAN[m.target];
    if (span === undefined) continue;
    const key = m.target as RingTarget;
    out[key] = Math.max(-1, Math.min(1, out[key] + m.amount * span));
  }
  return out;
}

/** How the synth page is laid out: one screen like a plugin (wide window), two columns, or tabs on a phone. */
export type SynthLayout = 'rack' | 'columns' | 'tabs';
export const synthLayout = (width: number): SynthLayout => (width >= 900 ? 'rack' : width >= 620 ? 'columns' : 'tabs');

/** The tempo-synced LFO rates (cycles per bar) the rate knob steps through. */
export const LFO_RATES = [0.25, 0.5, 1, 2, 4, 8, 16];
export const lfoRateLabel = (r: number) => (r === 0.25 ? '4 Takte' : r === 0.5 ? '2 Takte' : r === 1 ? '1 Takt' : `1/${r}`);
/** The knob position (an index) of a rate; LFO 1 has "Aus" at 0 before the rates. */
export function rateIndex(rate: number | undefined, withOff: boolean): number {
  if (!rate) return withOff ? 0 : LFO_RATES.indexOf(1);
  const i = LFO_RATES.reduce((best, r, k) => (Math.abs(Math.log2(r / rate)) < Math.abs(Math.log2(LFO_RATES[best] / rate)) ? k : best), 0);
  return withOff ? i + 1 : i;
}
export function rateAt(index: number, withOff: boolean): number | undefined {
  const i = Math.round(index) - (withOff ? 1 : 0);
  return i < 0 ? undefined : LFO_RATES[Math.max(0, Math.min(LFO_RATES.length - 1, i))];
}
