import { niceKey, parseSearchResults, sampleFromSplice, spliceSampleId } from './spliceResults';

const ANSWER = `## Search results for: "hard techno rumble kick bass loop"
Showing 10 of 9958 total results

### 1. DS_HT_150_drum_kick_bomber_rumble_C#.wav
BPM: 150 | Key: c# | Duration: 3.2s | Type: loop
**Pack:** Dropgun Samples
**Tags:** drums, kicks, techno, edm, hard techno, rumble
**Link:** https://splice.com/sounds/sample/a81f/ds-ht-150-drum-kick-bomber-rumble-c-wav
**Asset UUID:** 09d1a590-fdc9-4d0e-9dc6-64bc8d7c3177

### 2. DS_HT_153_drum_kick_ketamine_rumble_E.wav
BPM: 153 | Key: e | Duration: 3.1s | Type: loop
**Pack:** Dropgun Samples
**Tags:** drums, kicks, techno
**Link:** https://splice.com/sounds/sample/bc83/x
**Asset UUID:** 003ee36f-2336-4bde-ac28-68d2b1dead2f

### 3. Snare One Shot.wav
Duration: 0.4s | Type: one-shot
**Pack:** Some Pack
**Tags:** snare
**Asset UUID:** e856b158-69fc-42d6-9442-8279bcf6d8fc

### 4. Broken entry without id
BPM: 140
`;

describe('parseSearchResults', () => {
  it('reads the facts of every sound', () => {
    const r = parseSearchResults(ANSWER);
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({
      uuid: '09d1a590-fdc9-4d0e-9dc6-64bc8d7c3177',
      name: 'DS_HT_150_drum_kick_bomber_rumble_C#.wav',
      type: 'loop',
      bpm: 150,
      key: 'c#',
      duration: 3.2,
      pack: 'Dropgun Samples',
      tags: ['drums', 'kicks', 'techno', 'edm', 'hard techno', 'rumble'],
      link: 'https://splice.com/sounds/sample/a81f/ds-ht-150-drum-kick-bomber-rumble-c-wav',
    });
    expect(r[1].bpm).toBe(153);
  });

  it('copes with one-shots without tempo or key, and drops entries without an asset id', () => {
    const r = parseSearchResults(ANSWER);
    expect(r[2]).toMatchObject({ name: 'Snare One Shot.wav', type: 'oneshot', bpm: undefined, key: undefined, duration: 0.4 });
    expect(r.some((x) => x.name.startsWith('Broken'))).toBe(false);
  });

  it('returns nothing for text without results', () => {
    expect(parseSearchResults('No results found.')).toEqual([]);
    expect(parseSearchResults('')).toEqual([]);
  });
});

describe('sampleFromSplice', () => {
  it('builds a library entry with Splice tempo, key, pack folder and a category from the name', () => {
    const [kick] = parseSearchResults(ANSWER);
    const s = sampleFromSplice(kick, 'wav', 1000);
    expect(s).toMatchObject({ id: spliceSampleId(kick.uuid), spliceId: kick.uuid, name: 'DS_HT_150_drum_kick_bomber_rumble_C#.wav', bpm: 150, key: 'C#', folder: 'Splice/Dropgun Samples', category: 'kick', duration: 3.2, addedAt: 1000 });
  });

  it('keeps one-shots tempo-less', () => {
    const s = sampleFromSplice(parseSearchResults(ANSWER)[2], 'wav');
    expect(s.bpm).toBeUndefined();
    expect(s.name).toBe('Snare One Shot.wav');
  });

  it('writes keys the way the app does', () => {
    expect(niceKey('c#')).toBe('C#');
    expect(niceKey('f minor')).toBe('F minor');
    expect(niceKey('Ab maj')).toBe('Ab major');
    expect(niceKey('???')).toBeUndefined();
  });
});

import { PACK_FACETS, mergeResults, queryFromSpliceLink, type SpliceResult } from './spliceResults';

describe('pasted Splice links', () => {
  it('turns a sound link into the words of its name', () => {
    expect(queryFromSpliceLink('https://splice.com/sounds/sample/a81f61d6/ds-ht-150-drum-kick-bomber-rumble-c-wav')).toEqual({ kind: 'sound', query: 'ds ht 150 drum kick bomber rumble c' });
    expect(queryFromSpliceLink('  https://www.splice.com/sounds/sample/abc/snare-08-wav?x=1  ')).toEqual({ kind: 'sound', query: 'snare 08' });
  });

  it('turns a pack link into the pack name (label and pack)', () => {
    expect(queryFromSpliceLink('https://splice.com/sounds/packs/dropgun-samples/hard-techno')).toEqual({ kind: 'pack', query: 'dropgun samples hard techno' });
    expect(queryFromSpliceLink('https://splice.com/sounds/packs/some-pack')).toEqual({ kind: 'pack', query: 'some pack' });
  });

  it('leaves normal search text and foreign links alone', () => {
    expect(queryFromSpliceLink('dark rumble kick')).toBeNull();
    expect(queryFromSpliceLink('https://example.com/sounds/sample/a/b-wav')).toBeNull();
    expect(queryFromSpliceLink('https://splice.com/pricing')).toBeNull();
  });
});

describe('mergeResults', () => {
  const r = (uuid: string): SpliceResult => ({ uuid, name: uuid, tags: [] });
  it('keeps the first occurrence and the order, and caps the list', () => {
    expect(mergeResults([[r('a'), r('b')], [r('b'), r('c')]]).map((x) => x.uuid)).toEqual(['a', 'b', 'c']);
    expect(mergeResults([[r('a'), r('b'), r('c')]], 2)).toHaveLength(2);
    expect(PACK_FACETS.length).toBeGreaterThan(3);
  });
});
