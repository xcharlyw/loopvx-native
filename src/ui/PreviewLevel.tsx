import { StyleSheet, View } from 'react-native';
import { C, font, mono } from '../constants/theme';
import { trackForSample } from '../lib/project';
import { getState, setPreviewDb, useStore } from '../lib/store';
import type { Sample, SampleCategory } from '../types';
import { Btn, Txt } from './kit';
import { Knob } from './synth/Knob';

const dbText = (v: number) => (v === 0 ? '0 dB' : `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} dB`);

/**
 * The audition level (Library and Drive browser): a knob from -24 to +6 dB and "Wie Spur", which takes the fader level of
 * the track the sample would land on, so it can be heard at the level it would play at in the mix.
 */
export function PreviewLevel({ category, children }: { category?: SampleCategory; children?: React.ReactNode }) {
  const level = useStore((st) => st.previewDb);
  const target = useStore((st) => {
    const t = trackForSample(st.project, { id: '', name: '', category: category ?? 'other', addedAt: 0 } as Sample, st.selectedTrackId);
    return t ? `${t.id}|${t.name}` : '';
  });
  const [targetId, targetName] = target.split('|');
  const matchTrack = () => {
    const t = getState().project.tracks.find((x) => x.id === targetId);
    if (!t) return;
    setPreviewDb(t.volume > 0 ? 20 * Math.log10(t.volume) : -24);
  };
  return (
    <View style={s.bar}>
      <Knob label="Vorhören" value={level} min={-24} max={6} step={0.5} reset={0} size={40} width={64} format={dbText} onChange={setPreviewDb} />
      <View style={s.side}>
        {children}
        {!!targetId && (
          <Btn small accessibilityLabel="Lautstärke wie die Spur" onPress={matchTrack}>
            {`Wie Spur: ${targetName}`}
          </Btn>
        )}
      </View>
    </View>
  );
}

export const previewStyles = StyleSheet.create({
  playing: { ...mono(), fontSize: 11, color: C.accent, lineHeight: 16 },
});

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: C.line },
  side: { flex: 1, minWidth: 0, gap: 6, alignItems: 'flex-start' },
  hint: { ...font(400), fontSize: 11, color: C.muted },
});
