# LOOPVX native – notes for Claude

Owner: Karl (hard techno DJ "Carl Haze", Austria). He talks German; **all UI copy is German**.
Code, comments and commits in English. He tests on an iPhone (Chrome/Safari, i.e. WebKit) and a PC.

This is the Expo / React Native rebuild (web + iOS + Android) of the original PWA in
`xcharlyw/loopvx` (Vite + React). The original stays live at loopvx.vercel.app and is the
**design reference**: the UI was ported 1:1 (tokens in `src/constants/theme.ts`, copied from its
`src/styles.css`). Keep new UI in that style. Live web build: https://loopvx-native.vercel.app
(Vercel project `loopvx-native`, deploys `main` on push). Also read `AGENTS.md` (Expo rules).

## Product

Minimal mobile producing studio, "Ableton, but small". Default tracks: Kick + Bass/Rumble, Top Loop,
Synth/Lead, Vocals. Hard techno tempos 145–165 BPM. Positions and lengths are in **bars** (4/4).
Loops warp by playbackRate = projectBpm / sampleBpm: re-pitch by default, or per sample
`warp: 'stretch'` (time-stretch, pitch kept) through react-native-audio-api's `pitchCorrection`.
On web that stretcher is a worklet loaded from `/react-native-audio-api/signalsmithStretch.mjs`,
copied into `public/` by `scripts/copy-web-assets.js` on `npm install` (not committed). Offline
export waits for each stretcher (`voiceReady`); never `suspend()` an OfflineAudioContext with
stretchers in it: Chromium crashes.

## Verify before every push

```bash
npx tsc --noEmit
npx jest                                     # app tests (src/**/*.test.ts) + server tests (tests/)
npx expo export --platform web --output-dir <scratch>/dist-web   # the real build gate
npx expo export --platform ios --output-dir <scratch>/dist-ios   # when touching native-only code
```

`expo install` and `expo lint` can't reach api.expo.dev from the sandbox: pick SDK-compatible
versions from `node_modules/expo/bundledNativeModules.json` and `npm install` them.

Browser checks: Playwright from `/opt/node-tools/node_modules/playwright` with
`executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`, iPhone via
`devices['iPhone 13']`, dev server `CI=1 npx expo start --web --port 8081 --clear`.
- **Metro serves stale bundles** after edits: restart it with `--clear` before trusting a result.
- `pkill -f "expo start"` also matches (and kills) the shell running it: run it as its own command.
- Finger input on react-native-web differs from mouse: test touch paths with `page.touchscreen`
  or CDP `Input.dispatchTouchEvent`, not only `mouse`.

## Layout

```
src/app/            expo-router entry (one screen; the app is src/ui/App.tsx)
src/ui/             screens and panels (ArrangeView, SessionView, *Panel sheets, BottomBar, TopBar)
src/audio/          engine.ts (react-native-audio-api), mixgraph.ts (track strips: filter, drive, pan,
                    fader, reverb/delay sends; one per context, live and offline), fx.ts + synth.ts
                    (pure effect/instrument math; synth.ts `planVoice` is the recipe of one synth note),
                    presets.ts (sound library + applyPreset), tempo.ts (BPM detection),
                    devices.ts + devicemath.ts + devicenodes.ts + devicebay.ts (device chain, see below),
                    timing.ts (pure tempo math), wav.ts, pageAudio.ts
src/lib/            store.ts (state, undo, autosave), project.ts (pure project mutations), actions.ts,
                    midi.ts (.mid read/write), patterns.ts (seeded pattern generator, drums and bass),
                    melody.ts (scales, chord progressions, trance/reese/hypnotic/pad/stab generators),
                    samples(.web).ts, sync*.ts + drive.ts (Google Drive sync), supabase.ts, vocals.ts
src/storage/db.ts   AsyncStorage persistence; emits change events (Drive sync listens)
api/                Vercel Functions (vocals.ts, drive-token.ts); api/_lib is shared, not deployed
tests/              server tests (anything in api/ is deployed as a function)
```

## Rules

- **Project state is immutable; change it only through `updateProject()`** (`src/lib/store.ts`).
  It records undo (`History`, bursts of `reschedule: false` edits merge into one step), autosaves,
  and reschedules audio. Pure logic (tempo math, project edits, sync planning) goes in testable
  modules with a `*.test.ts` next to them.
