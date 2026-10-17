import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { DEVICE_DEFS } from '../audio/devices';
import { paramDef } from '../lib/automation';
import { sidechainSources } from '../lib/sidechain';
import { djFilter, fxIsDefault, trackFx } from '../audio/fx';
import { presetById } from '../audio/presets';
import { C, font } from '../constants/theme';
import { createMidiClipOnTrack, deleteSelectedTrack, duplicateSelectedTrack, importMidiToTrack } from '../lib/actions';
import { MAX_TRACK_NAME, TRACK_COLORS, groupMembers, groupOf, groupTracks, mapTrack, moveTrack, renameTrack, setTrackGroup, setTrackKind, trackKind, trackSynth, ungroup } from '../lib/project';
import { getState, setState, toast, updateProject, useStore } from '../lib/store';
import type { TrackFx } from '../types';
import { confirmDestructive } from './confirm';
import { Plus, Trash } from './icons';
import { Btn, Chip, Section, Txt } from './kit';
import { hz, Param, pct } from './Param';
import { Sheet } from './Sheet';

/** Rename, recolour or delete the selected track. Saves as you type; leaving the field empty restores the old name. */
export function TrackPanel() {
  const track = useStore((st) => st.project.tracks.find((t) => t.id === st.selectedTrackId));
  const project = useStore((st) => st.project);
  const [draft, setDraft] = useState<string | null>(null);
  if (!track) {
    return (
      <Sheet title="Spur">
        <Txt style={s.note}>Tippe im Arrangement auf eine Spur, um sie umzubenennen.</Txt>
      </Sheet>
    );
  }
  const trackId = track.id;
  const trackIndex = project.tracks.findIndex((t) => t.id === trackId);
  const synth = trackSynth(track);
  const kind = trackKind(track);
  const devices = track.devices ?? [];
  const pickKind = (k: 'audio' | 'midi') => {
    if (k === kind) return;
    if (track.clips.length) {
      toast('Die Spur hat noch Clips. Lösche sie zuerst, dann kannst du den Typ ändern.');
      return;
    }
    updateProject((p) => setTrackKind(p, trackId, k), { reschedule: false });
  };
  const value = draft ?? track.name;
  const preset = presetById(synth.preset);
  const soundName = preset ? preset.name : synth.wave === 'sample' ? 'Sample-Instrument' : synth.wave === 'kick' ? 'Synth-Kick' : synth.wave === 'noise' ? 'Noise / Hat' : synth.preset === undefined && !track.synth ? 'Standard-Saw' : 'Eigener Sound';
  const fx = trackFx(track.fx);
  /** Effect knobs act on the running mix (no rescheduling); a drag is one undo step. */
  const setFx = (patch: TrackFx) =>
    updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, fx: { ...t.fx, ...patch } })), { reschedule: false });
  const change = (text: string) => {
    setDraft(text);
    // The name updates live (it is what the headers and the mixer show); empty only while typing.
    updateProject((p) => renameTrack(p, trackId, text), { reschedule: false });
  };
  const finish = () => {
    if (!value.trim()) updateProject((p) => renameTrack(p, trackId, track.name || 'Spur'), { reschedule: false });
    else if (value !== value.trim()) updateProject((p) => renameTrack(p, trackId, value.trim()), { reschedule: false });
    setDraft(null);
    setState({ panel: 'none' });
  };

  const remove = async () => {
    await deleteSelectedTrack(confirmDestructive);
    if (!getState().project.tracks.some((t) => t.id === trackId)) setState({ panel: 'none' });
  };

  return (
    <Sheet title="Spur bearbeiten">
      <Section title="Name">
        <TextInput
          style={s.input}
          value={value}
          maxLength={MAX_TRACK_NAME}
          selectTextOnFocus
          returnKeyType="done"
          onChangeText={change}
          onBlur={() => {
            if (!value.trim()) updateProject((p) => renameTrack(p, trackId, 'Spur'), { reschedule: false });
          }}
          onSubmitEditing={finish}
          accessibilityLabel="Spurname"
        />
        <Txt style={s.note}>Tipp: Ein langer Druck auf den Spurnamen öffnet diese Ansicht auch direkt.</Txt>
      </Section>

      <Section title="Position und Kopie">
        <View style={s.buttons}>
          <Btn small disabled={trackIndex <= 0} accessibilityLabel="Spur nach oben" onPress={() => updateProject((p) => moveTrack(p, trackId, -1), { reschedule: false })}>
            ▲ Nach oben
          </Btn>
          <Btn small disabled={trackIndex >= project.tracks.length - 1} accessibilityLabel="Spur nach unten" onPress={() => updateProject((p) => moveTrack(p, trackId, 1), { reschedule: false })}>
            ▼ Nach unten
          </Btn>
          <Btn small accessibilityLabel="Spur duplizieren" onPress={duplicateSelectedTrack}>
            ⧉ Duplizieren
          </Btn>
        </View>
        <Txt style={s.note}>{`Spur ${trackIndex + 1} von ${project.tracks.length}. Mit dem Pfeil im Fenster-Kopf (⌄) siehst du die Spuren dabei im Arrangement.`}</Txt>
      </Section>

      <Section title="Farbe">
        <View style={s.swatches}>
          {TRACK_COLORS.map((color) => (
            <Pressable
              key={color}
              accessibilityLabel={`Farbe ${color}`}
              accessibilityState={{ selected: track.color === color }}
              onPress={() => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, color })), { reschedule: false })}
              style={[s.swatch, { backgroundColor: color }, track.color === color && s.swatchOn]}
            />
          ))}
        </View>
      </Section>

      <GroupSection trackId={trackId} />

      {kind !== 'group' && (
      <Section title="Spurtyp">
        <View style={s.buttons}>
          <Chip variant={kind === 'audio' ? 'on' : 'ghost'} onPress={() => pickKind('audio')}>
            Audio
          </Chip>
          <Chip variant={kind === 'midi' ? 'on' : 'ghost'} onPress={() => pickKind('midi')}>
            MIDI
          </Chip>
        </View>
        <Txt style={s.note}>
          {kind === 'midi'
            ? 'MIDI-Spur: Noten in der Piano Roll, gespielt von einem Instrument (Synth, Sampler oder Drum-Synth).'
            : 'Audio-Spur: Loops und Samples aus der Bibliothek. Für Noten und Synth lege eine MIDI-Spur an (der Spurtyp lässt sich nur bei leeren Spuren ändern).'}
        </Txt>
      </Section>
      )}

      <Section title="Geräte">
        <Txt style={s.note}>
          {devices.length
            ? `${devices.map((d) => DEVICE_DEFS[d.type]?.label ?? d.type).join(' → ')}`
            : 'Steckplätze für Effekte: EQ, Compressor, Saturator, Echo, Reverb, Chorus, Filter, Limiter, Utility.'}
        </Txt>
        <View style={s.buttons}>
          <Btn kind={devices.length ? 'default' : 'primary'} accessibilityLabel="Geräte öffnen" onPress={() => setState({ devicesFor: 'track', panel: 'devices' })}>
            {devices.length ? `Geräte (${devices.length})` : 'Geräte öffnen'}
          </Btn>
        </View>
      </Section>

      <Section title="Automation">
        <Txt style={s.note}>
          {track.automation?.length
            ? `Kurven für: ${track.automation.map((l) => paramDef(track, l.param).label).join(', ')}`
            : 'Lass Filter, Drive, Hall, Echo, Lautstärke oder Pan über das Arrangement laufen: Filter-Sweeps, Hall-Würfe vor dem Drop, Ausblenden.'}
        </Txt>
        <View style={s.buttons}>
          <Btn kind={track.automation?.length ? 'default' : 'primary'} accessibilityLabel="Automation öffnen" onPress={() => setState({ panel: 'automation' })}>
            {track.automation?.length ? `Automation (${track.automation.length})` : 'Automation öffnen'}
          </Btn>
        </View>
      </Section>

      <Section title="Effekte">
        <Param
          label="Filter"
          value={fx.filter}
          min={-1}
          max={1}
          text={filterText(fx.filter)}
          onChange={(v) => setFx({ filter: Math.abs(v) < 0.05 ? 0 : Math.round(v * 100) / 100 })}
        />
        <Param label="Drive" value={fx.drive} min={0} max={1} text={pct(fx.drive)} onChange={(v) => setFx({ drive: Math.round(v * 100) / 100 })} />
        <Param label="Reverb" value={fx.reverb} min={0} max={1} text={pct(fx.reverb)} onChange={(v) => setFx({ reverb: Math.round(v * 100) / 100 })} />
        <Param label="Delay" value={fx.delay} min={0} max={1} text={pct(fx.delay)} onChange={(v) => setFx({ delay: Math.round(v * 100) / 100 })} />
        <Param
          label="Pump"
          value={fx.pump}
          min={0}
          max={1}
          text={pct(fx.pump)}
          onChange={(v) => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, fx: { ...t.fx, pump: Math.round(v * 100) / 100 } })), { merge: true })}
        />
        {fx.pump > 0 && (
          <View style={[s.buttons, { marginBottom: 6 }]}>
            <Txt style={s.note}>Pumpt auf:</Txt>
            <Chip variant={!track.fx?.pumpFrom ? 'on' : 'ghost'} textStyle={{ fontSize: 12 }} onPress={() => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, fx: { ...t.fx, pumpFrom: undefined } })))}>
              Jeden Beat
            </Chip>
            {sidechainSources(project, trackId).map((src) => (
              <Chip key={src.id} variant={track.fx?.pumpFrom === src.id ? 'on' : 'ghost'} accessibilityLabel={`Sidechain von ${src.name}`} textStyle={{ fontSize: 12 }} onPress={() => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, fx: { ...t.fx, pumpFrom: src.id } })))}>
                {`Kick von ${src.name}`}
              </Chip>
            ))}
          </View>
        )}
        <Param label="Pan" value={fx.pan} min={-1} max={1} text={panText(fx.pan)} onChange={(v) => setFx({ pan: Math.abs(v) < 0.05 ? 0 : Math.round(v * 100) / 100 })} />
        <Txt style={[s.note, { marginTop: 10 }]}>Filter: links Lowpass, rechts Highpass, Mitte aus. Pump duckt die Spur auf jedem Beat wie ein Sidechain zur Kick (ideal für Rumble, Bass und Pads). Delay läuft im punktierten Achtel zum Projekttempo.</Txt>
        {!fxIsDefault(track.fx) && (
          <View style={[s.buttons, { marginTop: 10 }]}>
            <Btn small onPress={() => updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, fx: undefined })), { reschedule: false })}>
              Effekte aus
            </Btn>
          </View>
        )}
      </Section>

      {kind === 'midi' && (
        <>
      <Section title="MIDI">
        <Txt style={[s.note, { marginTop: 0, marginBottom: 10 }]}>
          MIDI-Clips spielen das Instrument dieser Spur. Noten setzt du in der Piano Roll (Clip zweimal antippen).
        </Txt>
        <View style={s.buttons}>
          <Btn small kind="primary" onPress={() => createMidiClipOnTrack(trackId)}>
            <Plus size={14} color={C.accentInk} />
            MIDI-Clip am Playhead
          </Btn>
          <Btn small onPress={() => void importMidiToTrack(trackId)}>
            .mid importieren
          </Btn>
        </View>
      </Section>

      <Section title="Sound">
        <Txt style={s.soundName}>{soundName}</Txt>
        <Txt style={s.note}>Wähle ein Preset (Reese Bass, Supersaw, Pluck, Pad, Drums …) und forme den Klang mit Oszillatoren, Unison, Filter und LFO.</Txt>
        <View style={[s.buttons, { marginTop: 10 }]}>
          <Btn kind="primary" onPress={() => setState({ panel: 'instrument' })}>
            Sound wählen & bearbeiten
          </Btn>
          <Btn accessibilityLabel="MIDI-Effekte öffnen" onPress={() => setState({ panel: 'notefx' })}>
            Arpeggiator · Sequencer
          </Btn>
        </View>
      </Section>
        </>
      )}

      <Section title="Spur">
        <View style={{ flexDirection: 'row' }}>
          <Btn kind="danger" onPress={() => void remove()}>
            <Trash size={16} color={C.danger} />
            Spur löschen
          </Btn>
        </View>
      </Section>
    </Sheet>
  );
}

