import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { instrumentKind } from '../audio/presets';
import { C, cond } from '../constants/theme';
import { loadSampleIntoSampler } from '../lib/actions';
import { trackSynth } from '../lib/project';
import { useStore } from '../lib/store';
import { DrumPanel } from './DrumPanel';
import { SamplerPanel } from './SamplerPanel';
import { Sheet } from './Sheet';
import { SynthPanel } from './SynthPanel';
import { Txt } from './kit';
import { useSampleDropTarget } from './dnd';

/**
 * The sound of the selected track. Each instrument has its own panel in the same plugin skin: the synth (`SynthPanel`), the sampler
 * (`SamplerPanel`) and the drum instruments (`DrumPanel`); which one a track has is chosen in the track sheet ("Instrument").
 * A sample dropped on the window makes the track a sampler.
 */
export function InstrumentPanel() {
  const track = useStore((st) => st.project.tracks.find((t) => t.id === st.selectedTrackId));
  const [width, setWidth] = useState(330);
  const drop = useSampleDropTarget('instrument', (p) => track && loadSampleIntoSampler(track.id, p.sampleId));
  if (!track) {
    return (
      <Sheet title="Sound">
        <Txt style={s.note}>Wähle im Arrangement eine Spur aus.</Txt>
      </Sheet>
    );
  }
  const kind = instrumentKind(trackSynth(track).wave);
  return (
    <Sheet title={kind === 'synth' ? 'Synth' : kind === 'sample' ? 'Sampler' : 'Drums'}>
      <View ref={drop.ref} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={drop.dragging ? [s.dropZone, drop.over && s.dropOver] : undefined}>
        {drop.dragging && <Txt style={[s.dropHint, drop.over && { color: C.accent }]}>{drop.over ? 'Loslassen: Sample in den Sampler' : 'Hierher ziehen: Sample in den Sampler'}</Txt>}
        {kind === 'synth' ? <SynthPanel width={width} /> : kind === 'sample' ? <SamplerPanel width={width} /> : <DrumPanel width={width} />}
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  dropZone: { borderWidth: 2, borderStyle: 'dashed', borderColor: C.line, borderRadius: 12, padding: 6 },
  dropOver: { borderColor: C.accent, backgroundColor: 'rgba(198,255,61,0.06)' },
  dropHint: { ...cond(700), fontSize: 13, letterSpacing: 1.6, color: C.muted, textAlign: 'center', paddingVertical: 8 },
  note: { color: C.muted, fontSize: 12, lineHeight: 17 },
});
