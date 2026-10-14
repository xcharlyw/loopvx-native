import { STEMS_ENDPOINT } from '../config';
import type { Sample } from '../types';
import { autoDetectTempos } from './actions';
import { FOLDER_MIME, createFile, download, driveAccessToken, driveLinked, folder, uploadLarge } from './drive';
import { byStemOrder, stemSample, STEMS_ROOT, tuneName } from './stemNames';
import { storeSampleAudio } from './samples';
import { errorText, getState, setSamples, setState, toast, upsertSamples } from './store';
import { pickFile } from './samples';
import { confirmDestructive } from '../ui/confirm';
import { stemFolder } from './stemNames';
import { getSession } from './supabase';

export type StemStep = 'upload' | 'separate' | 'download';

const mimeOf = (name: string) => (/\.wav$/i.test(name) ? 'audio/wav' : /\.(aif|aiff)$/i.test(name) ? 'audio/aiff' : /\.flac$/i.test(name) ? 'audio/flac' : /\.m4a$/i.test(name) ? 'audio/mp4' : 'audio/mpeg');

/**
 * Splits a tune into stems: upload to LOOPVX/Stems Export/<tune> in Drive, separation on the server (ElevenLabs, the stems land
 * next to the tune in Drive), then every stem into the library folder "Stems Export/<tune>". All stems get the tune's tempo
 * (from the name, else measured on the drums), so they line up when played together.
 */
export async function separateTune(file: { name: string; data: ArrayBuffer }, onStep: (step: StemStep, detail?: string) => void): Promise<Sample[]> {
  const session = await getSession();
  if (!session) throw new Error('Bitte zuerst anmelden (Projekte → Mit Google anmelden).');
  if (!(await driveLinked())) throw new Error('Für Stems braucht die App Google Drive: bitte mit Google anmelden.');
  const tune = tuneName(file.name);

  onStep('upload');
  const root = await folder('root', 'LOOPVX');
  const exportDir = await folder('stems', STEMS_ROOT, root);
  const tuneDir = await createFile({ name: tune, mimeType: FOLDER_MIME, parents: [exportDir] });
  const uploaded = await uploadLarge({ name: file.name, parents: [tuneDir.id], appProperties: { loopvx: 'stem-source' } }, new Uint8Array(file.data), mimeOf(file.name));

  onStep('separate');
  const res = await fetch(STEMS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ fileId: uploaded.id, folderId: tuneDir.id, name: tune, accessToken: await driveAccessToken() }),
  });
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `Stem-Trennung fehlgeschlagen (${res.status})`);
  const { stems } = (await res.json()) as { stems: { id: string; name: string; stem: string; size: number }[] };

  const added: Sample[] = [];
  for (const stem of byStemOrder(stems)) {
    onStep('download', stem.stem);
    const sample = stemSample(file.name, stem);
    const ext = (/\.([a-z0-9]{2,5})$/i.exec(stem.name)?.[1] ?? 'mp3').toLowerCase();
    await storeSampleAudio(sample, await download(stem.id), ext);
    added.push(sample);
    setSamples([...getState().samples.filter((x) => x.id !== sample.id), sample]);
  }

  // One tempo for all stems: from the name, else measured on the drums (the clearest rhythm).
  if (!added[0]?.bpm) {
    const drums = added.find((x) => /- Drums\./.test(x.name)) ?? added.find((x) => x.category !== 'vocal');
    if (drums && (await autoDetectTempos([drums]))) {
      const bpm = getState().samples.find((x) => x.id === drums.id)?.bpm;
      if (bpm) await upsertSamples(getState().samples.filter((x) => added.some((a) => a.id === x.id) && x.bpm !== bpm).map((x) => ({ ...x, bpm })));
    }
  }
  return added;
}

const STEP_TEXT: Record<StemStep, string> = { upload: 'Lade den Tune in deinen Drive-Ordner …', separate: 'ElevenLabs trennt die Stems (dauert 1–3 Minuten) …', download: 'Lade Stem' };

/** The whole flow from a tap (Library button or menu): pick the tune, confirm the credits, separate, open the stems' folder. */
export async function startStemSeparation(): Promise<void> {
  if (getState().stemStatus) {
    toast('Es läuft schon eine Stem-Trennung.');
    return;
  }
  try {
    const picked = await pickFile(); // first, inside the tap: browsers only open the file chooser in a gesture
    if (!picked) return;
    const tune = tuneName(picked.name);
    const ok = await confirmDestructive(
      `„${tune}“ in Stems trennen?`,
      'ElevenLabs trennt den Tune in Drums, Bass, Synth + FX, Keys, Gitarre und Vocal. Das kostet ElevenLabs-Credits (wie die AI Vocals). Tune und Stems liegen danach auch in Google Drive unter LOOPVX/Stems Export.',
      'Trennen',
    );
    if (!ok) return;
    setState({ panel: 'library', stemStatus: 'Startet …' });
    const added = await separateTune(picked, (step, detail) => setState({ stemStatus: `${STEP_TEXT[step]}${detail ? ` ${detail} …` : ''}` }));
    setState({ libraryJump: stemFolder(tune) });
    toast(`${added.length} Stems von „${tune}“ in der Library (Stems Export/${tune})`);
  } catch (e) {
    toast(errorText(e), 'error');
  } finally {
    setState({ stemStatus: null });
  }
}