- **Platform splits** live in file pairs (`samples.ts` / `samples.web.ts`, `url-polyfill*`).
  Web stores audio in IndexedDB, native in the document directory. Web `decodeAudioData` needs an
  ArrayBuffer, native takes a file URI. Guard window/document access with `Platform.OS === 'web'`
  (Expo pre-renders the web build in Node: no `window` at import time, so the Supabase client is lazy).
- **iOS web audio**: the AudioContext may only start inside a tap, and the silent switch mutes Web
  Audio unless the page plays media (`pageAudio.ts`). `engine.unlock()` handles both and rebuilds a
  context iOS left stuck after an interruption. Decoding uses a suspended context; never resume
  outside a gesture.
- **Secrets stay server-side** (Vercel env): `ELEVENLABS_API_KEY`, `GOOGLE_CLIENT_SECRET`. Never put
  a secret in `src/config.ts` or an `EXPO_PUBLIC_` variable. Public: Supabase URL + publishable key.
  Server functions authorize via the caller's Supabase token + `ALLOWED_EMAILS` (`api/_lib/auth.ts`).
- **Auth / Drive**: Supabase "Loopvx" project (`imjsaqqbfpyegkkqcgzf`, Google provider). Google
  sign-in also requests `drive.file` with offline access; the Google refresh token is kept on the
  device and traded for access tokens by `api/drive-token.ts` (needs `GOOGLE_CLIENT_ID/SECRET` of the
  same OAuth client). Sync mirrors projects (JSON) and samples (audio) into a "LOOPVX" Drive folder;
  `syncPlan.ts` is the merge (newest wins, deletions via synced/deleted memory). Never hard-delete on
  Drive (trash only). Sign-in asks for `drive.file` (the LOOPVX sync folder) **and** `drive.readonly` (`DRIVE_SCOPE` in
  `config.ts`); `api/drive-token.ts` returns the granted `scope`, `driveCanRead()` gates the **Drive import** (Library →
  `DriveImport`: browse folders, tick files or import a folder recursively; pure logic in `driveImport.ts`, run in
  `driveImportRun.ts`; samples get id `drive:<fileId>`, dedupe by `driveId`, the file name and the folder path give category/BPM/key, but the library folder is a **single name, the pack** (`libraryFolderOf`: the last Drive folder that is not a structure name like `loops`/`drum_loops`/`music_loops`, since packs look like `Pack / loops / drum_loops`; no tree). "Nach Pack ordnen" in the Library (`refolderDriveSamples`, reads parents from Drive) fixes samples imported with the older rule; the
  copies are then synced into LOOPVX/Samples like any sample, **by a copy inside Drive** (`copyFile`, no upload from the phone; an upload if Drive refuses). A folder import first scans (`collectAudio` with `onFile`/`cancelled` hooks, up to 3000 files), shows a plan card (`summarizeImport`: new vs. existing, size, library folders) and only then downloads; both phases have "Abbrechen", importing again continues where it stopped because known Drive ids are skipped). The browser also lists "Computer" (Drive for desktop backups such as "My Mac": Drive's API has no listing for them, so they are found as folders owned by the user **without a parent**, `computerFolders`/`browseChildren`; checked against the real metadata of Karl's Drive: "My Mac" is a folder he owns with no parent; the full listing of owned folders can be slow on a big Drive) and "Mit mir geteilt". Never write outside the LOOPVX folder. The SoulVX Supabase project and its Google client are unrelated: don't touch.
- Commit trailers per the session's attribution reminder; no model names in pushed artifacts.

## Library folders

