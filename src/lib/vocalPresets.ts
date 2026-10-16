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
  language: 'de' | 'es' | 'en' | 'pt' | null;
  /** Genre chip (older presets have none). */
  genre?: 'techno' | 'hard-techno' | 'melodic-techno' | 'tech-house' | 'house' | 'trance' | null;
  speed: number;
  expression: number;
  stability: number;
  /** Closeness to the cloned voice (older presets have none: 0.9). */
  similarity?: number;
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

const factory = (key: string, name: string, prompt: string, style: VocalPreset['style'], knobs: { speed?: number; expression?: number; stability?: number } = {}): VocalPreset => ({
  id: `factory:${key}`,
  name,
  prompt,
  lyrics: '',
  bars: 8,
  vocalsOnly: true,
  gender: 'female',
  style,
  language: null,
  speed: knobs.speed ?? (style === 'rap' ? 1.1 : 1),
  expression: knobs.expression ?? (style === 'rap' ? 0.6 : 0.3),
  stability: knobs.stability ?? (style === 'rap' ? 0.35 : 0.5),
  voiceId: null,
});

/** Ten built-in techno / neo rave vocal styles with a name each (Karl's list); they cannot be deleted. */
export const FACTORY_PRESETS: VocalPreset[] = [
  factory('alexa', 'Alexa (Dark Seductive Rap)', 'Deep sexy female voice, seductive techno rap, hypnotic rhythmic flow, breathy whispers, commanding attitude, dark club energy, no singing.', 'rap'),
  factory('roxanne', 'Roxanne (Aggressive Rave Queen)', 'Fierce female rave voice, aggressive rhythmic rap, sharp staccato delivery, powerful attitude, raw high-energy intensity, no singing.', 'rap', { speed: 1.15, expression: 0.8, stability: 0.3 }),
  factory('luna', 'Luna (Hypnotic Techno Whisper)', 'Sultry female whisper-rap, intimate breathy texture, hypnotic repetition, slow controlled rhythm, mysterious dark techno atmosphere, no singing.', 'rap', { speed: 0.9, expression: 0.4, stability: 0.6 }),
  factory('nova', 'Nova (Futuristic Cyber Diva)', 'Cold futuristic female voice, robotic techno rap, precise mechanical rhythm, detached seductive tone, sharp articulation, no singing.', 'rap', { expression: 0.2, stability: 0.8 }),
  factory('raven', 'Raven (Dirty Underground Rave)', 'Low raspy female voice, gritty underground techno rap, provocative attitude, punchy rhythmic delivery, raw warehouse energy, no singing.', 'rap'),
  factory('valentina', 'Valentina (Neo Rave Dominatrix)', 'Dominant sexy female voice, bold commanding techno spoken rap, teasing pauses, intense rhythmic phrasing, dark provocative energy, no singing.', 'rap', { speed: 1, expression: 0.7, stability: 0.45 }),
  factory('kira', 'Kira (Acid Techno Siren)', 'High-pitched edgy female voice, playful acid rave rap, fast rhythmic delivery, mischievous attitude, electrifying energy, no singing.', 'rap', { speed: 1.2, expression: 0.8, stability: 0.3 }),
  factory('nina', 'Nina (Berlin Afterhours)', 'Deep smoky female voice, minimal hypnotic spoken techno, cool detached attitude, dry intimate delivery, subtle seductive tension, no singing.', 'spoken', { speed: 0.95, expression: 0.25, stability: 0.65 }),
  factory('electra', 'Electra (Peak-Time Festival Hype)', 'Powerful energetic female rave MC, punchy fast-paced techno rap, bold crowd-commanding delivery, explosive excitement, no singing.', 'rap', { speed: 1.15, expression: 0.9, stability: 0.3 }),
  factory('zara', 'Zara (Neon Psycho Rave)', 'Wild edgy female voice, manic neo rave rap, playful sinister attitude, rapid staccato flow, unpredictable vocal intensity, no singing.', 'rap', { speed: 1.2, expression: 0.9, stability: 0.2 }),
];
