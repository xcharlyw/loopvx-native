import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { engine } from '../../audio/engine';
import { DEVICE_DEFS } from '../../audio/devices';
import { DEVICE_PRESETS } from '../../audio/devicepresets';
import { arpPresetById, seqPresetById } from '../../audio/notefxPresets';
import { C, font, mono } from '../../constants/theme';
import { fxTarget, midiTarget } from '../../lib/browser';
import { prettyPath, normPath } from '../../lib/folders';
import { trackForSample } from '../../lib/project';
import { getState, setPreviewDb, useStore } from '../../lib/store';
import type { DeviceType, Sample } from '../../types';
import { useEngine } from '../hooks';
import { Play, Stop } from '../icons';
import { Txt } from '../kit';
import { Knob } from '../synth/Knob';
import { SamplePeaks } from '../synth/SamplePeaks';
import { hearSound, soundOf } from './ItemLists';
import { baseName } from './SampleList';

// Live's preview area at the bottom of the browser: the selected item's waveform (samples) or description, the preview switch
// (a tap auditions), the audition level, and where "load" would put it.

const dbText = (v: number) => (v === 0 ? '0 dB' : `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} dB`);

interface Props {
  sel: string | null;
  autoPreview: boolean;
  setAutoPreview: (on: boolean) => void;
  previewId: string | null;
  /** The tempo the last audition used, `~` when it was measured just now. */
  heardBpm?: { id: string; bpm?: number; detected: boolean } | null;
  audition: (x: Sample, restart?: boolean) => void;
  activate: (id: string) => void;
}

