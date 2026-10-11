import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { C, font, mono } from '../constants/theme';
import { SpliceAuthError, connectSplice, disconnectSplice, downloadFromSplice, searchPackNamed, searchSplice, spliceAvailable, spliceConnected } from '../lib/splice';
import { placeSample } from '../lib/actions';
import { DEFAULT_SYNTH, mapTrack, trackKind } from '../lib/project';
import { queryFromSpliceLink, spliceSampleId, type SpliceResult } from '../lib/spliceResults';
import { applyInstrument } from '../audio/presets';
import { SAMPLER_PRESET } from '../audio/synth';
import { errorText, toast, updateProject, useStore } from '../lib/store';
import type { Sample, Track } from '../types';
import { confirmDestructive } from './confirm';
import { Btn, Chip, Txt } from './kit';

type Kind = 'loop' | 'oneshot' | undefined;

/**
 * Search Splice's catalog and load sounds into the library. Needs a one-time login to Splice (the connection goes
 * through LOOPVX's server; the Splice login stays on this device). The first download of a sound costs one Splice
 * credit, so every download asks first.
 */
export function SpliceSearch({ track }: { track?: Track } = {}) {
  const midi = !!track && trackKind(track) === 'midi';
  const bpm = useStore((st) => st.project.bpm);
  const samples = useStore((st) => st.samples);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>(midi ? 'oneshot' : 'loop');
  const [tempoMatch, setTempoMatch] = useState(true);
  const [results, setResults] = useState<SpliceResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void spliceConnected().then(setConnected);
  }, []);

  if (!spliceAvailable()) return <Txt style={s.note}>Die Splice-Anbindung gibt es bisher in der Web-Version (loopvx-native.vercel.app).</Txt>;
  if (connected === null) return null;

  const fail = (e: unknown) => {
    setError(errorText(e));
    if (e instanceof SpliceAuthError) setConnected(false);
  };

  if (!connected) {
    return (
      <View style={{ gap: 10 }}>
        <Txt style={s.note}>Suche in Splice und lade Sounds direkt in deine Library. Dafür meldest du dich einmal bei Splice an und erlaubst den Zugriff.</Txt>
        {error && <Txt style={[s.note, { color: C.danger }]}>{error}</Txt>}
        <View style={s.row}>
          <Btn kind="primary" small accessibilityLabel="Mit Splice verbinden" onPress={() => void connectSplice().catch(fail)}>
            Mit Splice verbinden
          </Btn>
        </View>
      </View>
    );
  }

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const link = queryFromSpliceLink(q);
      const filters = { type: link ? undefined : kind, ...(tempoMatch && kind !== 'oneshot' && !link ? { bpmMin: Math.round(bpm) - 3, bpmMax: Math.round(bpm) + 3 } : {}) };
      if (link) setQuery(link.query);
      // A pack link asks for a cross-section of that pack; a sound link finds the sound by its name.
      setResults(link?.kind === 'pack' ? await searchPackNamed(link.query, filters) : await searchSplice({ query: link?.query ?? q, ...filters }));
    } catch (e) {
      fail(e);
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  /** Into the library; with a track (the Splice slot of a track): onto that track too. */
  const load = async (r: SpliceResult) => {
    let sample: Sample | undefined = samples.find((x) => x.id === spliceSampleId(r.uuid));
    if (!sample) {
      const ok = await confirmDestructive(`„${r.name.replace(/\.[a-z0-9]+$/i, '')}“ von Splice laden?`, 'Der erste Download eines Sounds kostet einen Splice-Credit, danach ist er kostenlos.', 'Laden');
      if (!ok) return;
    }
    setBusy(r.uuid);
    try {
      sample ??= await downloadFromSplice(r);
      if (!track) toast('Von Splice geladen: in der Library');
      else if (midi) {
        const loaded = sample;
        updateProject((p) => mapTrack(p, track.id, (t) => applyInstrument(t, { ...DEFAULT_SYNTH, ...SAMPLER_PRESET, sampleId: loaded.id })));
        toast(`${sample.name} ist jetzt der Sampler von „${track.name}“. Noten setzt du in der Piano Roll.`);
      } else await placeSample(sample, { trackId: track.id });
    } catch (e) {
      fail(e);
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <TextInput
        style={s.search}
        placeholder="z. B. dark rumble kick, oder einen Splice-Link einfügen …"
        placeholderTextColor={C.dim}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => void search()}
        returnKeyType="search"
      />
      <View style={s.row}>
        <Chip variant={kind === 'loop' ? 'on' : 'ghost'} onPress={() => setKind('loop')} textStyle={{ fontSize: 12 }}>
          Loops
        </Chip>
        <Chip variant={kind === 'oneshot' ? 'on' : 'ghost'} onPress={() => setKind('oneshot')} textStyle={{ fontSize: 12 }}>
          One-Shots
        </Chip>
        <Chip variant={kind === undefined ? 'on' : 'ghost'} onPress={() => setKind(undefined)} textStyle={{ fontSize: 12 }}>
          Beides
        </Chip>
        <Chip variant={tempoMatch && kind !== 'oneshot' ? 'on' : 'ghost'} onPress={() => setTempoMatch(!tempoMatch)} textStyle={{ fontSize: 12 }}>
          {`${Math.round(bpm)} BPM ±3`}
        </Chip>
      </View>
      <View style={s.row}>
        <Btn kind="primary" small disabled={loading || !query.trim()} accessibilityLabel="Bei Splice suchen" onPress={() => void search()}>
          {loading ? 'Suche …' : 'Suchen'}
        </Btn>
        <Btn small onPress={() => void disconnectSplice().then(() => setConnected(false))}>
          Splice trennen
        </Btn>
      </View>
      {error && <Txt style={[s.note, { color: C.danger }]}>{error}</Txt>}
      {results && results.length === 0 && <Txt style={s.note}>Nichts gefunden. Versuche andere Wörter (englisch klappt am besten) oder schalte den BPM-Filter aus.</Txt>}
      {results?.map((r) => {
        const have = samples.some((x) => x.id === spliceSampleId(r.uuid));
        return (
          <View key={r.uuid} style={s.item}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt numberOfLines={1} style={s.name}>
                {r.name.replace(/\.[a-z0-9]+$/i, '')}
              </Txt>
              <Txt numberOfLines={1} style={s.meta}>
                {[r.bpm ? `${r.bpm} BPM` : r.type === 'oneshot' ? 'One-Shot' : '', r.key ? r.key.toUpperCase() : '', r.duration ? `${r.duration.toFixed(1).replace('.', ',')} s` : '', r.pack].filter(Boolean).join(' · ')}
              </Txt>
              {r.tags.length > 0 && (
                <Txt numberOfLines={1} style={s.tags}>
                  {r.tags.join(' · ')}
                </Txt>
              )}
            </View>
            <Btn small disabled={(have && !track) || busy !== null} accessibilityLabel={`${r.name} laden`} onPress={() => void load(r)}>
              {busy === r.uuid ? 'Lädt …' : track ? (midi ? 'Als Sampler' : 'Auf Spur') : have ? 'In Library' : 'Laden'}
            </Btn>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  note: { color: C.muted, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  search: { height: 38, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, paddingHorizontal: 12, color: C.text, ...font(400), fontSize: 14, outlineWidth: 0 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.lineSoft },
  name: { fontSize: 13 },
  meta: { ...mono(), fontSize: 11, color: C.muted, marginTop: 1 },
  tags: { fontSize: 10.5, color: C.dim, marginTop: 1 },
});
