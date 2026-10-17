import { useState, type MutableRefObject } from 'react';
import { View } from 'react-native';
import { engine } from '../../audio/engine';
import { DEVICE_DEFS } from '../../audio/devices';
import { presetById, type SoundPreset } from '../../audio/presets';
import { C } from '../../constants/theme';
import { fxGroups, midiFxGroups, soundGroups } from '../../lib/browser';
import { addDeviceFrom, applyMidiFx, deleteDevicePreset, loadSound } from '../../lib/browserActions';
import { useStore } from '../../lib/store';
import type { DeviceType } from '../../types';
import { BrowserRow, GroupTitle, RowAction, browserStyles } from './Row';
import { useNav, type NavList } from './nav';
import { Txt } from '../kit';

// The lists of the browser's categories other than samples: instrument sounds (Sounds, Drums), audio effects with their presets,
// MIDI effects. Row ids: `p:<preset>` sounds, `d:<type>` a device, `d:<type>:<preset>` one of its presets, `a:` / `q:` arp / seq presets.

interface ListProps {
  words: string[];
  sel: string | null;
  setSel: (id: string | null) => void;
  nav: MutableRefObject<NavList | null>;
  /** Tap = audition (sounds) when the browser's preview is on. */
  autoPreview: boolean;
}

const CATEGORY_COLOR: Record<string, string> = { 'Hard Techno': '#ff3d6e', Bass: '#ff5a36', Lead: '#3dd6ff', Pad: '#b48cff', 'Pluck & Stab': '#ffc53d', Drums: '#ff8a3d' };

export const hearSound = (p: SoundPreset) => void engine.previewNote(p.synth, p.note);

export function SoundList({ words, sel, setSel, nav, autoPreview, drums }: ListProps & { drums: boolean }) {
  const groups = soundGroups(words, drums);
  const ids = groups.flatMap((g) => g.items.map((p) => `p:${p.id}`));
  const activate = (id: string) => loadSound(id.slice(2));
  const pick = (id: string) => {
    setSel(id);
    const p = soundOf(id);
    if (autoPreview && p) hearSound(p);
  };
  useNav(nav, { ids, activate, pick });
  if (!groups.length) return <Txt style={browserStyles.empty}>Kein Sound gefunden.</Txt>;
  return (
    <View>
      {groups.map((g) => (
        <View key={g.title}>
          <GroupTitle>{g.title}</GroupTitle>
          {g.items.map((p) => {
            const id = `p:${p.id}`;
            return (
              <BrowserRow
                key={p.id}
                id={id}
                title={p.name}
                sub={p.hint}
                color={CATEGORY_COLOR[p.category]}
                selected={sel === id}
                onSelect={() => pick(id)}
                onActivate={() => activate(id)}
                addLabel={`${p.name} auf die MIDI-Spur laden`}
                drag={{ kind: 'sound', presetId: p.id, name: p.name }}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function FxList({ words, sel, setSel, nav, target }: ListProps & { target?: string }) {
  const user = useStore((st) => st.devicePresets);
  const [open, setOpen] = useState<ReadonlySet<DeviceType>>(new Set());
  const groups = fxGroups(words, user);
  // While searching, every device shows its matching presets; otherwise a device folds until opened (▸ or →).
  const shows = (t: DeviceType) => words.length > 0 || open.has(t);
  const ids = groups.flatMap((g) => g.items.flatMap((d) => [`d:${d.type}`, ...(shows(d.type) ? d.presets.map((p) => `d:${d.type}:${p.id}`) : [])]));
  const toggle = (t: DeviceType, on?: boolean) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (on ?? !next.has(t)) next.add(t);
      else next.delete(t);
      return next;
    });
  const parse = (id: string) => {
    const [, type, ...rest] = id.split(':');
    return { type: type as DeviceType, presetId: rest.length ? rest.join(':') : undefined };
  };
  const activate = (id: string) => {
    const { type, presetId } = parse(id);
    addDeviceFrom(type, { presetId, trackId: target });
  };
  useNav(nav, {
    ids,
    activate,
    open: (id) => {
      const { type, presetId } = parse(id);
      if (presetId || shows(type)) return false;
      toggle(type, true);
      return true;
    },
    back: (id) => {
      if (!id) return false;
      const { type, presetId } = parse(id);
      if (presetId) setSel(`d:${type}`);
      else if (open.has(type)) toggle(type, false);
      else return false;
      return true;
    },
  });
  if (!groups.length) return <Txt style={browserStyles.empty}>Kein Effekt gefunden.</Txt>;
  return (
    <View>
      {groups.map((g) => (
        <View key={g.title}>
          <GroupTitle>{g.title}</GroupTitle>
          {g.items.map((d) => {
            const id = `d:${d.type}`;
            const expanded = shows(d.type);
            return (
              <View key={d.type}>
                <BrowserRow
                  id={id}
                  title={d.label}
                  sub={d.blurb}
                  glyph={d.presets.length ? (expanded ? '▾' : '▸') : '≋'}
                  color={C.accent}
                  selected={sel === id}
                  onSelect={() => {
                    setSel(id);
                    if (d.presets.length && !words.length) toggle(d.type);
                  }}
                  onActivate={() => activate(id)}
                  addLabel={`${d.label} in die Kette`}
                  drag={{ kind: 'device', device: d.type, name: d.label }}
                />
                {expanded &&
                  d.presets.map((p) => {
                    const pid = `d:${d.type}:${p.id}`;
                    const own = 'user' in p;
                    return (
                      <BrowserRow
                        key={p.id}
                        id={pid}
                        indent={1}
                        title={p.name}
                        sub={own ? 'Eigenes Preset' : undefined}
                        color={own ? C.accent : '#4a4a52'}
                        selected={sel === pid}
                        onSelect={() => setSel(pid)}
                        onActivate={() => activate(pid)}
                        addLabel={`${d.label} ${p.name} in die Kette`}
                        drag={{ kind: 'device', device: d.type, presetId: p.id, name: `${DEVICE_DEFS[d.type].label} · ${p.name}` }}
                        actions={own ? <RowAction label="Löschen" danger accessibilityLabel={`Preset ${p.name} löschen`} onPress={() => deleteDevicePreset(p.id)} /> : undefined}
                      />
                    );
                  })}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function MidiFxList({ words, sel, setSel, nav }: ListProps) {
  const groups = midiFxGroups(words);
  const ids = groups.flatMap((g) => g.items.map((p) => `${g.kind === 'arp' ? 'a' : 'q'}:${p.id}`));
  const activate = (id: string) => applyMidiFx(id[0] === 'a' ? 'arp' : 'seq', id.slice(2));
  useNav(nav, { ids, activate });
  if (!groups.length) return <Txt style={browserStyles.empty}>Kein MIDI-Effekt gefunden.</Txt>;
  return (
    <View>
      {groups.map((g) => (
        <View key={g.kind}>
          <GroupTitle>{g.title}</GroupTitle>
          {g.items.map((p) => {
            const id = `${g.kind === 'arp' ? 'a' : 'q'}:${p.id}`;
            return <BrowserRow key={p.id} id={id} title={p.name} sub={p.hint} glyph="⋮" color="#b48cff" selected={sel === id} onSelect={() => setSel(id)} onActivate={() => activate(id)} addLabel={`${p.name} auf die MIDI-Spur`} />;
          })}
        </View>
      ))}
    </View>
  );
}

/** The sound preset a row id names (`p:<id>`), for the preview strip. */
export const soundOf = (id: string | null) => (id?.startsWith('p:') ? presetById(id.slice(2)) : undefined);