export function PreviewStrip({ sel, autoPreview, setAutoPreview, previewId, heardBpm, audition, activate }: Props) {
  const [w, setW] = useState(240);
  const samples = useStore((st) => st.samples);
  const bpm = useStore((st) => st.project.bpm);
  const level = useStore((st) => st.previewDb);
  const target = useStore((st) => targetName(sel, st.samples, st.project, st.selectedTrackId));
  const previewing = useEngine(() => engine.isPreviewing());
  const playing = useEngine(() => engine.playing);
  const sample = sel?.startsWith('s:') ? samples.find((x) => x.id === sel.slice(2)) : undefined;
  const sound = soundOf(sel);
  const info = describe(sel);
  const isPlaying = !!sample && previewing && previewId === sample.id;

  const matchTrack = () => {
    if (!sample) return;
    const st = getState();
    const t = trackForSample(st.project, sample, st.selectedTrackId);
    if (t) setPreviewDb(t.volume > 0 ? 20 * Math.log10(t.volume) : -24);
  };

  return (
    <View style={s.strip} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {sample && (
        <Pressable accessibilityLabel={isPlaying ? 'Vorhören stoppen' : 'Vorhören'} onPress={() => audition(sample)} style={s.wave}>
          <SamplePeaks sampleId={sample.id} width={Math.max(120, w - 24)} height={40} color={isPlaying ? C.accent : '#7d8a5a'} />
        </Pressable>
      )}
      <View style={s.row}>
        <Pressable accessibilityLabel={autoPreview ? 'Vorhören beim Antippen aus' : 'Vorhören beim Antippen an'} accessibilityState={{ checked: autoPreview }} onPress={() => setAutoPreview(!autoPreview)} style={[s.phones, autoPreview && s.phonesOn]}>
          <Txt style={[s.phonesText, autoPreview && { color: C.accentInk }]}>🎧</Txt>
        </Pressable>
        <Knob label="" value={level} min={-24} max={6} step={0.5} reset={0} size={26} width={34} format={dbText} onChange={setPreviewDb} />
        <View style={s.text}>
          {sample ? (
            <>
              <Txt numberOfLines={1} style={s.name}>
                {baseName(sample.name)}
              </Txt>
              <Txt numberOfLines={1} style={s.meta}>
                {[
                  sample.bpm ? `${heardBpm?.id === sample.id && heardBpm.detected ? '~' : ''}${sample.bpm} → ${bpm} BPM` : 'ohne Tempo',
                  sample.key,
                  sample.duration ? `${sample.duration.toFixed(1).replace('.', ',')} s` : undefined,
                  sample.folder ? prettyPath(normPath(sample.folder)) : undefined,
                  isPlaying && playing ? 'im Takt' : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Txt>
            </>
          ) : info ? (
            <>
              <Txt numberOfLines={1} style={s.name}>
                {info.title}
              </Txt>
              <Txt numberOfLines={1} style={s.meta}>
                {info.sub}
              </Txt>
            </>
          ) : (
            <Txt numberOfLines={2} style={s.meta}>
              Tippen: auswählen und vorhören · Doppeltippen oder ＋: laden · Ziehen: auf eine Spur oder ins Gerät
            </Txt>
          )}
        </View>
        {sample && (
          <Pressable accessibilityLabel={isPlaying ? 'Stopp' : 'Abspielen'} onPress={() => audition(sample)} style={s.play}>
            {isPlaying ? <Stop size={12} /> : <Play size={12} />}
          </Pressable>
        )}
        {sound && (
          <Pressable accessibilityLabel="Sound anhören" onPress={() => hearSound(sound)} style={s.play}>
            <Play size={12} />
          </Pressable>
        )}
      </View>
      {sel && !sel.startsWith('f:') && (
        <View style={s.row}>
          <Pressable accessibilityLabel={`Laden: ${target}`} onPress={() => activate(sel)} style={s.load}>
            <Txt numberOfLines={1} style={s.loadText}>{`＋ ${target}`}</Txt>
          </Pressable>
          {sample && (
            <Pressable accessibilityLabel="Lautstärke wie die Spur" onPress={matchTrack} style={s.small}>
              <Txt style={s.smallText}>Pegel wie Spur</Txt>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/** Title and line of a sound, an effect or a MIDI effect row. */
function describe(sel: string | null): { title: string; sub: string } | null {
  if (!sel) return null;
  const sound = soundOf(sel);
  if (sound) return { title: sound.name, sub: `${sound.category} · ${sound.hint}` };
  if (sel.startsWith('d:')) {
    const [, type, ...rest] = sel.split(':');
    const def = DEVICE_DEFS[type as DeviceType];
    if (!def) return null;
    const pid = rest.join(':');
    const own = getState().devicePresets.find((p) => p.id === pid);
    const preset = own ?? DEVICE_PRESETS[def.type].find((p) => p.id === pid);
    return { title: preset ? `${def.label} · ${preset.name}` : def.label, sub: own ? 'Eigenes Preset' : def.blurb };
  }
  if (sel.startsWith('a:') || sel.startsWith('q:')) {
    const p = sel[0] === 'a' ? arpPresetById(sel.slice(2)) : seqPresetById(sel.slice(2));
    return p ? { title: `${sel[0] === 'a' ? 'Arpeggiator' : 'Sequencer'} · ${p.name}`, sub: p.hint } : null;
  }
  return null;
}

/** Where loading the selected item puts it, in words. */
function targetName(sel: string | null, samples: Sample[], project: Parameters<typeof midiTarget>[0], selectedTrackId: string | null): string {
  if (!sel) return '';
  const name = (id: string | null) => project.tracks.find((t) => t.id === id)?.name;
  if (sel.startsWith('s:')) {
    const x = samples.find((y) => y.id === sel.slice(2));
    const t = x ? trackForSample(project, x, selectedTrackId) : undefined;
    return t ? `Auf Spur ${t.name}` : 'Auf eine neue Spur';
  }
  if (sel.startsWith('d:')) {
    const t = name(fxTarget(project, selectedTrackId));
    return t ? `In die Kette von ${t}` : 'Erst eine Spur wählen';
  }
  const midi = name(midiTarget(project, selectedTrackId));
  return midi ? `Auf ${midi}` : 'Auf eine neue MIDI-Spur';
}

const s = StyleSheet.create({
  strip: { borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.bg, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 8, gap: 6 },
  wave: { height: 40, borderRadius: 4, backgroundColor: '#0a0a0c', borderWidth: 1, borderColor: C.lineSoft, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  phones: { width: 28, height: 26, borderRadius: 5, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  phonesOn: { backgroundColor: C.accent, borderColor: C.accent },
  phonesText: { fontSize: 13 },
  text: { flex: 1, minWidth: 0 },
  name: { ...font(600), fontSize: 12 },
  meta: { ...mono(), fontSize: 10, color: C.muted, lineHeight: 14 },
  play: { width: 28, height: 26, borderRadius: 5, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  load: { flex: 1, height: 28, borderRadius: 6, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  loadText: { ...font(700), fontSize: 11.5, color: C.accentInk },
  small: { height: 28, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  smallText: { ...font(600), fontSize: 10.5, color: C.text },
});