const panText = (v: number) => (!v ? 'Mitte' : `${Math.round(Math.abs(v) * 100)} ${v < 0 ? 'L' : 'R'}`);
const filterText = (v: number) => (!v ? 'Aus' : v < 0 ? `LP ${hz(djFilter(v).lowpass)}` : `HP ${hz(djFilter(v).highpass)}`);
/** Which group a track plays through, or (for a group) which tracks it holds. */
function GroupSection({ trackId }: { trackId: string }) {
  const project = useStore((st) => st.project);
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  const set = (fn: (p: typeof project) => typeof project) => updateProject(fn, { reschedule: false });
  if (trackKind(track) === 'group') {
    const members = groupMembers(project, trackId);
    const free = project.tracks.filter((t) => trackKind(t) !== 'group' && t.groupId !== trackId);
    return (
      <Section title="Gruppe">
        <Txt style={s.note}>
          {members.length
            ? `Spuren in dieser Gruppe: ${members.map((m) => m.name).join(', ')}. Sie laufen durch die Geräte, Effekte und den Fader dieser Spur.`
            : 'Noch leer. Füge Spuren hinzu: sie laufen dann durch die Geräte, Effekte und den Fader der Gruppe (zum Beispiel alle Drums in einen Bus).'}
        </Txt>
        <View style={s.buttons}>
          {free.map((t) => (
            <Chip key={t.id} variant="ghost" textStyle={{ fontSize: 12 }} accessibilityLabel={`${t.name} zur Gruppe hinzufügen`} onPress={() => set((p) => setTrackGroup(p, t.id, trackId))}>
              {`+ ${t.name}`}
            </Chip>
          ))}
          {members.map((m) => (
            <Chip key={m.id} variant="on" textStyle={{ fontSize: 12 }} accessibilityLabel={`${m.name} aus der Gruppe nehmen`} onPress={() => set((p) => setTrackGroup(p, m.id, null))}>
              {`${m.name} ✕`}
            </Chip>
          ))}
        </View>
        <View style={[s.buttons, { marginTop: 8 }]}>
          <Btn small accessibilityLabel="Gruppe auflösen" onPress={() => { set((p) => ungroup(p, trackId)); setState({ panel: 'none', selectedTrackId: null }); }}>
            Gruppe auflösen
          </Btn>
        </View>
      </Section>
    );
  }
  const groups = project.tracks.filter((t) => trackKind(t) === 'group');
  const current = groupOf(project, track);
  return (
    <Section title="Gruppe">
      <View style={s.buttons}>
        <Chip variant={!current ? 'on' : 'ghost'} onPress={() => set((p) => setTrackGroup(p, trackId, null))}>
          Keine (Master)
        </Chip>
        {groups.map((g) => (
          <Chip key={g.id} variant={current?.id === g.id ? 'on' : 'ghost'} accessibilityLabel={`In Gruppe ${g.name}`} onPress={() => set((p) => setTrackGroup(p, trackId, g.id))}>
            {g.name}
          </Chip>
        ))}
        <Chip variant="ghost" accessibilityLabel="Neue Gruppe aus dieser Spur" onPress={() => set((p) => groupTracks(p, [trackId]).project)}>
          ＋ Neue Gruppe
        </Chip>
      </View>
      <Txt style={s.note}>Eine Gruppe ist ein Bus mit eigenen Geräten, Effekten und Fader (Cmd/Strg+G).</Txt>
    </Section>
  );
}

const s = StyleSheet.create({
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: '#fff' },
  input: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panel,
    paddingHorizontal: 12,
    marginBottom: 8,
    color: C.text,
    ...font(400),
    fontSize: 14,
    outlineWidth: 0,
  },
  soundName: { ...font(600), fontSize: 14, marginBottom: 4 },
  note: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  sampleList: { maxHeight: 176, marginTop: 8, borderWidth: 1, borderColor: C.line, borderRadius: 10 },
  sampleRow: { paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line },
  sampleRowOn: { backgroundColor: 'rgba(198,255,61,0.08)' },
  sampleName: { fontSize: 13 },
});
