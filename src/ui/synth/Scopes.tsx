import { Fragment } from 'react';
import { View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { C, mono } from '../../constants/theme';
import { envelopeCurve, filterEnvelopeCurve, filterResponse, freqToX, lfoShape, lfoWindow, logFreqs, waveShape, type FilterKind } from '../../audio/scopes';
import { tableFrame } from '../../audio/wavetables';
import type { OscWave } from '../../types';

// The pictures of the synth: what an oscillator, the filter, the envelope and the LFO do, drawn live from the
// current settings (the maths lives in audio/scopes.ts and is tested against the real filter).

export const GRID = '#17171b';
const BG = '#0c0c0f';

/** Frame and background shared by all scopes. */
export function Frame({ width, height, children, id }: { width: number; height: number; children: React.ReactNode; id: string }) {
  return (
    <View style={{ width, height, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#1f1f26', backgroundColor: BG }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#c6ff3d" stopOpacity="0.16" />
            <Stop offset="1" stopColor="#c6ff3d" stopOpacity="0.02" />
          </LinearGradient>
        </Defs>
        {children}
      </Svg>
    </View>
  );
}

export const line = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');

/** One oscillator: its wave, with faint copies for the unison voices (spread of phase, not of pitch: just a picture). */
export function WaveScope({ wave, unison = 1, spread = 0, width, height = 64, color = C.accent }: { wave: OscWave; unison?: number; spread?: number; width: number; height?: number; color?: string }) {
  const n = 96;
  const pad = 8;
  // two cycles side by side, like a wavetable view
  const draw = (phase: number) => {
    const one = waveShape(wave, n, phase);
    return line([...one, ...one, one[0]].map((v, i, all) => [(i / (all.length - 1)) * width, height / 2 - v * (height / 2 - pad)] as [number, number]));
  };
  const copies = Math.min(6, Math.max(0, unison - 1));
  return (
    <Frame width={width} height={height} id="wave">
      <Line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={GRID} strokeWidth={1} />
      {Array.from({ length: copies }, (_, i) => {
        const off = ((i % 2 ? 1 : -1) * (Math.floor(i / 2) + 1) * Math.min(100, spread)) / 700;
        return <Path key={i} d={draw(off)} stroke={color} strokeOpacity={0.22} strokeWidth={1.4} fill="none" />;
      })}
      <Path d={draw(0)} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />
    </Frame>
  );
}

/** The filter's response curve, the way it really sounds, with the cutoff marked and the envelope's start as a dashed ghost. */
export function FilterScope({ type, cutoff, resonance, envOctaves = 0, width, height = 112, color = C.accent }: { type: FilterKind; cutoff: number; resonance: number; envOctaves?: number; width: number; height?: number; color?: string }) {
  const freqs = logFreqs(120);
  const dbRange = 24;
  const y = (db: number) => height / 2 - (Math.max(-dbRange, Math.min(dbRange, db)) / dbRange) * (height / 2 - 6);
  const curve = (c: number) => filterResponse(type, c, resonance, freqs).map((db, i) => [(i / (freqs.length - 1)) * width, y(db)] as [number, number]);
  const main = curve(cutoff);
  const area = `${line(main)} L ${width} ${height} L 0 ${height} Z`;
  const ghostCut = Math.min(20000, cutoff * Math.pow(2, envOctaves));
  const cx = freqToX(cutoff) * width;
  return (
    <Frame width={width} height={height} id="filter">
      {[100, 1000, 10000].map((f) => (
        <Line key={f} x1={freqToX(f) * width} y1={0} x2={freqToX(f) * width} y2={height} stroke={GRID} strokeWidth={1} />
      ))}
      <Line x1={0} y1={y(0)} x2={width} y2={y(0)} stroke={GRID} strokeWidth={1} />
      {[['100', 100], ['1k', 1000], ['10k', 10000]].map(([t, f]) => (
        <SvgText key={t} x={freqToX(f as number) * width + 3} y={height - 4} fill={C.dim} fontSize={8} fontFamily={mono().fontFamily}>
          {t}
        </SvgText>
      ))}
      {envOctaves > 0.05 && <Path d={line(curve(ghostCut))} stroke={color} strokeOpacity={0.35} strokeWidth={1.4} strokeDasharray="4 3" fill="none" />}
      <Path d={area} fill="url(#g-filter)" />
      <Path d={line(main)} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />
      <Line x1={cx} y1={0} x2={cx} y2={height} stroke={color} strokeOpacity={0.5} strokeWidth={1} />
    </Frame>
  );
}

/** The amplitude envelope: attack, decay, the sustain plateau until the key is released, and the release. */
export function EnvScope({ attack, decay, sustain, release, width, height = 96, color = C.accent }: { attack: number; decay: number; sustain: number; release: number; width: number; height?: number; color?: string }) {
  const hold = Math.max(0.4, attack + decay + 0.35);
  const { points, total, holdAt } = envelopeCurve({ attack, decay, sustain, release }, hold);
  const pad = 8;
  const x = (t: number) => (t / total) * (width - 2 * pad) + pad;
  const y = (v: number) => height - pad - v * (height - 2 * pad);
  const path = line(points.map((p) => [x(p.t), y(p.v)] as [number, number]));
  return (
    <Frame width={width} height={height} id="env">
      <Line x1={x(holdAt)} y1={4} x2={x(holdAt)} y2={height - 4} stroke={C.dim} strokeDasharray="3 3" strokeWidth={1} />
      <Path d={`${path} L ${x(total)} ${y(0)} L ${x(0)} ${y(0)} Z`} fill="url(#g-env)" />
      <Path d={path} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />
      <SvgText x={x(holdAt) + 4} y={12} fill={C.dim} fontSize={8} fontFamily={mono().fontFamily}>
        Taste los
      </SvgText>
    </Frame>
  );
}

/** The filter envelope: the cutoff falling from its raised start back to the resting value. */
export function FilterEnvMini({ cutoff, octaves, decay, width, height = 44, color = C.accent }: { cutoff: number; octaves: number; decay: number; width: number; height?: number; color?: string }) {
  const pts = filterEnvelopeCurve(cutoff, octaves, decay, 40);
  const pad = 6;
  const path = line(pts.map((p, i) => [(i / (pts.length - 1)) * (width - 2 * pad) + pad, height - pad - p.x * (height - 2 * pad)] as [number, number]));
  return (
    <Frame width={width} height={height} id="fenv">
      <Path d={path} stroke={color} strokeWidth={2} fill="none" />
    </Frame>
  );
}

/** The LFO: two cycles of its sine, as tall as its depth. */
export function LfoScope({ rate, depth, width, height = 64, color = C.accent }: { rate: number; depth: number; width: number; height?: number; color?: string }) {
  const { bars, cycles } = lfoWindow(rate);
  const n = 320;
  const shape = lfoShape(n, cycles);
  const amp = (height / 2 - 8) * Math.max(0.05, depth);
  const path = line(shape.map((v, i) => [(i / (n - 1)) * width, height / 2 - v * amp] as [number, number]));
  return (
    <Frame width={width} height={height} id="lfo">
      <Line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={GRID} strokeWidth={1} />
      {Array.from({ length: bars - 1 }, (_, i) => (
        <Line key={i} x1={((i + 1) / bars) * width} y1={0} x2={((i + 1) / bars) * width} y2={height} stroke={GRID} strokeWidth={1} strokeDasharray="3 3" />
      ))}
      {rate > 0 && <Path d={path} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />}
      <SvgText x={6} y={height - 5} fill={C.dim} fontSize={8} fontFamily={mono().fontFamily}>
        {bars === 1 ? '1 Takt' : `${bars} Takte`}
      </SvgText>
    </Frame>
  );
}

/** A tiny wave glyph for the wave selector buttons. */
export function WaveGlyph({ wave, color, size = 28 }: { wave: OscWave; color: string; size?: number }) {
  const n = 40;
  const d = line(waveShape(wave, n).map((v, i) => [(i / (n - 1)) * (size - 6) + 3, size / 2 - v * (size / 2 - 7)] as [number, number]));
  return (
    <Svg width={size} height={size}>
      <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * A wavetable as a stack of frames, drawn back to front with hidden lines (every frame fills the area below its line, so
 * the ones behind show only above it, like the ridge view of a wavetable synth). The position axis goes up the picture;
 * the frame at `pos` is the bold one in the accent colour.
 */
export function TableScope({ table, pos, width, height = 110, color = C.accent }: { table: string; pos: number; width: number; height?: number; color?: string }) {
  const n = 96;
  const steps = 20;
  const pad = 6;
  const rise = height - 44;
  const base = (p: number) => height - pad - 14 - p * rise;
  const draw = (p: number, amp: number) => line(tableFrame(table, p, n).map((v, i) => [(i / (n - 1)) * width, base(p) - v * amp] as [number, number]));
  const closed = (d: string) => `${d} L ${width} ${height} L 0 ${height} Z`;
  const ps = Array.from({ length: steps }, (_, i) => i / (steps - 1));
  const behind = ps.filter((p) => p > pos).reverse();
  const front = ps.filter((p) => p <= pos).reverse();
  const stack = (p: number) => {
    const d = draw(p, 12);
    return (
      <Fragment key={p}>
        <Path d={closed(d)} fill={BG} />
        <Path d={d} stroke="#a9a9b6" strokeOpacity={0.22 + 0.5 * (1 - p)} strokeWidth={1} fill="none" />
      </Fragment>
    );
  };
  const active = draw(pos, 16);
  return (
    <Frame width={width} height={height} id="table">
      {behind.map(stack)}
      <Path d={closed(active)} fill={BG} />
      <Path d={active} stroke={color} strokeWidth={2.2} fill="none" strokeLinejoin="round" />
      {front.filter((p) => p < pos).map(stack)}
      <Line x1={0} y1={base(pos)} x2={6} y2={base(pos)} stroke={color} strokeWidth={2} />
    </Frame>
  );
}
