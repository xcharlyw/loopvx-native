import { gunzipSync, strFromU8 } from 'fflate';
import { audioRegions, buildLiveSet, buildLiveSetXml, keyTracksXml, midiRegions, type AlsInput } from './liveSet';

const input = (): AlsInput => ({
  bpm: 150,
  markers: [{ bar: 16, name: 'Drop & "Break"' }],
  tracks: [
    { name: 'Kick + Bass <1>', color: 12, volume: 0.8, pan: -0.25, sends: [0.3, 0], audio: { relPath: 'Samples/Imported/01 Kick.wav', bytes: 1000, frames: 441000, sampleRate: 44100, modDate: 1790000000, totalBars: 16, clips: [{ start: 0, length: 4 }, { start: 8, length: 8 }] } },
    { name: 'Lead', color: 20, volume: 1, pan: 0, sends: [0, 0], midi: { clips: [{ start: 4, length: 2, notes: [{ pitch: 60, start: 0, length: 0.25, velocity: 1 }, { pitch: 64, start: 0.5, length: 0.25, velocity: 0.5 }, { pitch: 60, start: 1, length: 0.25, velocity: 0.8 }] }] } },
  ],
});

describe('live set', () => {
  it('shows the stretch of the file that lies under each clip, without overlap', () => {
    expect(audioRegions([{ start: 8, length: 4 }, { start: 0, length: 10 }])).toEqual([{ start: 0, length: 8 }, { start: 8, length: 4 }]);
    expect(audioRegions([{ start: 0, length: 0 }])).toEqual([]);
    expect(midiRegions([{ start: 0, length: 4, notes: [{ pitch: 60, start: 3, length: 1, velocity: 1 }, { pitch: 62, start: 0, length: 4, velocity: 1 }] }, { start: 2, length: 2, notes: [] }])).toEqual([
      { start: 0, length: 2, notes: [{ pitch: 62, start: 0, length: 2, velocity: 1 }] },
      { start: 2, length: 2, notes: [] },
    ]);
  });

  it('writes notes per pitch in beats', () => {
    const xml = keyTracksXml([{ pitch: 64, start: 0.5, length: 0.25, velocity: 0.5 }, { pitch: 60, start: 1, length: 0.25, velocity: 1 }, { pitch: 60, start: 0, length: 0.5, velocity: 1 }]);
    expect(xml).toContain('<MidiKey Value="60" />');
    expect(xml.indexOf('<MidiKey Value="60" />')).toBeLessThan(xml.indexOf('<MidiKey Value="64" />'));
    expect(xml).toContain('Time="2" Duration="1" Velocity="64"');
    expect(xml).toContain('Time="0" Duration="2" Velocity="127"');
  });

  it('fills the templates: tempo, tracks, clips in beats, locators, escaped names', () => {
    const xml = buildLiveSetXml(input());
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).not.toMatch(/\{\{\w+\}\}|@@/);
    expect(xml).toContain('<Manual Value="150" />');
    expect(xml).toContain('Kick + Bass &lt;1&gt;');
    expect(xml).toContain('<Name Value="Drop &amp; &quot;Break&quot;" />');
    expect(xml).toContain('<Time Value="64" />'); // locator at bar 17
    expect(xml).toContain('<CurrentStart Value="32" />'); // second audio clip at bar 9
    expect(xml).toContain('<CurrentEnd Value="64" />');
    expect(xml).toContain('Samples/Imported/01 Kick.wav');
    expect(xml).toContain('<CurrentStart Value="16" />'); // MIDI clip at bar 5
    expect((xml.match(/<AudioTrack /g) ?? []).length).toBe(1);
    expect((xml.match(/<MidiTrack /g) ?? []).length).toBe(1);
    expect((xml.match(/<ReturnTrack /g) ?? []).length).toBe(2);
  });

  it('gives every target a unique id below NextPointeeId', () => {
    const xml = buildLiveSetXml(input());
    const next = Number(/<NextPointeeId Value="(\d+)"/.exec(xml)![1]);
    const ids = [...xml.matchAll(/<(?:\w*AutomationTarget|\w*ModulationTarget|Pointee) Id="(\d+)"/g)].map((m) => Number(m[1]));
    expect(ids.length).toBeGreaterThan(80);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.max(...ids)).toBeLessThan(next);
    const trackIds = [...xml.matchAll(/<(?:AudioTrack|MidiTrack) Id="(\d+)"/g)].map((m) => Number(m[1]));
    expect(trackIds.every((id) => id < next && !ids.includes(id))).toBe(true);
  });

  it('switches a track off in Live when it is muted', () => {
    const on = (xml: string) => [...xml.matchAll(/<Mixer><LomId Value="0" \/><LomIdView Value="0" \/><IsExpanded Value="true" \/><BreakoutIsExpanded Value="false" \/><On><LomId Value="0" \/><Manual Value="(true|false)"/g)].map((m) => m[1]).slice(0, 2); // the two tracks; the returned tracks come after them
    const a = input();
    expect(on(buildLiveSetXml(a))).toEqual(['true', 'true']);
    a.tracks[0].muted = true;
    expect(on(buildLiveSetXml(a))).toEqual(['false', 'true']);
  });

  it('is gzipped XML', () => {
    const bytes = buildLiveSet(input());
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
    const xml = strFromU8(gunzipSync(bytes));
    expect(xml).toContain('<Ableton MajorVersion="5"');
    const dump = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DUMP_ALS;
    if (dump) (jest.requireActual('fs') as { writeFileSync: (p: string, d: string) => void }).writeFileSync(dump, xml);
  });
});
