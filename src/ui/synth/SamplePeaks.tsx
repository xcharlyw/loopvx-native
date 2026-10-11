import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { engine } from '../../audio/engine';
import { C } from '../../constants/theme';
import { getPeaks } from '../Waveform';
import { Txt } from '../kit';

/** The waveform of the sampler's sample, mirrored around the middle like a sampler display. */
export function SamplePeaks({ sampleId, width, height = 84, color = C.accent }: { sampleId?: string; width: number; height?: number; color?: string }) {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => {
    setPeaks(null);
    if (!sampleId) return;
    let alive = true;
    engine
      .loadBuffer(sampleId)
      .then((b) => alive && setPeaks(getPeaks(sampleId, b, 160)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sampleId]);
  const mid = height / 2;
  let d = '';
  if (peaks) {
    const n = peaks.length;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * width;
      const h = Math.max(1, Math.min(1, peaks[i]) * (mid - 6));
      d += `M ${x.toFixed(1)} ${(mid - h).toFixed(1)} L ${x.toFixed(1)} ${(mid + h).toFixed(1)} `;
    }
  }
  return (
    <View style={{ width, height, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: '#09090b', justifyContent: 'center' }}>
      <Svg width={width} height={height}>
        <Line x1={0} y1={mid} x2={width} y2={mid} stroke="#17171b" strokeWidth={1} />
        {d !== '' && <Path d={d} stroke={color} strokeWidth={1.6} strokeOpacity={0.9} />}
      </Svg>
      {!peaks && (
        <Txt style={{ position: 'absolute', alignSelf: 'center', color: C.dim, fontSize: 12 }}>{sampleId ? 'Lädt …' : 'Kein Sample gewählt'}</Txt>
      )}
    </View>
  );
}
