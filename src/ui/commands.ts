import { Platform } from 'react-native';
import { engine } from '../audio/engine';
import {
  consolidateSelectedClip,
  copySelectedClips,
  createMidiClipOnTrack,
  deleteSelectedClip,
  duplicateSelection,
  duplicateSelectedTrack,
  groupSelectedTrack,
  openSlicePanel,
  ungroupSelectedTrack,
  loopSelection,
  nudgeSelectedClip,
  pasteClipsAtCursor,
  selectAllClipsOfTrack,
  setCursor,
  splitSelectedClip,
  toggleMuteSelectedClips,
  togglePlay, exportForAbleton } from '../lib/actions';
import type { KeySpec } from '../lib/keymap';
import { addMarker } from '../lib/markers';
import { startStemSeparation } from '../lib/stems';
import { toggleTrackRecording } from '../lib/trackRecording';
import { runLoadMissing } from '../lib/sync';
import { UI_SCALES, UI_SCALE_LABEL } from '../lib/uiScale';
import { closeWindow } from '../lib/windowActions';
import type { WinId } from '../lib/windows';
import { createMidiTrack, createProject, createTrack, findClip, quantizeNotes, updateClip } from '../lib/project';
import { flushSave, getState, openProject, redo, setMetronome, setState, setUiScale, toast, undo, updateProject, type AppState, type Panel } from '../lib/store';
import { db } from '../storage/db';
import { MAX_ZOOM, MIN_ZOOM } from './ArrangeView';

// Every action of the app in one place, Ableton Live 12 style: the menu bar, the shortcut handler and the shortcut list all
// read this table, so a shortcut shown in a menu is the one that works. Shortcuts are Live's own; where a browser keeps a key
// for itself (Cmd+T new tab, Cmd+N new window, Cmd+W close) a second key is listed that the browser leaves alone.

export type MenuGroup = 'Datei' | 'Bearbeiten' | 'Erstellen' | 'Ansicht' | 'Optionen' | 'Hilfe';
/** Opens a plugin panel (a floating window on wide screens, a sheet on a phone), or closes it when it is already open. */
function togglePlugin(id: WinId, extra: Partial<AppState> = {}) {
  const s = getState();
  if (s.windows.some((w) => w.id === id)) return closeWindow(id);
  setState({ ...extra, panel: s.panel === id ? 'none' : id });
}

export const MENU_GROUPS: MenuGroup[] = ['Datei', 'Bearbeiten', 'Erstellen', 'Ansicht', 'Optionen', 'Hilfe'];

export interface Command {
  id: string;
  label: string;
  group: MenuGroup | null;
  /** First = shown in menus; all of them work. */
  keys?: KeySpec[];
  run: () => void;
  enabled?: () => boolean;
  /** A line above it in the menu. */
  separator?: boolean;
}

const arrange = () => getState().view === 'arrange';
const hasClip = () => arrange() && !!getState().selectedClipId;
const toggle = (panel: Panel) => setState((st) => ({ panel: st.panel === panel ? 'none' : panel }));
const selectedTrack = () => getState().project.tracks.find((t) => t.id === getState().selectedTrackId);

/** Same breakpoint as `useSmall`: above it the Library is Live's browser column. */
const wideScreen = () => Platform.OS === 'web' && typeof window !== 'undefined' && window.innerWidth > 720;
export function toggleBrowser() {
  if (wideScreen()) setState((st) => ({ browserOpen: !st.browserOpen, panel: st.panel === 'library' ? 'none' : st.panel }));
  else toggle('library');
}

function addTrack(midi: boolean) {
  updateProject((p) => {
    const track = midi ? createMidiTrack(p.sceneCount) : createTrack('other', p.sceneCount);
    // Like Live: the new track goes right after the selected one.
    const at = p.tracks.findIndex((t) => t.id === getState().selectedTrackId);
    const tracks = [...p.tracks];
    tracks.splice(at < 0 ? tracks.length : at + 1, 0, track);
    setState({ selectedTrackId: track.id });
    return { ...p, tracks };
  }, { reschedule: false });
}

