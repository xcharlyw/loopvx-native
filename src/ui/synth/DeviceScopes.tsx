import { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { C, mono } from '../../constants/theme';
import { cascadeResponse, compGainDb, dbToGain, eqBands, limitedLevel, saturate } from '../../audio/devicemath';
import { freqToX, logFreqs } from '../../audio/scopes';
import { Frame, GRID, line } from './Scopes';

// The pictures of the devices, drawn from the same maths the audio graph uses (audio/devicemath.ts).

const LABEL = { fill: C.dim, fontSize: 8, fontFamily: mono().fontFamily } as const;

/** The EQ's total response with a dot on every band that does something. */
export function EqScope({ params, width, height = 120, color = C.accent }: { params: Record<string, number>; width: number; height?: number; color?: string }) {
  const freqs = logFreqs(140);
  const range = 18;
  const y = (db: number) => height / 2 - (Math.max(-range, Math.min(range, db)) / range) * (height / 2 - 8);
  const db = cascadeResponse(eqBands(params), freqs);
  const pts = db.map((v, i) => [(i / (freqs.length - 1)) * width, y(v)] as [number, number]);
  const dots: { f: number; g: number; id: string }[] = [
    { id: 'ls', f: params.lsF, g: params.lsG },
    { id: 'p1', f: params.p1F, g: params.p1G },
    { id: 'p2', f: params.p2F, g: params.p2G },
    { id: 'hs', f: params.hsF, g: params.hsG },
  ];
  return (
    <Frame width={width} height={height} id="eq">
      {[100, 1000, 10000].map((f) => (
        <Line key={f} x1={freqToX(f) * width} y1={0} x2={freqToX(f) * width} y2={height} stroke={GRID} strokeWidth={1} />
      ))}
      {[-12, -6, 0, 6, 12].map((g) => (
        <Line key={g} x1={0} y1={y(g)} x2={width} y2={y(g)} stroke={g === 0 ? '#26262c' : GRID} strokeWidth={1} />
      ))}
      {[['100', 100], ['1k', 1000], ['10k', 10000]].map(([t, f]) => (
        <SvgText key={t} x={freqToX(f as number) * width + 3} y={height - 4} {...LABEL}>
          {t}
        </SvgText>
      ))}
      <Path d={`${line(pts)} L ${width} ${y(0)} L 0 ${y(0)} Z`} fill={color} fillOpacity={0.12} />
      <Path d={line(pts)} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />
      {dots.filter((d) => Math.abs(d.g) > 0.05).map((d) => (
        <Circle key={d.id} cx={freqToX(d.f) * width} cy={y(d.g)} r={4} fill={C.bg} stroke={color} strokeWidth={1.8} />
      ))}
    </Frame>
  );
}

/** The compressor's transfer curve: level in on the bottom, level out on the side, with the threshold marked. */
export function CompScope({ threshold, ratio, knee, makeup, width, height = 130, color = C.accent }: { threshold: number; ratio: number; knee: number; makeup: number; width: number; height?: number; color?: string }) {
  const lo = -60;
  const px = (db: number) => ((db - lo) / -lo) * (width - 12) + 6;
  const py = (db: number) => height - 6 - ((Math.max(lo, Math.min(6, db)) - lo) / (6 - lo)) * (height - 12);
  const pts: [number, number][] = [];
  for (let d = lo; d <= 0.01; d += 1.5) pts.push([px(d), py(d + compGainDb(d, { threshold, ratio, knee }) + makeup)]);
  return (
    <Frame width={width} height={height} id="comp">
      {[-48, -36, -24, -12, 0].map((d) => (
        <Line key={d} x1={px(d)} y1={0} x2={px(d)} y2={height} stroke={GRID} strokeWidth={1} />
      ))}
      <Line x1={px(lo)} y1={py(lo)} x2={px(0)} y2={py(0)} stroke="#2c2c33" strokeWidth={1} strokeDasharray="3 3" />
      <Line x1={px(threshold)} y1={0} x2={px(threshold)} y2={height} stroke={color} strokeOpacity={0.45} strokeWidth={1} strokeDasharray="4 3" />
      <Path d={line(pts)} stroke={color} strokeWidth={2.2} fill="none" strokeLinejoin="round" />
      <SvgText x={px(threshold) + 4} y={12} {...LABEL}>
        {`${Math.round(threshold)} dB`}
      </SvgText>
    </Frame>
  );
}

/** The saturator's transfer curve: how an input between -1 and 1 comes out once it is driven. */
export function SatScope({ mode, drive, width, height = 120, color = C.accent }: { mode: number; drive: number; width: number; height?: number; color?: string }) {
  const lin = dbToGain(drive);
  const lim = 1.3;
  const px = (x: number) => ((x + 1) / 2) * (width - 12) + 6;
  const py = (v: number) => height / 2 - (Math.max(-lim, Math.min(lim, v)) / lim) * (height / 2 - 6);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 160; i++) {
    const x = (i / 160) * 2 - 1;
    pts.push([px(x), py(saturate(x * lin, mode))]);
  }
  return (
    <Frame width={width} height={height} id="sat">
      <Line x1={px(0)} y1={0} x2={px(0)} y2={height} stroke={GRID} strokeWidth={1} />
      <Line x1={0} y1={py(0)} x2={width} y2={py(0)} stroke={GRID} strokeWidth={1} />
      <Line x1={px(-1)} y1={py(-1)} x2={px(1)} y2={py(1)} stroke="#2c2c33" strokeWidth={1} strokeDasharray="3 3" />
      <Path d={line(pts)} stroke={color} strokeWidth={2.2} fill="none" strokeLinejoin="round" />
    </Frame>
  );
}

