/** A saved AI Vocals setup: the style prompt, the text, the quick-pick chips and the knobs (and the cloned voice, if one was chosen). */
export interface VocalPreset {
  id: string;
  name: string;
  prompt: string;
  lyrics: string;
  bars: number;
  vocalsOnly: boolean;
  gender: 'male' | 'female' | null;
  style: 'rap' | 'spoken' | 'sing' | null;
  language: 'de' | 'es' | 'en' | null;
  speed: number;
  expression: number;
  stability: number;
  voiceId: string | null;
}

/** Saving under a name that exists replaces that preset (keeps its place); a new name goes to the end. */
export function upsertPreset(list: VocalPreset[], preset: VocalPreset): VocalPreset[] {
  const name = preset.name.trim();
  const at = list.findIndex((p) => p.name.trim().toLowerCase() === name.toLowerCase());
  if (at < 0) return [...list, { ...preset, name }];
  return list.map((p, i) => (i === at ? { ...preset, id: p.id, name } : p));
}

export const removePreset = (list: VocalPreset[], id: string): VocalPreset[] => list.filter((p) => p.id !== id);

/** The voice of a preset only counts while that cloned voice still exists. */
export const presetVoice = (preset: VocalPreset, voiceIds: string[]): string | null => (preset.voiceId && voiceIds.includes(preset.voiceId) ? preset.voiceId : null);
