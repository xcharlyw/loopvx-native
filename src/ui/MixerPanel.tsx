import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { C, font } from '../constants/theme';
import { engine } from '../audio/engine';
import { mapTrack } from '../lib/project';
import { setMetronome, setState, updateProject, useStore } from '../lib/store';
import { Fader } from './Fader';
import { Metronome } from './icons';
import { trackFx } from '../audio/fx';
import type { Track } from '../types';
import { Txt } from './kit';
import { FaderScale, Lcd, LedMeter, PluginFrame, SKIN } from './skin';
import { Knob } from './synth/Knob';
import { Sheet } from './Sheet';

function useLevel(): number {
  const [level, setLevel] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    let raf = 0;
    const data = new Float32Array(1024);
    const loop = () => {
      const a = engine.analyser;
      if (a) {
        a.getFloatTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v));
        const next = Math.max(peak, last.current * 0.9);
        if (Math.abs(next - last.current) > 0.002) setLevel(next);
        last.current = next;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return level;
}

/** Peaks of every track, smoothed like the master meter (falls back slowly). */
function useTrackLevels(ids: string[]): Record<string, number> {
  const [levels, setLevels] = useState<Record<string, number>>({});
  const last = useRef<Record<string, number>>({});
  const key = ids.join(',');
  useEffect(() => {
    let raf = 0;
    let frame = 0;
    const loop = () => {
      // Every third frame is plenty for a meter and keeps re-renders down.
      if (++frame % 3 === 0) {
        const next: Record<string, number> = {};
        let changed = false;
        for (const id of key ? key.split(',') : []) {
          const v = Math.max(engine.trackPeak(id), (last.current[id] ?? 0) * 0.85);
          next[id] = v < 0.002 ? 0 : v;
          if (Math.abs(next[id] - (last.current[id] ?? 0)) > 0.004) changed = true;
        }
        last.current = next;
        if (changed) setLevels(next);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [key]);
  return levels;
}

const toDb = (g: number) => (g <= 0.0001 ? '-∞' : `${(20 * Math.log10(g)).toFixed(1)} dB`);

const FADER_H = 150;
const panText = (v: number) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `${Math.round(-v * 50)}L` : `${Math.round(v * 50)}R`);
const pct = (v: number) => `${Math.round(v * 100)}`;

/** One channel strip in the console look: sends, pan, console fader with LED meter, dB read-out, mute/solo, devices. */
function Strip({ track, level, index }: { track: Track; level: number; index: number }) {
  const fx = trackFx(track.fx);
  const set = (patch: Partial<Track['fx']>) => updateProject((p) => mapTrack(p, track.id, (x) => ({ ...x, fx: { ...x.fx, ...patch } })), { reschedule: false });
  const selected = useStore((st) => st.selectedTrackId === track.id);
  return (
    <PluginFrame style={[s.strip, selected && { borderColor: C.accent }]}>
      <View style={[s.colorBar, { backgroundColor: track.color }]} />
      <Pressable onPress={() => setState({ selectedTrackId: track.id })} accessibilityLabel={`Kanal ${track.name}`}>
        <Lcd style={{ marginHorizontal: 6 }} textStyle={{ fontSize: 10 }}>
          {track.name}
        </Lcd>
      </Pressable>
      <View style={s.knobs}>
        <Knob label="Hall" value={fx.reverb} min={0} max={1} size={30} width={42} reset={0} format={pct} color={SKIN.solo} onChange={(v) => set({ reverb: Math.round(v * 100) / 100 })} />
        <Knob label="Delay" value={fx.delay} min={0} max={1} size={30} width={42} reset={0} format={pct} color={SKIN.solo} onChange={(v) => set({ delay: Math.round(v * 100) / 100 })} />
      </View>
      <Knob label="Pan" value={fx.pan} min={-1} max={1} size={32} width={80} reset={0} format={panText} onChange={(v) => set({ pan: Math.abs(v) < 0.04 ? 0 : Math.round(v * 100) / 100 })} />
      <View style={s.faderRow}>
        <FaderScale max={1.5} height={FADER_H} />
        <Fader
          vertical
          cap
          length={FADER_H}
          thickness={4}
          thumbColor={track.color}
          trackColor={SKIN.slot}
          trackBorderColor="#2a2a30"
          value={track.volume}
          max={1.5}
          onChange={(v) => updateProject((p) => mapTrack(p, track.id, (x) => ({ ...x, volume: v })), { reschedule: false })}
        />
        <LedMeter level={level} height={FADER_H} />
      </View>
      <Lcd style={{ marginHorizontal: 6 }}>{toDb(track.volume)}</Lcd>
      <View style={s.msRow}>
        <Pressable accessibilityLabel={`${track.name} stumm`} onPress={() => updateProject((p) => mapTrack(p, track.id, (x) => ({ ...x, muted: !x.muted })), { reschedule: false })} style={[s.hwBtn, track.muted && { backgroundColor: C.mute, borderColor: C.mute }]}>
          <Txt style={[s.hwBtnText, track.muted && { color: C.accentInk }]}>M</Txt>
        </Pressable>
        <Pressable accessibilityLabel={`${track.name} solo`} onPress={() => updateProject((p) => mapTrack(p, track.id, (x) => ({ ...x, solo: !x.solo })), { reschedule: false })} style={[s.hwBtn, track.solo && { backgroundColor: SKIN.solo, borderColor: SKIN.solo }]}>
          <Txt style={[s.hwBtnText, track.solo && { color: C.accentInk }]}>S</Txt>
        </Pressable>
      </View>
      <Pressable accessibilityLabel={`Geräte von ${track.name}`} onPress={() => setState({ selectedTrackId: track.id, devicesFor: 'track', panel: 'devices' })} style={[s.fxBtn, !!track.devices?.length && s.fxBtnOn]}>
        <Txt style={[s.fxBtnText, !!track.devices?.length && { color: C.accentInk }]}>{track.devices?.length ? `FX ${track.devices.length}` : 'FX +'}</Txt>
      </Pressable>
      <Txt style={s.number}>{index + 1}</Txt>
    </PluginFrame>
  );
}

export function MixerPanel() {
  const project = useStore((st) => st.project);
  const metronome = useStore((st) => st.metronome);
  const [master, setMaster] = useState(1);
  const level = useLevel();
  const trackLevels = useTrackLevels(project.tracks.map((t) => t.id));
  const masterFx = project.master?.devices?.length ?? 0;

  return (
    <Sheet title="Mixer">
      <View style={s.console}>
        <ScrollView horizontal contentContainerStyle={s.mixer}>
          {project.tracks.map((t, i) => (
            <Strip key={t.id} track={t} index={i} level={trackLevels[t.id] ?? 0} />
          ))}
          <PluginFrame style={[s.strip, s.masterStrip]}>
            <View style={[s.colorBar, { backgroundColor: C.accent }]} />
            <Lcd style={{ marginHorizontal: 6 }} textStyle={{ fontSize: 10 }}>
              MASTER
            </Lcd>
            <View style={[s.clipLed, level >= 0.99 && { backgroundColor: SKIN.red, shadowColor: SKIN.red, shadowOpacity: 0.9, shadowRadius: 6 }]}>
              <Txt style={s.clipLedText}>CLIP</Txt>
            </View>
            <View style={[s.faderRow, { marginTop: 'auto' }]}>
              <FaderScale max={1.2} height={FADER_H} />
              <Fader
                vertical
                cap
                length={FADER_H}
                thickness={4}
                thumbColor={C.accent}
                trackColor={SKIN.slot}
                trackBorderColor="#2a2a30"
                value={master}
                max={1.2}
                onChange={(v) => {
                  setMaster(v);
                  engine.setMasterVolume(v);
                }}
              />
              <LedMeter level={level} height={FADER_H} width={9} />
            </View>
            <Lcd style={{ marginHorizontal: 6 }}>{toDb(master)}</Lcd>
            <Pressable accessibilityLabel="Master-Geräte" onPress={() => setState({ devicesFor: 'master', panel: 'devices' })} style={[s.fxBtn, !!masterFx && s.fxBtnOn]}>
              <Txt style={[s.fxBtnText, !!masterFx && { color: C.accentInk }]}>{masterFx ? `FX ${masterFx}` : 'FX +'}</Txt>
            </Pressable>
            <Pressable accessibilityLabel="Metronom" onPress={() => setMetronome(!metronome)} style={[s.fxBtn, metronome && s.fxBtnOn]}>
              <Metronome size={13} color={metronome ? C.accentInk : C.text} />
            </Pressable>
          </PluginFrame>
        </ScrollView>
      </View>
      {level >= 0.99 && <Txt style={s.clip}>Clipping auf dem Master: Spuren leiser machen.</Txt>}
      <Txt style={s.note}>Regler: ziehen nach oben/unten, Doppeltipp setzt zurück. Hall und Delay sind die Sends der Spur. Startwerte für Hard Techno: Kick + Bass 0 dB, Top Loop −6 dB, Vocals −6 dB, Synth −9 dB.</Txt>
    </Sheet>
  );
}

const s = StyleSheet.create({
  clip: { color: C.danger, fontSize: 12, marginTop: 8 },
  console: { backgroundColor: '#09090b', borderRadius: 14, borderWidth: 1, borderColor: C.lineSoft, padding: 8 },
  mixer: { gap: 6 },
  strip: { width: 96, paddingTop: 0, paddingBottom: 8, alignItems: 'center', gap: 4 },
  masterStrip: { width: 104, borderColor: '#4a5a1c' },
  colorBar: { alignSelf: 'stretch', height: 4, marginBottom: 4 },
  knobs: { flexDirection: 'row', justifyContent: 'center' },
  faderRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  msRow: { flexDirection: 'row', gap: 6 },
  hwBtn: { width: 34, height: 24, borderRadius: 5, borderWidth: 1, borderColor: '#3a3a42', backgroundColor: '#1c1c21', alignItems: 'center', justifyContent: 'center' },
  hwBtnText: { ...font(700), fontSize: 11, color: C.text },
  fxBtn: { alignSelf: 'stretch', marginHorizontal: 8, height: 24, borderRadius: 5, borderWidth: 1, borderColor: '#3a3a42', backgroundColor: '#1c1c21', alignItems: 'center', justifyContent: 'center' },
  fxBtnOn: { backgroundColor: C.accent, borderColor: C.accent },
  fxBtnText: { ...font(700), fontSize: 10, color: C.text, letterSpacing: 0.5 },
  number: { ...font(600), fontSize: 9, color: C.dim },
  clipLed: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 3, backgroundColor: '#3a1414' },
  clipLedText: { ...font(700), fontSize: 8, color: '#ffffffcc', letterSpacing: 1 },
  note: { color: C.muted, fontSize: 12, marginTop: 12, lineHeight: 17 },
});