/** The echoes as bars in time: each one quieter by the feedback; ping-pong ones hang from the top and bottom. */
export function EchoScope({ seconds, feedback, pingpong, width, height = 86, color = C.accent }: { seconds: number; feedback: number; pingpong: boolean; width: number; height?: number; color?: string }) {
  const span = Math.min(4, Math.max(seconds * 4.5, 1));
  const bars: { x: number; a: number; k: number }[] = [{ x: 0, a: 1, k: 0 }];
  for (let k = 1; k < 24 && seconds * k < span; k++) {
    const a = Math.pow(feedback, k - 1);
    if (a < 0.03) break;
    bars.push({ x: seconds * k, a, k });
  }
  const x = (t: number) => 8 + (t / span) * (width - 16);
  const mid = height / 2;
  return (
    <Frame width={width} height={height} id="echo">
      <Line x1={0} y1={mid} x2={width} y2={mid} stroke={GRID} strokeWidth={1} />
      {bars.map((b) => {
        const h = (b.k === 0 ? 0.9 : Math.max(0.1, b.a)) * (pingpong ? mid - 8 : height - 16);
        const up = pingpong ? b.k % 2 === 0 : true;
        return b.k === 0 ? (
          <Rect key="dry" x={x(0) - 2} y={pingpong ? mid - h : height - 8 - h} width={4} height={pingpong ? h * 2 : h} fill={C.dim} />
        ) : (
          <Rect key={b.k} x={x(b.x) - 2} y={pingpong ? (up ? mid - h : mid) : height - 8 - h} width={4} height={h} fill={color} fillOpacity={0.4 + 0.6 * b.a} />
        );
      })}
      <SvgText x={width - 40} y={12} {...LABEL}>
        {`${Math.round(seconds * 1000)} ms`}
      </SvgText>
    </Frame>
  );
}

/** The room's decay: how fast the tail dies away, on a dB scale like a real decay measurement. */
export function ReverbScope({ size, width, height = 80, color = C.accent }: { size: number; width: number; height?: number; color?: string }) {
  const pts: [number, number][] = [];
  const floor = -60;
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const db = Math.max(floor, 20 * Math.log10(Math.max(1e-6, Math.pow(1 - t, 3.2))));
    pts.push([6 + t * (width - 12), 8 + (-db / -floor) * (height - 16)]);
  }
  return (
    <Frame width={width} height={height} id="reverb">
      {[0.25, 0.5, 0.75].map((f) => (
        <Line key={f} x1={0} y1={8 + f * (height - 16)} x2={width} y2={8 + f * (height - 16)} stroke={GRID} strokeWidth={1} />
      ))}
      <Path d={`${line(pts)} L ${width - 6} ${height - 8} L 6 ${height - 8} Z`} fill={color} fillOpacity={0.12} />
      <Path d={line(pts)} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" />
      <SvgText x={width - 34} y={height - 12} {...LABEL}>
        {`${size.toFixed(1).replace('.', ',')} s`}
      </SvgText>
    </Frame>
  );
}

/** The limiter's transfer curve for input amplitudes 0 to 1 (full scale). */
export function LimiterScope({ gain, ceiling, width, height = 100, color = C.accent }: { gain: number; ceiling: number; width: number; height?: number; color?: string }) {
  const px = (a: number) => 6 + a * (width - 12);
  const py = (v: number) => height - 6 - Math.min(1.05, v) / 1.05 * (height - 12);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 100; i++) pts.push([px(i / 100), py(limitedLevel(i / 100, gain, ceiling))]);
  return (
    <Frame width={width} height={height} id="lim">
      <Line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} stroke="#2c2c33" strokeWidth={1} strokeDasharray="3 3" />
      <Line x1={0} y1={py(dbToGain(ceiling))} x2={width} y2={py(dbToGain(ceiling))} stroke={color} strokeOpacity={0.4} strokeWidth={1} strokeDasharray="4 3" />
      <Path d={line(pts)} stroke={color} strokeWidth={2.2} fill="none" strokeLinejoin="round" />
    </Frame>
  );
}