function selectTrack(delta: number) {
  const { project, selectedTrackId } = getState();
  if (!project.tracks.length) return;
  const i = project.tracks.findIndex((t) => t.id === selectedTrackId);
  const next = project.tracks[Math.max(0, Math.min(project.tracks.length - 1, (i < 0 ? 0 : i) + delta))];
  setState({ selectedTrackId: next.id, selectedClipId: null });
}

function quantize() {
  const { project, selectedClipId } = getState();
  const found = selectedClipId ? findClip(project, selectedClipId) : null;
  if (!found?.clip.notes) return toast('Wähle zuerst einen MIDI-Clip.');
  updateProject((p) => updateClip(p, found.clip.id, { ...found.clip, notes: quantizeNotes(found.clip.notes!, 1 / 16) }));
  toast('Auf 1/16 quantisiert');
}

async function newProject() {
  const current = getState().project;
  const count = (await db.getProjects()).length;
  const p = createProject(`Projekt ${count + 1}`, current.bpm, current.key);
  await db.putProject(p);
  await openProject(p);
  toast(`${p.name} angelegt`);
}

function zoom(factor: number) {
  setState((st) => ({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, st.zoom * factor)) }));
}

export const COMMANDS: Command[] = [
  // Datei
  { id: 'new', label: 'Neues Projekt', group: 'Datei', keys: [{ letter: 'n', mod: true, alt: true }], run: () => void newProject() },
  { id: 'open', label: 'Projekte öffnen …', group: 'Datei', keys: [{ letter: 'o', mod: true }], run: () => setState({ panel: 'projects' }) },
  { id: 'save', label: 'Speichern', group: 'Datei', keys: [{ letter: 's', mod: true }], run: () => void flushSave().then(() => toast('Gespeichert')) },
  { id: 'missing', label: 'Fehlende Samples laden', group: 'Datei', keys: [], run: () => void runLoadMissing() },
  { id: 'stems', label: 'Tune in Stems trennen …', group: 'Datei', keys: [], run: () => void startStemSeparation() },
  { id: 'export', label: 'Audio exportieren …', group: 'Datei', separator: true, keys: [{ letter: 'r', mod: true, shift: true }], run: () => setState({ panel: 'export' }) },
  { id: 'abletonExport', label: 'Für Ableton exportieren', group: 'Datei', keys: [], enabled: () => getState().project.tracks.some((t) => t.clips.length > 0), run: () => void exportForAbleton() },

  // Bearbeiten
  { id: 'undo', label: 'Rückgängig', group: 'Bearbeiten', keys: [{ letter: 'z', mod: true }], run: undo },
  { id: 'redo', label: 'Wiederherstellen', group: 'Bearbeiten', keys: [{ letter: 'z', mod: true, shift: true }, { letter: 'y', mod: true }], run: redo },
  { id: 'copy', label: 'Kopieren', group: 'Bearbeiten', separator: true, keys: [{ letter: 'c', mod: true }], run: copySelectedClips, enabled: hasClip },
  { id: 'paste', label: 'Einfügen', group: 'Bearbeiten', keys: [{ letter: 'v', mod: true }], run: pasteClipsAtCursor, enabled: arrange },
  { id: 'duplicate', label: 'Duplizieren (Clip oder Spur)', group: 'Bearbeiten', keys: [{ letter: 'd', mod: true }], run: duplicateSelection, enabled: () => arrange() && (!!getState().selectedClipId || !!selectedTrack()) },
  { id: 'groupTrack', label: 'Spur gruppieren', group: 'Erstellen', keys: [{ letter: 'g', mod: true }], run: groupSelectedTrack, enabled: () => !!selectedTrack() },
  { id: 'ungroupTrack', label: 'Gruppe auflösen', group: 'Erstellen', keys: [{ letter: 'g', mod: true, shift: true }], run: ungroupSelectedTrack, enabled: () => !!selectedTrack() },
  { id: 'duplicateTrack', label: 'Spur duplizieren', group: 'Erstellen', run: duplicateSelectedTrack, enabled: () => !!selectedTrack() },
  { id: 'delete', label: 'Löschen', group: 'Bearbeiten', keys: [{ keys: ['Delete', 'Backspace'] }], run: deleteSelectedClip, enabled: hasClip },
  { id: 'muteClip', label: 'Clip stummschalten', group: 'Bearbeiten', keys: [{ letter: '0' }], run: toggleMuteSelectedClips, enabled: hasClip },
  { id: 'split', label: 'Clip teilen', group: 'Bearbeiten', separator: true, keys: [{ letter: 'e', mod: true }], run: splitSelectedClip, enabled: hasClip },
  { id: 'slice', label: 'Clip slicen …', group: 'Bearbeiten', keys: [], run: () => openSlicePanel(), enabled: hasClip },
  { id: 'consolidate', label: 'Konsolidieren', group: 'Bearbeiten', keys: [{ letter: 'j', mod: true }], run: () => void consolidateSelectedClip(), enabled: hasClip },
  { id: 'quantize', label: 'Quantisieren (1/16)', group: 'Bearbeiten', keys: [{ letter: 'u', mod: true }], run: quantize, enabled: hasClip },
  { id: 'loopSel', label: 'Loop auf Auswahl', group: 'Bearbeiten', keys: [{ letter: 'l', mod: true }], run: loopSelection, enabled: hasClip },
  { id: 'selectAll', label: 'Alle Clips der Spur auswählen', group: 'Bearbeiten', keys: [{ letter: 'a', mod: true }], run: selectAllClipsOfTrack, enabled: arrange },
  { id: 'rename', label: 'Spur umbenennen …', group: 'Bearbeiten', keys: [{ letter: 'r', mod: true }], run: () => selectedTrack() && setState({ panel: 'track' }), enabled: () => !!selectedTrack() },

  // Erstellen
  { id: 'audioTrack', label: 'Audio-Spur einfügen', group: 'Erstellen', keys: [{ letter: 't', mod: true }, { letter: 't', alt: true }], run: () => addTrack(false) },
  { id: 'midiTrack', label: 'MIDI-Spur einfügen', group: 'Erstellen', keys: [{ letter: 't', mod: true, shift: true }, { letter: 't', alt: true, shift: true }], run: () => addTrack(true) },
  { id: 'midiClip', label: 'MIDI-Clip einfügen', group: 'Erstellen', keys: [{ letter: 'm', mod: true, shift: true }], run: () => selectedTrack() && createMidiClipOnTrack(selectedTrack()!.id), enabled: () => !!selectedTrack() && arrange() },
  { id: 'marker', label: 'Marker hinzufügen', group: 'Erstellen', separator: true, keys: [{ letter: 'i', mod: true }], run: () => updateProject((p) => addMarker(p, getState().cursor), { reschedule: false }), enabled: arrange },
  { id: 'markers', label: 'Marker umbenennen / löschen …', group: 'Bearbeiten', keys: [], run: () => setState({ panel: 'markers' }), enabled: arrange },
  { id: 'arranger', label: 'Arrangement mit KI …', group: 'Erstellen', run: () => setState({ panel: 'arranger' }) },

  // Ansicht
  { id: 'view', label: 'Session / Arrangement umschalten', group: 'Ansicht', keys: [{ keys: ['Tab'], shift: false }], run: () => { engine.stop(); setState((st) => ({ view: st.view === 'arrange' ? 'session' : 'arrange', armedSampleId: null })); } },
  { id: 'browser', label: 'Browser (Library)', group: 'Ansicht', separator: true, keys: [{ letter: 'b', mod: true, alt: true }], run: toggleBrowser },
  { id: 'mixer', label: 'Mixer', group: 'Ansicht', keys: [{ letter: 'm', mod: true, alt: true }], run: () => toggle('mixer') },
  { id: 'devices', label: 'Geräte der Spur', group: 'Ansicht', keys: [{ letter: 'l', mod: true, alt: true }], run: () => selectedTrack() && togglePlugin('devices', { devicesFor: 'track' }), enabled: () => !!selectedTrack() },
  { id: 'instrument', label: 'Sound der Spur (Synth)', group: 'Ansicht', run: () => selectedTrack() && togglePlugin('instrument'), enabled: () => !!selectedTrack() },
  { id: 'notefx', label: 'MIDI-Effekte (Arpeggiator, Sequencer)', group: 'Ansicht', run: () => selectedTrack() && togglePlugin('notefx'), enabled: () => !!selectedTrack() },
  { id: 'clipView', label: 'Clip / Piano Roll', group: 'Ansicht', keys: [{ keys: ['Tab'], shift: true }], run: () => getState().selectedClipId && setState((st) => ({ panel: st.panel === 'clip' ? 'piano' : 'clip' })), enabled: hasClip },
  { id: 'autoMode', label: 'Automations-Modus', group: 'Ansicht', separator: true, keys: [{ letter: 'a' }], run: () => setState((st) => ({ autoMode: !st.autoMode })), enabled: arrange },
  { id: 'zoomIn', label: 'Hineinzoomen', group: 'Ansicht', separator: true, keys: [{ keys: ['+', '='] }], run: () => zoom(1.4) },
  { id: 'zoomOut', label: 'Herauszoomen', group: 'Ansicht', keys: [{ keys: ['-'] }], run: () => zoom(1 / 1.4) },
  { id: 'trackUp', label: 'Vorherige Spur', group: null, keys: [{ keys: ['ArrowUp'], shift: false }], run: () => selectTrack(-1) },
  { id: 'trackDown', label: 'Nächste Spur', group: null, keys: [{ keys: ['ArrowDown'], shift: false }], run: () => selectTrack(1) },

  // Optionen (Live keeps transport options here)
  { id: 'record', label: 'Aufnehmen auf Spur', group: 'Optionen', keys: [{ letter: 'r', alt: true }], run: () => void toggleTrackRecording(), enabled: arrange },
  { id: 'midiSettings', label: 'MIDI-Controller …', group: 'Optionen', keys: [], run: () => setState({ panel: 'midi' }) },
  { id: 'recordSettings', label: 'Aufnahme-Einstellungen …', group: 'Optionen', keys: [], run: () => setState({ panel: 'record' }) },
  { id: 'play', label: 'Play / Stop', group: 'Optionen', keys: [{ keys: [' '] }], run: () => void togglePlay() },
  { id: 'home', label: 'Zum Anfang', group: 'Optionen', keys: [{ keys: ['Home'] }], run: () => setCursor(0) },
  { id: 'loop', label: 'Loop an / aus', group: 'Optionen', keys: [{ letter: 'l', mod: true, shift: true }], run: () => updateProject((p) => ({ ...p, loop: { ...p.loop, enabled: !p.loop.enabled } })) },
  { id: 'drawMode', label: 'Zeichenmodus (Automation)', group: 'Optionen', keys: [{ letter: 'b' }, { letter: 'b', mod: true }], run: () => setState((st) => ({ drawMode: !st.drawMode })) },
  ...UI_SCALES.map((sc): Command => ({ id: `ui-${sc}`, label: `Anzeige: ${UI_SCALE_LABEL[sc]}`, group: 'Optionen', run: () => setUiScale(sc) })),
  { id: 'metronome', label: 'Metronom', group: 'Optionen', keys: [{ letter: 'k', mod: true, shift: true }], run: () => setMetronome(!getState().metronome) },
  { id: 'nudgeL', label: 'Clip 1/16 nach links', group: null, keys: [{ keys: ['ArrowLeft'], shift: false }], run: () => nudgeSelectedClip(-0.25), enabled: hasClip },
  { id: 'nudgeR', label: 'Clip 1/16 nach rechts', group: null, keys: [{ keys: ['ArrowRight'], shift: false }], run: () => nudgeSelectedClip(0.25), enabled: hasClip },
  { id: 'nudgeBarL', label: 'Clip 1 Takt nach links', group: null, keys: [{ keys: ['ArrowLeft'], shift: true }], run: () => nudgeSelectedClip(-1), enabled: hasClip },
  { id: 'nudgeBarR', label: 'Clip 1 Takt nach rechts', group: null, keys: [{ keys: ['ArrowRight'], shift: true }], run: () => nudgeSelectedClip(1), enabled: hasClip },

  // Hilfe
  { id: 'shortcuts', label: 'Tastenkürzel', group: 'Hilfe', keys: [{ keys: ['?'] }], run: () => toggle('shortcuts') },
  { id: 'close', label: 'Fenster schließen', group: null, keys: [{ keys: ['Escape'] }], run: () => setState({ panel: 'none', armedSampleId: null, selectedClipId: null }) },
];

export const commandById = (id: string) => COMMANDS.find((c) => c.id === id);
export const isMac = () => Platform.OS === 'web' && typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
