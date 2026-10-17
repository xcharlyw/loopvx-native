import { DEVICE_DEFS, GROUP_LABELS, GROUP_ORDER } from '../audio/devices';
import { DEVICE_PRESETS, type DevicePreset } from '../audio/devicepresets';
import { ARP_PRESETS, SEQ_PRESETS, type ArpPreset, type SeqPreset } from '../audio/notefxPresets';
import { PRESET_CATEGORIES, PRESETS, type SoundPreset } from '../audio/presets';
import type { DeviceType, Project, Sample } from '../types';
import { CATEGORY_LABELS, trackKind } from './project';
import type { UserDevicePreset } from './userPresets';

// The model of the browser (Ableton Live 12's left column): its categories and places, the multi-word search shared by every
// list, and what each list shows. Pure, so the lists can be tested without the UI.

export type BrowserCat = 'samples' | 'sounds' | 'drums' | 'fx' | 'midifx' | 'drive' | 'splice' | 'record' | 'stems';

export interface CatDef {
  id: BrowserCat;
  label: string;
  group: 'Kategorien' | 'Orte';
  /** A short glyph in front of the label (the sidebar and the phone tabs). */
  icon: string;
}

export const BROWSER_CATS: CatDef[] = [
  { id: 'samples', label: 'Samples', group: 'Kategorien', icon: '♪' },
  { id: 'sounds', label: 'Sounds', group: 'Kategorien', icon: '◆' },
  { id: 'drums', label: 'Drums', group: 'Kategorien', icon: '▦' },
  { id: 'fx', label: 'Audio-Effekte', group: 'Kategorien', icon: '≋' },
  { id: 'midifx', label: 'MIDI-Effekte', group: 'Kategorien', icon: '⋮' },
  { id: 'drive', label: 'Google Drive', group: 'Orte', icon: '☁' },
  { id: 'splice', label: 'Splice', group: 'Orte', icon: '✦' },
  { id: 'record', label: 'Aufnahmen', group: 'Orte', icon: '●' },
  { id: 'stems', label: 'Stems', group: 'Orte', icon: '⫼' },
];

/** The categories whose lists the search field filters (the places have their own search or none). */
export const SEARCHABLE: ReadonlySet<BrowserCat> = new Set(['samples', 'sounds', 'drums', 'fx', 'midifx', 'record', 'stems']);

/** The words of a search, lower case. */
export const searchWords = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean);

/** Live's search: every word has to appear somewhere in the item's texts (in any order, as part of a word). */
export function matchesAll(texts: (string | undefined)[], words: string[]): boolean {
  if (!words.length) return true;
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** What a sample can be found by: name, folder, category, key, tempo ("150", "150 bpm"), loop or one-shot. */
export function sampleTexts(s: Sample): string[] {
  return [s.name, s.folder, CATEGORY_LABELS[s.category], s.key, s.bpm ? `${s.bpm} bpm loop` : 'one-shot oneshot'].filter((x): x is string => !!x);
}
export const sampleMatches = (s: Sample, words: string[]) => matchesAll(sampleTexts(s), words);

/** A key as short as the browser's column shows it: "F minor" → "Fm", "A# major" → "A#", "Am" stays; anything else unchanged. */
export function shortKey(key?: string): string {
  const m = /^([A-G][#b]?)(?:\s*(major|maj|minor|min|m))?$/i.exec((key ?? '').trim());
  if (!m) return key ?? '';
  const minor = !!m[2] && !/^maj/i.test(m[2]);
  return `${m[1]}${minor ? 'm' : ''}`;
}

export interface SoundGroup {
  title: string;
  items: SoundPreset[];
}

/** The instrument presets by category: "Sounds" holds the synth sounds, "Drums" the drum voices and kits. */
export function soundGroups(words: string[], drums: boolean): SoundGroup[] {
  return PRESET_CATEGORIES.filter((c) => (c === 'Drums') === drums)
    .map((title) => ({ title, items: PRESETS.filter((p) => p.category === title && matchesAll([p.name, p.hint, p.category], words)) }))
    .filter((g) => g.items.length > 0);
}

export interface FxEntry {
  type: DeviceType;
  label: string;
  blurb: string;
  /** The presets to list under the device: all of them, or only the ones the search matched by name. */
  presets: (DevicePreset | UserDevicePreset)[];
}

/**
 * The audio effects by group, each with its presets (the user's own first). A device found by its name, group or description shows all
 * its presets; otherwise only the presets whose names match are listed (and the device only if one does). Splice is a place of its own.
 */
export function fxGroups(words: string[], user: UserDevicePreset[] = []): { title: string; items: FxEntry[] }[] {
  return GROUP_ORDER.map((g) => {
    const items: FxEntry[] = [];
    for (const def of Object.values(DEVICE_DEFS)) {
      if (def.group !== g || def.type === 'splice') continue;
      const all = [...user.filter((p) => p.type === def.type), ...DEVICE_PRESETS[def.type].filter((p) => p.id !== 'default')];
      const self = matchesAll([def.label, def.blurb, GROUP_LABELS[g]], words);
      const presets = self ? all : all.filter((p) => matchesAll([p.name, def.label], words));
      if (self || presets.length) items.push({ type: def.type, label: def.label, blurb: def.blurb, presets });
    }
    return { title: GROUP_LABELS[g], items };
  }).filter((g) => g.items.length > 0);
}

export type MidiFxGroup = { kind: 'arp'; title: string; items: ArpPreset[] } | { kind: 'seq'; title: string; items: SeqPreset[] };

/** The MIDI effects with their presets. */
export function midiFxGroups(words: string[]): MidiFxGroup[] {
  const groups: MidiFxGroup[] = [
    { kind: 'arp', title: 'Arpeggiator', items: ARP_PRESETS.filter((p) => matchesAll([p.name, p.hint, 'arpeggiator arp'], words)) },
    { kind: 'seq', title: 'Sequencer', items: SEQ_PRESETS.filter((p) => matchesAll([p.name, p.hint, 'sequencer step'], words)) },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** The track a sound or a MIDI effect from the browser goes to: the selected MIDI track, else none (a new MIDI track is made). */
export function midiTarget(project: Project, selectedTrackId: string | null): string | null {
  const t = project.tracks.find((x) => x.id === selectedTrackId);
  return t && trackKind(t) === 'midi' ? t.id : null;
}

/** The track an audio effect from the browser goes to: the selected track (any kind), else none. */
export function fxTarget(project: Project, selectedTrackId: string | null): string | null {
  return project.tracks.some((x) => x.id === selectedTrackId) ? selectedTrackId : null;
}

/** The item before or after `current` in a list (arrow keys); none selected starts at the first or the last; stays at the ends. */
export function stepSelection(ids: string[], current: string | null, delta: 1 | -1): string | null {
  if (!ids.length) return null;
  const i = current === null ? -1 : ids.indexOf(current);
  if (i < 0) return delta > 0 ? ids[0] : ids[ids.length - 1];
  return ids[Math.max(0, Math.min(ids.length - 1, i + delta))];
}