`Sample.folder` is a path ("Loops/Kicks"), set by the Drive import (the pack name), Splice (the pack name) and the user. Folders that hold samples exist by themselves;
empty ones the user made live in `state.folders` (kv `folders`). Pure logic in `lib/folders.ts` (tree, counts, rename/merge,
dissolve = contents move up, move samples; tested), bulk writes through `db.putSamples`/`upsertSamples` (one storage write,
`updatedAt` touched so Drive sync carries the new `folder`). UI `LibraryFolders.tsx` + `LibraryPanel`: without search/filter
the Library is browsed folder by folder (breadcrumb, "+ Neuer Ordner", folder rows with ⋯ = rename / **verschieben** (a whole folder into another folder or back to the top level, `moveFolder`: never into itself or its own sub-folders, same names merge) / auflösen), "Auswählen"
ticks samples, "Löschen" removes the ticked ones (`removeSamples`) and "Verschieben …" opens the folder picker (also "In Ordner" in a sample's editor); with a search or filter all
folders are searched at once. Folders are meant to be flat (last sub-folder only): "Pfade kürzen" (`flattenFolders`, shown while any folder is nested) flattens an old tree. Empty folders are local (not synced to Drive). "Löschen" in the ⋯ menu deletes a folder with all sub-folders and samples (`samplesUnder` + `withoutFolder`, `removeSamples` in the store → `db.deleteSamples`; confirmed first; Drive copies are trashed by the sync, clips using them go silent; "Auflösen" is the keep-the-samples alternative). All sync memory changes go through `updateMemory` in `sync.ts` (one at a time: bulk deletes fire in parallel). A deletion the user makes **while a sync runs** is remembered too (and that sync skips downloading it: `deletedMidSync`); the sync's own local deletions are marked with `ownDeletes` so they are not mistaken for the user's. Without that, deleted samples stayed in Drive or came back.

## Splice

Library → "Splice": search the Splice catalog (loops/one-shots, tempo filter = project BPM ±3) and load sounds into the library.
Splice offers a remote MCP server (`https://mcp.splice.com/mcp`, Streamable HTTP, OAuth 2.1 + PKCE, dynamic client
registration). The browser can't call it (CORS), so `api/splice.ts` (+ `api/_lib/splice.ts`) is a small MCP client: actions
`start` (discovery, client registration, authorization URL), `token`/`refresh`, `search` (`describe_a_sound`), `download`
(`download_asset`, returns the presigned link) and `fetch` (file bytes through the server when CORS blocks the storage
host; hosts limited to splice.com/amazonaws.com/cloudfront.net). Only those two tools are allowed (nothing that
creates stacks). The caller must be a signed-in LOOPVX user on `ALLOWED_EMAILS` like the other functions. The user's
Splice tokens live on their device (`loopvx:splice`), the server stores nothing; no secret is involved (public OAuth
client). Client: `src/lib/splice.ts` (PKCE, login redirect to `/splice-callback`, search, download), route
`src/app/splice-callback.tsx` (clears `?code=` from the URL first so the Supabase client does not take it; `cleanUrls`
in `vercel.json` serves `/splice-callback`), `spliceResults.ts` (parses Splice's Markdown answer; tested with a real one),
UI `SpliceSearch.tsx`. A pasted Splice link works in the search box (`queryFromSpliceLink`): a sound link finds that sound by its name, a pack link asks for a cross-section of the pack (`searchPackNamed`: the name plus kick/snare/bass ... facets, merged; **not the complete pack**: the search tool answers 10 sounds per question, has no paging, and its "Pack" field is really the label). There is no tool for likes or purchases in the Splice MCP. The **first download of a sound costs the user a Splice credit**: always ask first (done in the UI).
The same search also lives in the device chain as the **Splice slot** (`DeviceType 'splice'`, group "Sounds", no parameters, the signal passes through): `SpliceSearch` gets the track and the button becomes "Auf Spur" (audio track: `placeSample` at the playhead) or "Als Sampler" (MIDI track: sample instrument via `applyInstrument` + `SAMPLER_PRESET`); sounds already in the library skip the download and the credit prompt. Web only for now. **Never verified against the real Splice server** (the sandbox could not reach mcp.splice.com; tests
use a mock): if the login fails, look at the registration step (Splice may restrict redirect URIs) and at the text
`download_asset` answers with (`extractDownloadUrl`).

## Tempo detection

`src/audio/tempo.ts` (pure): onset curve, autocorrelation comb, candidates from whole-bar lengths plus
autocorrelation peaks, a prior around 150 BPM for octave ties, and a crest-factor gate so drones and
speech give "no tempo". Used by the "Tempo erkennen" button (ClipPanel) and `autoDetectTempos` on upload
(loops only, never vocals, only confident results). Checked on a real 160 BPM loop and its variants
(mp3, trimmed, offset, +-10 % speed): all within 0.4 %.

## Synth, presets and melodies

An oscillator instrument (`track.synth`, wave sawtooth/square/sine/triangle) is planned by the pure
`planVoice` (unison copies of oscillator A and B, sub, noise, filter with envelope, tempo-synced LFO) and
built by `startOscVoice` in the engine as one `SynthVoice` that stops all its nodes together. All new
`SynthSettings` fields are optional so old projects sound as before. `presets.ts` is the sound library
(Bass, Lead, Pad, Pluck & Stab, Drums): `applyPreset`/`applyInstrument` replace the whole instrument and the
track's drive/reverb/delay/pump, never the DJ filter or pan. UI: `InstrumentPanel` (opened from the track
sheet). `melody.ts` generators are scale-aware and tested for musical properties (in key, register, phrase
endings, second phrase answers the first); `SUGGESTED_PRESET` maps a generator style to a sound.
All melodic styles (arp, reese, trance, prog-arp, pad, rave) take `progression` (index into the scale's chord
progressions): the piano roll's "Akkordfolge" chips keep it across generations, so bass and arp built on the same
progression play the same chord in every bar (tested). Key (`project.key`, the TopBar), scale (`project.scale`, default the
key's mode) and progression (`project.progression`) belong to the **project** (`projectHarmony`), not to a clip: every
generator on every track plays in them. The reese bass only plays root, fifth and octave of the bar's own chord and the
arp only its triad, so they cannot clash (tested). Without a progression index a generator picks one at random.
WaveShapers that distort (track drive, master limiter, saturator, limiter device) use `oversample` to avoid aliasing
hash; the track drive only while it is turned up (CPU).

## Sound panel (Serum-style)

`InstrumentPanel` is built like a plugin: preset switcher (◀ ▶ through `PRESETS`), "Instrument laden" tiles
(Synth / Sampler / Kick / Noise, `applyInstrument` replaces the instrument and the track's sound effects),
tabs per kind (`TABS`) with rotary `Knob`s (`src/ui/synth/`) and live scopes: wave shape, the **real filter
response** (`filterResponse` in `audio/scopes.ts` equals Chromium's `getFrequencyResponse` to 0.000 dB; note
that lowpass/highpass resonance is in **dB** in Web Audio, bandpass Q is linear), amp envelope, LFO (cycles per
bar over a window of whole bars), sample peaks. Knob math is pure (`lib/knobMath.ts`): vertical drag,
log curves, steps, double tap resets. The keyboard (`Keys`) uses the responder grant, not `Pressable.onPressIn`,
which waits and swallows quick taps on web. Sampler settings: `sampleRoot`, `tune` (cents), `gainDb`.

## Track types

`Track.kind` is `'audio' | 'midi'` (optional: old projects derive it via `trackKind()`: a synth or clips with
notes means MIDI). Audio tracks take samples (Drive, uploads, AI vocals) and never get MIDI clips; MIDI tracks
take only MIDI clips and carry the instrument (`canHoldClip` guards cross-track clip drags, `trackForSample`
only picks audio tracks, `createMidiClipOnTrack` refuses audio tracks, Session slots of MIDI tracks are
disabled). The type can only be changed on an empty track (`setTrackKind`, TrackPanel "Spurtyp"). The arrange
header marks MIDI tracks with a square colour dot (audio: round) and has an FX button (opens the device chain, shows the
device count); the add row has "+ Audio" and "+ MIDI".

## Device chain (plugin slots)

`Track.devices` is the chain after the instrument/clips and before the DJ filter, drive, pan and fader:
`input -> devices -> hp -> lp -> drive -> pan -> pump -> fader`. Types: EQ, Compressor, Saturator, Echo, Reverb,
Chorus, Filter (with LFO), Limiter, Utility. `devices.ts` is the registry (`DEVICE_DEFS`: key, range, default,
unit, how a knob shows it; `deviceParams` clamps/snaps and fills defaults, so projects stay safe), `devicemath.ts`
the pure maths (biquad responses incl. peaking/shelves = Chromium's `getFrequencyResponse` to 0.000 dB, compressor
gain computer, saturator curves, echo times), `devicenodes.ts` the Web Audio graph of each device, `devicebay.ts`
the per-track chain (`DeviceBay`: reuses nodes of unchanged devices by id so reverb tails survive adding another
device; each slot has an on/bypass crossfade). The chain is changed through `addDevice`/`removeDevice`/
`moveDevice`/`updateDevice` in `project.ts` with `updateProject(..., { reschedule: false })`; `syncMixer` applies
it to the running graph. Live and offline render use the same `MixGraph`, so exports contain the effects.
UI: `DevicePanel` (opened from TrackPanel "Geräte"): source slot (instrument for MIDI tracks, opens the Sound panel),
a card per device with live scope (`synth/DeviceScopes.tsx`) and knobs, `+ Gerät hinzufügen` browser. Each card has a preset switcher (◀ name ▶ and a list; factory presets in
`devicepresets.ts`, a preset lists only what differs from the defaults and replaces every parameter, `presetOf` recognises
the current one). Cards fold (tap the
title, "Alle einklappen"): a folded card shows `deviceSummary` in one line. The folded set is React state (a new Set per change)
with a module copy so the panel reopens as left; never mutate a module-level Set, the React compiler would not rerender.
Constraints learned the hard way:
- react-native-audio-api has **no DynamicsCompressor and no channel splitter/merger**, and `channelCount` is read-only:
  there is no true mono/width. The **compressor** is built from nodes: rectifier (WaveShaper |x|), a peak-hold loop
  through a DelayNode (128 samples, decay per pass = release), attack lowpass, WaveShaper gain curve driving a GainNode's
  `gain` param. Measured offline: gain reduction within 0.5 dB of the textbook computer, attack/release times near the
  knob values, no distortion on 55 Hz bass. A slow 1 Hz biquad as release follower does NOT work (32-bit coefficients).
- A WaveShaper's `curve` can be set **only once** in Chromium: a changed curve means a new node (`Kit.swappableShaper`).
- Filters parked "off" must be neutral: a lowpass above Nyquist is flat (`LP_OFF`), a highpass at 5 Hz.
- Not verified on a phone natively: feedback loops through DelayNodes (echo, compressor detector, chorus feedback) and
  4x oversampling on shapers are standard Web Audio; if a native build misbehaves, look there first.

## Piano roll dragging

A selected note gets a move area and a length grip (`noteHitAreas`, `src/lib/noteDrag.ts`): the move area is
the note, the grip sits behind its end (inside for long notes and notes at the clip end) so even a single
16th (24 px) can be grabbed in its middle. Drags use the shared `useDrag` (`src/ui/drag.ts`, `touchAction:
none`); the grid's ScrollView is disabled only while a drag runs, so swiping empty cells still scrolls.
Every move is computed from the notes at gesture start (no accumulated error), and the whole drag is one undo
step: `recordHistory()` once, then `updateProject(..., { record: false })`; a drag that ends where it began
discards its step (`discardLastHistory`). Auto-scroll: while a drag runs, a 16 ms ticker scrolls the grid when
the finger is within `EDGE_ZONE` of the visible edge (`edgeScrollSpeed`, up to 900 px/s) and re-applies the
drag with the distance scrolled so far, so the note stays under the finger even when it holds still. The grid's
offset is tracked in a ref (`onScroll` is ignored mid-drag). react-native-web logs the dev-only warning
"ScrollView doesn't take rejection well" during drags; it is harmless (the responder refuses to hand over).

## Automation

`Track.automation` holds at most one curve (`AutomationLane`: `param` filter / drive / reverb / delay / pan / volume, `points` of `{bar, value}` in the parameter's own
range, linear between points, held before the first and after the last). Pure maths in `lib/automation.ts` (`laneValue`, `sampleLane`, `withPoint`, `setLane`, shapes
`ramp`/`throwAt`, tested). The engine drives it from `MixGraph.scheduleAutomation`, called from `schedulePump` (so with every window: live arrangement and offline render;
session mode passes `automation=false`): the curve is sampled every 1/16 bar, a `setValueAtTime` first and `linearRampToValueAtTime` after. While a lane drives a
parameter, `TrackChain.apply` leaves that parameter alone (`automated`), and `resetPump`/`resetAutomation` cancels the events and re-applies the track's own values.
The filter lane goes through `djFilter`, so it keeps the DJ filter's curve. Measured offline: volume fade linear, a filter close halves the zero-crossing rate every
couple of bars, a reverb lane stays dry until its point. UI `AutomationPanel` (TrackPanel "Automation"): parameter chips, a graph of 16/32/64/128 bars (no scrolling:
the buttons move the window), tap = new point, drag = move (one undo step), buttons nudge/delete, shapes for the visible window. Same curve component (`AutomationCurve`) is used in the arrange view: the "A" button of a track header opens a lane under the track (`LaneRow`, `LANE_H`, all bars at the arrangement's zoom; tap the lane header to cycle the parameter), like Ableton.
The `volume` lane is a multiplier of the track's fader (0..1), so the mixer fader keeps working under a fade.

## Arranger

`lib/arranger.ts` (pure, tested) lays out a whole track on the project: `sectionsFor(64|128)` = intro, build-up, drop, break, build-up 2, drop 2, outro; `roleOf(track)` reads
drums (kit909) / bass / lead / pad (MIDI, from the preset category or the name) and kickLoop / topLoop / synthLoop / vocal (audio, from the category); `SPANS` says in which
fraction of which section a role plays; MIDI roles get `generatePattern` clips (project key, scale and progression, so everything fits; the drums a snare roll in the last
bar of a build and a crash on each drop; no 909 kick when a kick loop carries it), audio roles the best library sample (`candidates`: category, ±8 BPM, `keysFit`, nearest
tempo first, one of the best three picked by the seed) looped over the whole span. `automationFor` adds filter openings, a reverb throw before each drop, drive build-ups on the
bass and a fade-out; bass/lead/pad get a pump when they have none. Missing roles are added as MIDI tracks (909 Drums, Rumble Bass, Lead, Pad with tuned faders). It **replaces** the
clips (undoable). Rule based with seeded randomness: not an LLM; an LLM could later choose the template/parameters (needs a server-side key). UI `ArrangerPanel` (FAB
"Arrangement" next to "AI Vocals"). Offline renders: the three added tracks come out at peaks 0.5 / 0.2 / 0.3 and the drop at 0.55 on the master.

## 909 drum machine (issue #4)

`wave: 'kit909'` is a whole drum kit as one instrument (`src/audio/drum909.ts`, pure): 12 pads on drum-rack/GM notes (kick C1 = 36, rim 37, snare 38,
clap 39, toms 41/45/48, closed hat 42, open hat 46, crash 49, ride 51, cowbell 56), each a recipe of parts (`osc` with a pitch drop, filtered `noise`, `metal` =
six squares through a highpass) with an exponential decay (`planHit`; `tune` in cents and `kitDecay` scale the whole kit). `startKitVoice` in `engine.ts` builds
it live and offline; a closed hat cuts the open hat before it (`scheduleNotes`, `chokes`). A note without a pad is silent, so a drum `.mid` plays as it is.
Levels were balanced by offline renders (peaks 0.3-0.7). UI: the "909" tile in `InstrumentPanel` (pad grid `synth/Pads.tsx`, responder grant like the keyboard,
Tune/Decay/Gain), preset `kit-909`, piano roll rows labelled with pad names, grooves `kit-techno`/`kit-rolling`/`kit-minimal` (`KIT_STYLES`, 2-bar phrases, fill in the
last beat). **Never heard on a phone**; the sounds are synthesized approximations of a 909, not samples.

## Recording and Library ordering

`RecordButton` (Library, top) records the microphone into the library: folder "Aufnahmen", name `takeName()`, always stored as 16-bit **mono WAV**
(`recordingTypes.ts`, `recordingMath.ts`). Web (`recording.web.ts`): `MediaRecorder` with raw settings (no echo cancelling/gain), decoded and
re-encoded to WAV so the take plays in any browser and syncs to Drive; level meter via an AnalyserNode on its own context. Native (`recording.ts`):
react-native-audio-api `AudioRecorder` `onAudioReady` blocks, session category `playAndRecord` while recording and `playback` after; mic permission
strings are in `app.json` (`NSMicrophoneUsageDescription`, `RECORD_AUDIO`). **The native path has never run on a device.** "Auf Spur legen"
puts the last take on a track. `libraryFilter.ts` (pure, tested): sort chips (Name / BPM / Tonart / Neu, unknown tempo/key last) and the
"Passt zu <key>" filter (`keysFit`: same key, relative key, fifth neighbours; a sample without a key always passes). Folders are not draggable on
purpose: a drag inside the scrolling sheet fights the scroll on a phone, so moving is "Auswählen" + "Verschieben …" or the folder ⋯ menu.

## Not done yet

App Store build (EAS; never tested on a real device natively; the effect graph and sample instrument
use WaveShaper/Convolver/StereoPanner, which react-native-audio-api implements natively but nobody
has heard on a phone yet).

MIDI notes: a clip with `notes` is a MIDI clip and plays its track's instrument (`track.synth`: an
oscillator; `wave: 'sample'` = a library sample, original pitch on C3 = 60, Ableton naming;
`'kick'` / `'noise'` = synthesized drums). Drum instruments get drum patterns and ring out like
one-shots (`noteHold`). Track effects incl. `pump` (beat ducking, scheduled per window like the
metronome) live in `mixgraph.ts`, which also holds the master soft limiter (`createLimiter`: live and
offline, transparent below 0.8 FS) that replaces hard clipping on hot mixes.
Effects (`track.fx`) change through `updateProject(…, { reschedule: false })`: `syncMixer` applies
them to the running graph, rescheduling would restart every voice.
