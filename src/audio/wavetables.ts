// Wavetables of the synth (Serum / Vital style): each table is a family of single-cycle waves along a position
// 0..1. A table is defined in the time domain (`shape(pos, t)` for t in [0, 1)), and the engine plays a frame as a
// PeriodicWave built from its harmonics (`tableSpectrum`), so every frame is band-limited like the built-in waves.

export type TableId = 'basic' | 'pwm' | 'harm' | 'vowel' | 'sync' | 'fold' | 'fm' | 'screech' | 'acid';

export interface Wavetable {
  id: TableId;
  /** Shown in the table picker. */
  label: string;
  /** One line for the picker. */
  hint: string;
  shape: (pos: number, t: number) => number;
}

const TAU = Math.PI * 2;
const frac = (x: number) => x - Math.floor(x);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const sine = (t: number) => Math.sin(TAU * t);
const tri = (t: number) => 1 - 4 * Math.abs(frac(t + 0.25) - 0.5);
const saw = (t: number) => 2 * frac(t + 0.5) - 1;
const square = (t: number) => (frac(t) < 0.5 ? 1 : -1);
/** Blend between a list of shapes along pos (0 = first, 1 = last). */
const morph = (shapes: ((t: number) => number)[], pos: number, t: number) => {
  const x = clamp01(pos) * (shapes.length - 1);
  const i = Math.min(shapes.length - 2, Math.floor(x));
  const f = x - i;
  return shapes[i](t) * (1 - f) + shapes[i + 1](t) * f;
};
/** Sum of harmonics with amplitude `amp(n)` (sine phase). */
const additive = (amp: (n: number) => number, t: number, max = 64) => {
  let v = 0;
  for (let n = 1; n <= max; n++) {
    const a = amp(n);
    if (a) v += a * Math.sin(TAU * n * t);
  }
  return v;
};
/** Formants (in multiples of a 220 Hz fundamental) of the vowels A, E, I, O, U. */
const VOWELS: [number, number][] = [
  [800 / 220, 1150 / 220],
  [400 / 220, 2000 / 220],
  [300 / 220, 2600 / 220],
  [450 / 220, 800 / 220],
  [325 / 220, 700 / 220],
];
const bump = (n: number, centre: number, width: number) => Math.exp(-((n - centre) ** 2) / (2 * width * width));

export const TABLES: Wavetable[] = [
  { id: 'basic', label: 'Grundformen', hint: 'Sine → Triangle → Saw → Square', shape: (p, t) => morph([sine, tri, saw, square], p, t) },
  { id: 'pwm', label: 'Puls (PWM)', hint: 'Rechteck, das immer schmaler wird: nasal bis dünn', shape: (p, t) => (frac(t) < 0.5 - 0.46 * clamp01(p) ? 1 : -1) },
  {
    id: 'harm',
    label: 'Obertöne',
    hint: 'Von einem Sinus bis zu 32 Obertönen: der Klang öffnet sich',
    shape: (p, t) => {
      const count = 1 + clamp01(p) * 31;
      return additive((n) => (n <= count ? 1 / n : n - 1 < count ? (count - (n - 1)) / n : 0), t, 33);
    },
  },
  {
    id: 'vowel',
    label: 'Vokal',
    hint: 'Sprechender Klang: A → E → I → O → U',
    shape: (p, t) => {
      const x = clamp01(p) * (VOWELS.length - 1);
      const i = Math.min(VOWELS.length - 2, Math.floor(x));
      const f = x - i;
      const f1 = VOWELS[i][0] * (1 - f) + VOWELS[i + 1][0] * f;
      const f2 = VOWELS[i][1] * (1 - f) + VOWELS[i + 1][1] * f;
      return additive((n) => (0.15 + bump(n, f1, 0.9) + 0.7 * bump(n, f2, 1.4)) / Math.sqrt(n), t, 48);
    },
  },
  { id: 'sync', label: 'Hard Sync', hint: 'Saw mit Hard Sync 1× → 5×: der klassische Sync-Lead', shape: (p, t) => saw(frac(t) * (1 + 4 * clamp01(p)) - 0.5) },
  {
    id: 'fold',
    label: 'Wavefold',
    hint: 'Sinus, immer stärker gefaltet: von weich zu metallisch',
    shape: (p, t) => Math.sin((Math.PI / 2) * (1 + 7 * clamp01(p)) * sine(t)),
  },
  { id: 'fm', label: 'FM', hint: 'Sinus, frequenzmoduliert (Ratio 2): glockig bis growlig', shape: (p, t) => Math.sin(TAU * t + 6 * clamp01(p) * sine(2 * t)) },
  {
    id: 'screech',
    label: 'Screech',
    hint: 'Gefalteter Sync-Saw: schneidender Hard-Techno-Lead',
    shape: (p, t) => {
      const q = clamp01(p);
      return Math.sin((Math.PI / 2) * (1.2 + 4 * q) * saw(frac(t) * (1 + 3 * q) - 0.5));
    },
  },
  {
    id: 'acid',
    label: 'Acid Reso',
    hint: 'Saw mit wanderndem Resonanz-Peak: 303-artig',
    shape: (p, t) => additive((n) => 1 / n + 0.6 * bump(n, 2 + 28 * clamp01(p), 1.2), t, 48),
  },
];

export const tableById = (id: string | undefined): Wavetable | undefined => TABLES.find((x) => x.id === id);

/** One frame drawn as `n` samples, scaled to a peak of 1 (for the display). */
export function tableFrame(id: string, pos: number, n = 128): number[] {
  const table = tableById(id) ?? TABLES[0];
  const out = Array.from({ length: n }, (_, i) => table.shape(pos, i / n));
  const mean = out.reduce((a, b) => a + b, 0) / n;
  const peak = Math.max(1e-9, ...out.map((v) => Math.abs(v - mean)));
  return out.map((v) => (v - mean) / peak);
}

const SAMPLES = 1024;
/** Harmonics per frame: enough for bright leads; the PeriodicWave band-limits them for high notes. */
export const HARMONICS = 128;

/**
 * The frame at `pos` as Fourier coefficients for `createPeriodicWave(real, imag)` (index 0 = DC, always 0),
 * normalised so the strongest harmonic is 1. Positions are snapped to 1/64 so voices can share the waves.
 */
export function tableSpectrum(id: string, pos: number): { real: Float32Array; imag: Float32Array } {
  const table = tableById(id) ?? TABLES[0];
  const p = Math.round(clamp01(pos) * 64) / 64;
  const x = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) x[i] = table.shape(p, i / SAMPLES);
  const real = new Float32Array(HARMONICS + 1);
  const imag = new Float32Array(HARMONICS + 1);
  let peak = 0;
  for (let k = 1; k <= HARMONICS; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const w = (TAU * k * i) / SAMPLES;
      re += x[i] * Math.cos(w);
      im += x[i] * Math.sin(w);
    }
    real[k] = (2 * re) / SAMPLES;
    imag[k] = (2 * im) / SAMPLES;
    peak = Math.max(peak, Math.hypot(real[k], imag[k]));
  }
  if (peak > 0) for (let k = 1; k <= HARMONICS; k++) {
    real[k] /= peak;
    imag[k] /= peak;
  }
  return { real, imag };
}

/** Snap a position to the grid `tableSpectrum` uses (cache key). */
export const snapPos = (pos: number) => Math.round(clamp01(pos) * 64) / 64;
