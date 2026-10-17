import { Zip, ZipPassThrough } from 'fflate';

/**
 * A ZIP written file by file without compression, handed back as a list of chunks. Nothing is joined into one big array, so a
 * project of many long WAVs (hundreds of MB) does not need its size twice in memory: a browser can make a Blob from the chunks.
 */
export class ZipParts {
  private parts: Uint8Array[] = [];
  private zip = new Zip((err, chunk) => {
    if (err) throw err;
    this.parts.push(chunk);
  });

  add(path: string, data: Uint8Array) {
    const file = new ZipPassThrough(path);
    this.zip.add(file);
    file.push(data, true);
  }

  finish(): Uint8Array[] {
    this.zip.end();
    return this.parts;
  }
}

/** One array from chunks (for platforms that need a single buffer). */
export function joinParts(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
