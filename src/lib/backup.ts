import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Project, Sample } from '../types';

// A ".loopvx" file: one project plus the audio of every sample it uses, as a zip.
//   loopvx.json          { format, version, project, samples }
//   samples/<n>.<ext>    the audio files, in the order of `samples`

const FORMAT = 'loopvx-project';
const VERSION = 1;

export interface PackedSample {
  sample: Sample;
  data: Uint8Array;
}

const extOf = (name: string) => (/\.([a-z0-9]{2,5})$/i.exec(name)?.[1] ?? 'bin').toLowerCase();

/** Every sample a project uses, in its arrangement, its session grid or as an instrument. */
export function usedSampleIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const t of project.tracks) {
    for (const c of t.clips) if (c.sampleId) ids.add(c.sampleId); // MIDI clips have none
    for (const s of t.slots) if (s) ids.add(s.sampleId);
    if (t.synth?.wave === 'sample' && t.synth.sampleId) ids.add(t.synth.sampleId);
  }
  return ids;
}

export function packProject(project: Project, samples: PackedSample[]): Uint8Array {
  // Device-local paths mean nothing on another device.
  const meta = samples.map(({ sample }) => ({ ...sample, uri: undefined }));
  const files: Record<string, Uint8Array> = {
    'loopvx.json': strToU8(JSON.stringify({ format: FORMAT, version: VERSION, project, samples: meta })),
  };
  samples.forEach(({ sample, data }, i) => {
    files[`samples/${i}.${extOf(sample.name)}`] = data;
  });
  return zipSync(files, { level: 0 });
}

export function unpackProject(bytes: Uint8Array): { project: Project; samples: PackedSample[] } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('Das ist keine LOOPVX-Projektdatei.');
  }
  const index = files['loopvx.json'];
  if (!index) throw new Error('Das ist keine LOOPVX-Projektdatei.');
  const parsed = JSON.parse(strFromU8(index)) as { format?: string; version?: number; project?: Project; samples?: Sample[] };
  if (parsed.format !== FORMAT || !parsed.project) throw new Error('Das ist keine LOOPVX-Projektdatei.');
  if ((parsed.version ?? 0) > VERSION) throw new Error('Die Datei stammt aus einer neueren LOOPVX-Version.');
  const samples = (parsed.samples ?? []).flatMap((sample, i) => {
    const data = files[`samples/${i}.${extOf(sample.name)}`];
    return data ? [{ sample, data }] : [];
  });
  return { project: parsed.project, samples };
}
