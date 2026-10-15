import { DEFAULT_ARP, DEFAULT_SEQ } from '../audio/notefx';
import { arpPresetById, seqPresetById } from '../audio/notefxPresets';
import type { ArpSettings, SeqSettings, SeqStep } from '../types';
import { mapTrack } from './project';
import { getState, updateProject } from './store';

// Edits of a track's MIDI effects (shared by the full MIDI-Effekte panel and the compact cards of the device chain).
// Turning one of the two on turns the other off. Knob drags merge into one undo step, switches and presets are their own.

const track = (id: string) => getState().project.tracks.find((t) => t.id === id);
export const arpOf = (id: string): ArpSettings => ({ ...DEFAULT_ARP, ...track(id)?.arp });
export const seqOf = (id: string): SeqSettings => ({ ...DEFAULT_SEQ, ...track(id)?.seq });

export function setArp(trackId: string, patch: Partial<ArpSettings>, step = false) {
  updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, arp: { ...DEFAULT_ARP, ...t.arp, ...patch }, ...(patch.on ? { seq: t.seq ? { ...t.seq, on: false } : t.seq } : {}) })), step ? undefined : { merge: true });
}

export function setSeq(trackId: string, patch: Partial<SeqSettings>, step = false) {
  updateProject((p) => mapTrack(p, trackId, (t) => ({ ...t, seq: { ...DEFAULT_SEQ, ...t.seq, ...patch }, ...(patch.on ? { arp: t.arp ? { ...t.arp, on: false } : t.arp } : {}) })), step ? undefined : { merge: true });
}

export function setSeqStep(trackId: string, i: number, patch: Partial<SeqStep>) {
  setSeq(trackId, { steps: seqOf(trackId).steps.map((st, j) => (j === i ? { ...st, ...patch } : st)) });
}

export function applyArpPreset(trackId: string, id: string) {
  const p = arpPresetById(id);
  if (p) setArp(trackId, { ...p.arp, preset: p.id }, true);
}

export function applySeqPreset(trackId: string, id: string) {
  const p = seqPresetById(id);
  if (p) setSeq(trackId, { ...p.seq, steps: p.seq.steps.map((x) => ({ ...x })), preset: p.id }, true);
}

/** The id `d` places after `cur` in a preset list (wrapping; none selected starts at the first / last). */
export function stepId<T extends { id: string }>(list: T[], cur: string | undefined, d: 1 | -1): string {
  const i = list.findIndex((x) => x.id === cur);
  return list[(i < 0 ? (d > 0 ? 0 : list.length - 1) : (i + d + list.length) % list.length)].id;
}
