import { engine } from '../audio/engine';
import { arrange, type ArrangeResult, type Role } from './arranger';
import { planSections, type PlanSection } from './arrangePlan';
import { barLevels, stemKindOf, structureFromStems, type StemKind } from './referenceArrange';
import { STEMS_ROOT } from './stemNames';
import { getState, updateProject } from './store';

/** Tunes whose stems are in the library ("Stems Export/<tune>"), with their stem samples. */
export function stemTunes(samples = getState().samples): { tune: string; folder: string; count: number }[] {
  const by = new Map<string, number>();
  for (const s of samples) {
    if (!s.folder?.startsWith(`${STEMS_ROOT}/`) || !stemKindOf(s.name)) continue;
    by.set(s.folder, (by.get(s.folder) ?? 0) + 1);
  }
  return [...by].map(([folder, count]) => ({ folder, count, tune: folder.slice(STEMS_ROOT.length + 1) })).sort((a, b) => a.tune.localeCompare(b.tune));
}

/**
 * Measures the stems of one tune, turns them into its structure and lays the project out on it (the project's own tracks and
 * library, never the tune's stems; one undo step). Returns the structure and the arranger's result.
 */
export async function rebuildFromStems(folder: string, seed = Math.floor(Math.random() * 2 ** 31)): Promise<{ sections: PlanSection[]; result: ArrangeResult; bpm: number }> {
  const stems = getState().samples.filter((s) => s.folder === folder && stemKindOf(s.name));
  if (!stems.length) throw new Error('Keine Stems in diesem Ordner gefunden.');
  const bpm = stems.find((s) => s.bpm)?.bpm;
  if (!bpm) throw new Error('Das Tempo des Tunes ist unbekannt: trag bei einem Stem in der Library das BPM ein und versuch es nochmal.');
  const levels: Partial<Record<StemKind, number[]>> = {};
  for (const s of stems) {
    const kind = stemKindOf(s.name)!;
    const buffer = await engine.loadBuffer(s.id);
    const lv = barLevels(buffer.getChannelData(0), buffer.sampleRate, bpm);
    // Keys and guitar add to the synth stem.
    levels[kind] = levels[kind] ? levels[kind]!.map((v, i) => Math.max(v, lv[i] ?? 0)) : lv;
  }
  const sections = structureFromStems(levels);
  if (!sections.some((s) => s.type === 'drop')) throw new Error('In diesem Tune wurde kein Drop gefunden (Drums und Bass zusammen).');
  // New tracks only for what the tune really has.
  const plays = (roles: Role[]) => sections.some((s) => !roles.some((r) => s.mute?.includes(r)));
  const addRoles: Role[] = [...(plays(['drums']) ? (['drums'] as Role[]) : []), ...(plays(['bass']) ? (['bass'] as Role[]) : []), ...(plays(['lead']) ? (['lead'] as Role[]) : [])];
  const own = getState().samples.filter((s) => !s.folder?.startsWith(`${STEMS_ROOT}/`));
  const result = arrange(getState().project, own, { seed, addMissingTracks: true, automation: true, sections: planSections({ sections }), addRoles });
  updateProject(() => result.project);
  return { sections, result, bpm };
}
