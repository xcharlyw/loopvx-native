// Level matching for generated vocals: ElevenLabs answers come out at very different levels (speech settings, the music
// model, a quiet take), so a new vocal sat far below the older ones. The clip gain brings the speech to one level.

/** Level the active speech is brought to (RMS, dBFS) and the ceiling the loudest peak may reach (dBFS). */
export const TARGET_RMS_DB = -18;
export const PEAK_CEILING_DB = -1;
/** Clip gain range of the Clip panel is -24..+6 dB; a match never goes beyond this. */
const MIN_GAIN_DB = -12;
const MAX_GAIN_DB = 6;
/** Samples below this are pauses and do not count for the speech level. */
const GATE = 0.01;

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

/** RMS of the active part (above the gate) and the peak, both in dBFS; null for silence. */
export function levelOf(channels: Float32Array[]): { rmsDb: number; peakDb: number } | null {
  let sum = 0;
  let count = 0;
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
      if (a >= GATE) {
        sum += a * a;
        count++;
      }
    }
  }
  if (count === 0 || peak < GATE) return null;
  return { rmsDb: db(Math.sqrt(sum / count)), peakDb: db(peak) };
}

/**
 * The clip gain (dB, steps of 0.5) that brings a vocal to the target level without its peak passing the ceiling.
 * 0 when it is already within half a dB or silent.
 */
export function vocalGainDb(channels: Float32Array[]): number {
  const level = levelOf(channels);
  if (!level) return 0;
  const wanted = TARGET_RMS_DB - level.rmsDb;
  const room = PEAK_CEILING_DB - level.peakDb;
  const gain = Math.min(wanted, room, MAX_GAIN_DB);
  const stepped = Math.round(Math.max(MIN_GAIN_DB, gain) * 2) / 2;
  return Math.abs(stepped) < 0.5 ? 0 : stepped;
}
