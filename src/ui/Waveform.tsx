import { useEffect, useMemo, useState } from 'react';
import Svg, { Path } from 'react-native-svg';
import type { AudioBuffer } from 'react-native-audio-api';
import { engine } from '../audio/engine';
import { sampleLengthBars } from '../audio/timing';

const peakCache = new Map<string, Float32Array>();

/** Downsampled absolute peaks of a buffer, cached per sample. */
function getPeaks(sampleId: string, buffer: AudioBuffer, points = 512): Float32Array {
  const hit = peakCache.get(sampleId);
  if (hit) return hit;
  const data = buffer.getChannelData(0);
  const block = Math.max(1, Math.floor(data.length / points));
  const peaks = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    let max = 0;
    const start = i * block;
    for (let j = 0; j < block; j += 4) {
      const v = Math.abs(data[start + j] ?? 0);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  peakCache.set(sampleId, peaks);
  return peaks;
}

interface Props {
  sampleId: string;
  width: number;
  height: number;
  zoom: number;
  projectBpm: number;
  sampleBpm?: number;
  /** Offset into the loop in pixels. */
  offsetPx: number;
}

const STEP = 2;

export function Waveform({ sampleId, width, height, zoom, projectBpm, sampleBpm, offsetPx }: Props) {
  const [buffer, setBuffer] = useState(() => engine.getBuffer(sampleId));

  useEffect(() => {
    if (buffer) return;
    let alive = true;
    engine
      .loadBuffer(sampleId)
      .then((b) => alive && setBuffer(b))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sampleId, buffer]);

  // Derived from this component's own buffer: the parent may render before the audio is decoded.
  const loopPx = buffer ? sampleLengthBars(buffer.duration, projectBpm, sampleBpm) * zoom : 0;

  const d = useMemo(() => {
    if (!buffer || loopPx <= 0 || width <= 0 || height <= 0) return '';
    const peaks = getPeaks(sampleId, buffer);
    const mid = height / 2;
    let path = '';
    for (let x = 0; x < width; x += STEP) {
      const t = ((((x + offsetPx) % loopPx) + loopPx) % loopPx) / loopPx;
      const p = peaks[Math.min(peaks.length - 1, Math.floor(t * peaks.length))];
      const h = Math.max(1, p * mid * 0.95);
      path += `M${x} ${(mid - h).toFixed(1)}h${STEP}v${(h * 2).toFixed(1)}h-${STEP}z`;
    }
    return path;
  }, [buffer, sampleId, width, height, loopPx, offsetPx]);

  if (!d) return null;
  return (
    <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 16 }} pointerEvents="none">
      <Path d={d} fill="rgba(0,0,0,0.55)" />
    </Svg>
  );
}
