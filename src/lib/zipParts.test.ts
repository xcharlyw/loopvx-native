import { strFromU8, strToU8, unzipSync } from 'fflate';
import { ZipParts, joinParts } from './zipParts';

describe('zip parts', () => {
  it('writes a ZIP that unzips to the same files', () => {
    const z = new ZipParts();
    z.add('A Project/one.txt', strToU8('hello'));
    z.add('A Project/Samples/two.bin', new Uint8Array([1, 2, 3, 4]));
    z.add('empty.txt', new Uint8Array(0));
    const parts = z.finish();
    expect(parts.length).toBeGreaterThan(1);
    const files = unzipSync(joinParts(parts));
    expect(Object.keys(files).sort()).toEqual(['A Project/Samples/two.bin', 'A Project/one.txt', 'empty.txt']);
    expect(strFromU8(files['A Project/one.txt'])).toBe('hello');
    expect([...files['A Project/Samples/two.bin']]).toEqual([1, 2, 3, 4]);
  });
});
