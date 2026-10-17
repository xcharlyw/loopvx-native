import { useState } from 'react';
import { View } from 'react-native';
import { presetById } from '../audio/presets';
import { mapTrack } from '../lib/project';
import { updateProject } from '../lib/store';
import { Btn } from './kit';
import { ChangeInstrument, FxRack, Header, KeyboardPanel, PresetBrowser, stepPreset } from './synth/skin';
import { SynthPage } from './synth/SynthPage';
import { useInstrument } from './synth/useInstrument';
import { applyPreset } from '../audio/presets';

/**
 * The synth, in the plugin skin: the top bar with the preset switcher and the level, the oscillators, filter, amp and modulation of
 * `SynthPage`, the track's FX rack and a keyboard. It only ever shows the synth: the sampler and the drum instruments have their own panels.
 */
export function SynthPanel({ width }: { width: number }) {
  const { track, synth, fx, trackId, set, setB, setMods, setMod, setFx, hear } = useInstrument();
  const [browse, setBrowse] = useState(false);
  const [keysLow, setKeysLow] = useState(48);
  if (!track || !synth || !fx) return null;
  const current = presetById(synth.preset);
  const pick = (id: string) => {
    const preset = presetById(id);
    if (!preset) return;
    updateProject((p) => mapTrack(p, trackId, (t) => applyPreset(t, preset)));
    hear(preset.synth, preset.note);
    setKeysLow(Math.max(24, Math.floor((preset.note - 12) / 12) * 12));
  };
  return (
    <View style={{ gap: 10 }}>
      <Header
        track={track}
        synth={synth}
        name={current ? current.name : track.synth ? 'Eigener Sound' : 'Standard-Synth'}
        sub={current?.category ?? 'Synth'}
        onStep={(d) => stepPreset(track, synth, d, hear)}
        onTitle={() => setBrowse((v) => !v)}
        onLevel={(v) => set({ gainDb: v })}
        browsable={browse ? <PresetBrowser track={track} synth={synth} onPick={pick} /> : undefined}
      />
      <SynthPage synth={synth} width={width} set={set} setB={setB} setMods={setMods} setMod={setMod} />
      <FxRack fx={fx} setFx={setFx} />
      <KeyboardPanel low={keysLow} onLow={setKeysLow} onKey={(p) => hear(synth, p)} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Btn kind="primary" onPress={() => hear(synth, current?.note ?? 48)}>
          Anhören
        </Btn>
        <Btn onPress={() => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, synth: undefined })))}>Zurücksetzen</Btn>
        <ChangeInstrument />
      </View>
    </View>
  );
}
