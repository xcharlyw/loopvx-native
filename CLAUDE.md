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
api/                Vercel Functions (vocals.ts, drive-token.ts, splice.ts, arrange.ts, stems.ts); api/_lib is shared, not deployed
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
- **Secrets stay server-side** (Vercel env): `ELEVENLABS_API_KEY`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`. Never put
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
  `driveImportRun.ts`; samples get id `drive:<fileId>`, dedupe by `driveId`, the file name and the folder path give category/BPM/key, but the library folder keeps the **main (pack) folder**: for "Diesen Ordner importieren" the chosen folder is the pack and the folders below it stay as sub folders (`libraryFolderOf(path, root)`: "SSE Pack/06 Impact Shots"; pure structure names like `loops`/`drum_loops`/`music_loops` are skipped, so "Pack/loops/drum_loops" is just "Pack"; if the chosen folder is itself a structure name the real folder above it is the pack). Single files picked in the browser have no root and get the last real folder. Files already in the library are not downloaded again but **moved** into the pack folder when their library folder differs (`importDriveItems` regroups, the plan card says "n davon kommen in den Pack-Ordner"): to fix an older import, import the pack folder once more. (The old "Nach Pack ordnen" button is gone, it would have flattened this again.) the
  copies are then synced into LOOPVX/Samples like any sample, **by a copy inside Drive** (`copyFile`, no upload from the phone; an upload if Drive refuses). A folder import first scans (`collectAudio` with `onFile`/`cancelled` hooks, up to 3000 files), shows a plan card (`summarizeImport`: new vs. existing, size, library folders) and only then downloads; both phases have "Abbrechen", importing again continues where it stopped because known Drive ids are skipped). The browser also lists "Computer" (Drive for desktop backups such as "My Mac": Drive's API has no listing for them, so they are found as folders owned by the user **without a parent**, `computerFolders`/`browseChildren`; checked against the real metadata of Karl's Drive: "My Mac" is a folder he owns with no parent; the full listing of owned folders can be slow on a big Drive) and "Mit mir geteilt". Never write outside the LOOPVX folder. The SoulVX Supabase project and its Google client are unrelated: don't touch.
- Commit trailers per the session's attribution reminder; no model names in pushed artifacts.

## Commands, shortcuts and menus (Live 12 style)

`src/ui/commands.ts` is the one table of actions (`COMMANDS`: id, German label, menu group Datei / Bearbeiten / Erstellen / Ansicht / Optionen / Hilfe or null, `keys`, `run`,
`enabled`). The key handler (`useShortcuts` in `App.tsx`), the desktop menu bar (`MenuBar.tsx`, web and wide screens only, `MENU_BAR_H`; hovering another title while one is
open switches, like a Mac menu bar), the phone menu (☰ in the TopBar → panel `menu`) and the shortcut list (panel `shortcuts`, Hilfe → Tastenkürzel or `?`) all read it,
so a shortcut shown is one that works. Pure key matching in `lib/keymap.ts` (tested): letters match the typed character (German Z/Y work), with Alt the physical key (⌥B
types "∫" on a Mac); named keys check Shift only when the spec sets it. Shortcuts are Live's where the browser allows it; Chrome never hands Cmd/Ctrl+T, N, W, Shift+T to a
page, so tracks also have Alt+T / Alt+Shift+T and a new project is Cmd/Ctrl+Alt+N. Own additions (no Live default): Cmd+Shift+K metronome, Cmd+Shift+L loop on/off, Cmd+I marker,
↑/↓ select track, ? shortcut list. Keys typed into inputs are ignored; Space on a focused button is left to the button.

## Plugin skin (mixer and device cards)

`src/ui/skin.tsx`: `PluginFrame` (vertical gradient panel with a lit top edge, `SKIN` colours), `Lcd` (green-on-black read-out), `LedMeter` (segmented ladder -48..+3 dB, yellow
from -6, red above 0, peak hold 1.2 s; pure `ledSegments`, tested), `FaderScale` (dB marks for a linear-gain fader). `Fader` has `cap` (a console fader cap); `Knob` has `width`
for narrow cells. **Mixer** (`MixerPanel`): one console strip per track (name LCD, Hall/Delay send knobs = `fx.reverb`/`fx.delay`, Pan knob, cap fader + scale + LED meter, dB LCD,
M/S hardware buttons, FX button, number) and the master strip at the right end (clip LED, master fader, Master-FX, metronome). On a wide screen the mixer is a detail panel
(docked at the bottom, 62 % high). **Device cards** use `PluginFrame`, accent titles and an LCD preset name; with more than 760 px they line up left to right after the
source card (Live's device chain), otherwise they stack.

## Panel sizes (Sheet)

The panels are no longer in a `Modal` but in an overlay inside `Shell` (`App.tsx`), so they can dock. `state.sheetSize` (`full` | `half` | `bar`, kept while the app runs, shared by all panels):
**full** = the side panel / whole screen on a phone with a dimmed backdrop (tap = close); **half** = docked above the transport bar (`bottom` = the measured height of `BottomBar`), `main` gets a
`marginBottom` of the sheet's height so the arrangement shrinks instead of being covered and stays scrollable and tappable; **bar** = only the title row. `Sheet.tsx` has the buttons
"Fenster verkleinern" / "Fenster vergrößern"; in bar mode the title reopens it and the body is `display: none` (stays mounted, so an open Drive folder or a plan survives). Sizes in
pure `sheetLayout.ts` (tested): half = 42 % of the screen height (240..440 px), width 560 max, on the right on wide screens. The Android back button closes the panel (`BackHandler`).
**Flexible height**: the arrows step full → 67 % → half → title bar (`stepSheet`), and a docked sheet has a **grip** on its top edge (`Shell`, `useDrag`) to drag it to any height: `state.sheetScale` (1 = full size; below 1 a full-size panel docks at that fraction of its full height, `fullHeight`: the window, or the detail view's share on a wide screen; `clampScale` snaps > 0.96 to 1, min 0.25). Checked in Chromium (phone viewport): 67 % step, drag down shrinks it. **Live layout on wide screens** (web, above the 720 px breakpoint, `menuBar` in `Shell`): the Library is not a panel but Live's **browser column** on the left (`state.browserOpen`,
`browserWidth`, toggled by `toggleBrowser` = ⌥⌘B / the TopBar "Library" pill; a `panel: 'library'` from anywhere is redirected to it). It renders `LibraryPanel` inside
`SheetPlace` (`Sheet.tsx` context: no size arrows, its ✕ closes the column). The **detail panels** (`DETAIL_PANELS`: clip, piano, devices, instrument, automation, mixer) dock at
the bottom across the width right of the browser (`placementFor`: full = 46 %, half = 32 % of the height, bar), so the arrangement stays above them; the other panels
(mixer, export, projects, track …) keep the right side sheet. Phones are unchanged.
Pitfall: with react-native-web a style `{ top: undefined }` does not override an earlier `top: 0` (that put the docked sheet at the top): build separate style objects.

## Drive browser = sample browser (audition and insert)

`DriveImport` (Library → "Google Drive durchsuchen") works like Ableton's browser: tap a file = **audition**, "＋ Einfügen" = put it on a track, no import step ("Mehrere wählen" and the
folder "Importieren" buttons still copy many files). `lib/driveAudio.ts`: `previewDriveFile` downloads the file once (small memory LRU: 12 files / 120 MB, shared in-flight
downloads), decodes it (`engine.decodePreview`; web decodes bytes, native a cache file from `previewSource` in the `samples(.web).ts` pair), takes the tempo from the name or
detects it (`detectTempo`, same confidence gate as the import) and calls `engine.startPreview`; a file already in the library (same `driveId`) plays from the library copy. `insertDriveFile`
stores the file as a normal Drive sample (`drive:<id>`, so sync, folders and dedupe work as before) and calls `placeSample` (right track by category, at the playhead).
`startPreview` + pure `planPreview` (timing.ts, tested): warped to the project tempo (`warpRate`), loops until stopped (not one-shots under 1.2 s), and while the song plays it waits for the
next bar line and joins the loop at the matching bar, so the beats line up (like Ableton's launch quantization). `stopPreview` emits so the buttons follow. Checked in the browser
with a fake Drive: warp 150 → 155 (rate 1.0333), tempo detected for an unnamed loop (~149.9), waits for the next bar while playing, insert lands on "Kick + Bass", re-audition
needs no download. **Not heard on a phone**; very large WAVs are downloaded completely before they play (no streaming).

## Library audition (tempo and level)

▶ in the Library runs `auditionSample` (actions.ts): a sample without a tempo (not a vocal, longer than 1.2 s) is measured first (`detectSampleTempo`, same confidence
gate as the import) and a confident result is **stored on the sample** (toast "Tempo erkannt"), then `engine.preview` plays it warped to the project tempo and, while the
song runs, from the next bar (`planPreview`). Detected tempos go through `snapTempo` (tempo.ts, tested): within 0.35 BPM of a whole number, or within 1 % when the
sample is then whole bars, they become whole BPM (149.82 → 150), otherwise a loop drifts against the song; the Drive preview uses it too. `PreviewLevel` (Library and
Drive browser): a knob for the audition level (`previewDb`, -24..+6 dB, kv `previewDb`, a per-device preference; `engine.setPreviewDb` changes the playing preview)
and "Wie Spur: <track>", which sets it to the fader level of the track the sample would land on (`trackForSample`), plus the now-playing line (tempo → project tempo).

## Duplicates

`lib/duplicates.ts` (pure, tested): a duplicate is the same file name (no case) **and** byte size for the Drive import (no size = never a duplicate). The Library button is looser (`sameSample`: same name and a size missing, equal, or the same folder/length; older entries may lack a size). The Drive import skips them
(`splitDuplicates` in `summarizeImport`/`importDriveItems`: against the library under another Drive id, and repeats inside one scan, e.g. "Version 34 - Hard Kick Pack"
vs "Version 34 - Mini Hard Techno Kick Pack"); the plan card says "n Duplikat(e) ... übersprungen". Library → folder bar "Duplikate" (`libraryDuplicates`): keeps the copy a
project uses (else the oldest) and removes only copies that no stored project/slot/sample instrument plays (`usedSampleIds`), after a confirm; Drive originals are never touched.

## Stem separation

Library → section **"Stems trennen"** at the top (button "Tune hochladen und trennen") or Datei / ☰ → "Tune in Stems trennen …": `startStemSeparation` (picks the tune first, inside the tap, then confirms the ElevenLabs credits; progress in `state.stemStatus`, afterwards `state.libraryJump` opens the stems' folder in the Library), `separateTune` (`lib/stems.ts`): the tune is uploaded (`uploadLarge`, resumable,
no 5 MB limit) to Drive **LOOPVX/Stems Export/<tune>/**, then `api/stems.ts` reads it there with the caller's Drive token (`driveAccessToken`, drive.file scope), sends it
to ElevenLabs `POST /v1/music/stem-separation` (`stem_variation_id` `six_stems_v1`, env `ELEVENLABS_STEM_VARIATION`; the answer is a ZIP), and writes each stem as
"<tune> - <Stem>.mp3" next to the tune (`api/_lib/drive.ts`, resumable). Reason for the Drive round trip: a Vercel function's request and answer stop at 4.5 MB, a tune and
its stems are far bigger. The app then downloads the stems into the library folder **"Stems Export/<tune>"** (`stemNames.ts`, tested: ids `drive:<fileId>`, category Drums/Bass →
kick, Synth + FX/Keys/Gitarre → synth, Vocal → vocal), all with the tune's tempo/key (from the name, else measured on the drums and copied to every stem). Stems: Drums, Bass,
Synth + FX (ElevenLabs "other"), Keys, Gitarre, Vocal: **there is no separate FX stem** in the six-stem model. `maxDuration` 300 s in `vercel.json`. Tested with mocks only
(no ElevenLabs/Drive in the sandbox); never run against the real APIs.

## Voice cloning (AI Vocals)

PromptBar → row "Stimme": "AI-Stimme" or one of the cloned voices, "＋ Stimme klonen". Cloning takes a library sample (any library sample (own recording, uploaded iPhone voice memo or mp3, whatever its category; `voiceSources`, newest first with a name search; never the generated "AI Vocals")), the clone panel also has a **record button** (`RecordButton` with `onSaved`/`hidePlace`: the take is stored in "Aufnahmen" and selected as the source at once), the user names it and **must tick the consent chip** (own voice or the person's permission; the function refuses without `consent=1`). `cloneVoice` (`lib/voices.ts`) decodes it, `voiceClip` (`voiceClip.ts`, tested) mixes to mono ~22 kHz and cuts at 80 s (one Vercel request is limited to 4.5 MB), posts multipart to `api/voice.ts` (ElevenLabs Instant Voice Cloning `POST /v1/voices/add`, `remove_background_noise`), and only `{id, name}` is kept on the device (kv `voices`); delete = `{action:'delete'}` → `DELETE /v1/voices/{id}`. Using a voice (Karl: "it should not sing, only speak like me"): `generateVocal({ voiceId, ... })` → `api/vocals.ts` with `speak: true` calls **Text-to-Speech** (`POST /v1/text-to-speech/{voiceId}`, model `eleven_multilingual_v2` or env `ELEVENLABS_TTS_MODEL`; `language_code` only for turbo/flash models) with the lyrics (else the prompt) as text and `voice_settings` from `speechSettings`: knobs Tempo (speed 0.7-1.2), Ausdruck (style) and Ruhe (stability); a cloned voice does **not sing**, and the clip keeps the speech's natural length (whole bars, no warp, no bpm/key on the sample). The server answers with `X-Voice-Id`, the app refuses a result without it. The "Schnellwahl" chips (PromptBar): Männlich/Weiblich, Rap/Sprechen/Gesang, Deutsch/Spanisch/Englisch; without a cloned voice they go into the **music prompt** (`traitsText` in api/vocals.ts), with a voice only Rap/Sprechen (they set the knobs: rap 1.1x/60 %/35 %, speaking 1x/30 %/50 %) and the language (text language decides for the multilingual model). The chosen voice is remembered (kv `voiceId`). The older Voice Changer path (`voiceId` without `speak`: separated vocal → `POST /v1/speech-to-speech/{voiceId}`) is still in the server but the app no longer uses it. **Unverified**: how natural the clone sounds, and which plan is needed for cloning/TTS (only checked against mocks; the ElevenLabs docs were not reachable from the sandbox).

**Vocal presets** (PromptBar row "Presets"): "＋ Speichern" stores the current style prompt, text, length, "Nur Vocals", the quick-pick chips, the three voice knobs and the chosen cloned voice under a name (kv `vocalPresets`, pure helpers `upsertPreset`/`removePreset`/`presetVoice` in `lib/vocalPresets.ts`, tested); same name (any case) replaces, tapping a chip loads everything, "Preset löschen" removes the selected one. A preset's voice only counts while that cloned voice still exists. Ten built-in **Vorlagen** (`FACTORY_PRESETS`: Alexa, Roxanne, Luna, Nova, Raven, Valentina, Kira, Nina, Electra, Zara, Karl's list of techno / neo rave vocal styles, each with its style prompt and knob values, female, "no singing") load the same way and cannot be deleted.

**Lyric ideas (Gemini) and tracks**: PromptBar → "Text-Ideen" (+ optional theme field) asks `api/lyrics.ts` (same `GEMINI_API_KEY`, model/fallback/retry like `api/arrange.ts`, temperature 1.1, JSON `{ideas:[{title, genre, lines, stylePrompt}]}`, checked by `parseIdeas`) for 4 hook ideas in the language chip's language (default German) with the gender/style chips and the project tempo; "Mehr Ideen" asks again and sends the titles shown so far (`avoid`), so it is endless; "Übernehmen" puts the lines into the text field and (without a cloned voice) the style prompt into the prompt field. The system prompt contains Karl's example hooks (DARK DESIRE ...) as the model of the style. Every generated vocal now goes onto **a new track** ("Vocals", then "Vocals 2", ...; an empty vocal track such as the default one is used first), so earlier takes stay untouched. Never run against the real Gemini API (mocks only).

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
Track order: `moveTrack(project, id, delta)` (pure, tested), buttons "▲ Nach oben" / "▼ Nach unten" in the TrackPanel (section "Position"); one undo step each, the panel stays open
(use the half-size sheet to watch the arrangement). No drag-to-reorder in the headers yet (a drag there fights the vertical scroll on touch).
**Duplicate a track**: `duplicateTrack` (project.ts, tested) puts a deep copy right below ("<Name> Kopie", solo off) with fresh ids for the track, clips and devices;
device automation lanes (`dev:<id>:<key>`) are remapped to the copy's devices. `duplicateSelectedTrack` selects the copy. Cmd/Ctrl+D = `duplicateSelection`: the
selected clips, or the selected track when no clip is selected (like Live); also "⧉ Duplizieren" in the TrackPanel, the copy button in the BottomBar's track group and
Erstellen → Spur duplizieren.
**Duplicate a project**: `copyProject` (project.ts, tested) + `duplicateProject` (actions.ts): a deep copy "<Name> (Kopie)" under a new id, saved and opened; the Projekte list has a copy button next to the backup arrow. Samples are shared through the library. (Opening a `.loopvx` backup of a project that already exists also makes a "(Kopie)".)

## Device chain (plugin slots)

`Track.devices` is the chain after the instrument/clips and before the DJ filter, drive, pan and fader:
`input -> devices -> hp -> lp -> drive -> pan -> pump -> fader`. Types: EQ, Compressor, Saturator, Echo, Reverb,
Chorus, Filter (with LFO), Limiter, Utility, Transient Shaper, Kickstart, ShaperBox. `devices.ts` is the registry (`DEVICE_DEFS`: key, range, default,
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

## Transient Shaper, Kickstart, ShaperBox

Three more devices (pure maths in `audio/rhythmmath.ts`, tested; nodes in `devicenodes.ts`; factory presets).
- **Transient Shaper** (`transient`: Attack / Sustain −100..+100 %, Tempo, Output): a fast follower (rectifier → lowpass ~160 Hz) and a slow one (rectifier →
  `peakFollower` hold loop with ~300 ms release → lowpass ~12 Hz), both through a log waveshaper (`logCurve`), subtracted; `transientCurve` turns the dB difference
  into the VCA gain (`transientGainDb`: ±12 dB max). Two plain lowpasses fell together in the decay and saw no sustain: the slow side needs the hold. Measured
  offline on 909 kicks: Attack +100 lifts the hit 0.27 → 0.47, Sustain −100 drops the tail 0.008 → 0.002, +100 lifts it to 0.034, 0/0 is neutral.
- **Kickstart** (`kickstart`: Kurve 1 of 8, Rate, Mix) and **ShaperBox** (`shaper`: Ziel Volume / Filter / Pan, Shape incl. gates, Rate, Tiefe, Filter offen) are
  **tempo-synced**: a `DeviceNode` may have `rhythm(p, env)` / `resetRhythm()`. `MixGraph.schedulePump` calls `TrackChain.scheduleRhythm` (and the master bay) for every
  window, live and offline, also in session mode; each cycle on the bar grid (`cycleStarts`, `RATE_BARS`) gets one `setValueCurveAtTime` (98 % of the cycle so curves
  never overlap; cycles already begun are skipped); `resetPump` cancels them. Gates fade their edges over 3 % of a step (only after an off step: a fade between two on
  steps clicked). Measured offline: Kickstart Classic 1/4 at 100 % ducks the beat start to 22 %; the Trance-Gate follows its pattern; Filter Saw closes (0.054 → 0.018);
  Pan sine swings R ↔ L. Cards show `CycleScope` / `TransientScope` (`synth/DeviceScopes.tsx`).

## Live playback scheduling

`engine.play` does **not** schedule the whole arrangement: it queues pieces of `CHUNK_BARS` (4) bars (`queueSegment`), the next one when the last has less than
`LOOKAHEAD` (1.5 s) left (`tick`, one piece per tick), then loops back to the loop start or stops at `playEnd`. A piece schedules the clips and notes that **start** in it
(`scheduleWindow(..., toBar, cutBar, fresh)`: they ring on past the piece's end and are cut only at `cutBar`, the loop/arrangement end; `fresh` = the transport starts
here, so things already sounding at `fromBar` are included). Pump and automation are scheduled per piece like per loop pass. Reason: a 128-bar arrangement is ~3000 notes,
and creating all their voices at once blocked the main thread for 2.4 s on a fast machine (a phone froze or lost the sound); now play() blocks ~80 ms. Offline render
still schedules the region in one go (default `cutBar = toBar`, `fresh = true`). Checked live: drums sound across piece boundaries, a 12-bar note holds through them
and stops at its end, a loop wraps.

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
**Copy automation** (AutomationPanel "Kopieren"): `copyRange(points, from, to, at)` repeats the visible window right after itself (edges interpolated, replaces what was there), `copyAutomation(from, to)` copies all lanes onto another track (device knob lanes go to the device of the same type in the target, others are skipped); `copyDevices` brings the knob lanes of the copied devices along. The `volume` lane is a multiplier of the track's fader (0..1), so the mixer fader keeps working under a fade.
**Automation mode and draw mode (Live's A and B)**: `state.autoMode` (key A, the curve icon in the BottomBar, Ansicht menu) draws each track's curve over its own clips
(`TrackCurve` in `ArrangeView`, `AutomationCurve overlay`): touches edit the curve instead of the clips, the parameter is the open lane's, else the first lane with points,
else volume; the header's "A" button (and the chip on wide screens) cycles it. `state.drawMode` (B or Cmd+B, pencil in the BottomBar, "✎ Zeichnen" in the sheet) makes a drag
draw the line freehand: pure `drawStroke` (automation.ts, tested) replaces the curve over the bars the finger crossed, one point per `drawStep(px per bar)` (1/16 bar zoomed in,
coarser zoomed out), fills gaps of a fast finger, keeps the old curve outside (anchor points right before/after) and drops collinear points (`simplifyLane`). One undo step
per stroke. A double tap on a point deletes it. On touch, automation mode takes the swipes over the tracks (scroll with the ruler/headers or leave the mode).
**Device knobs** are automatable too: lane `param` = `dev:<deviceId>:<paramKey>` (`deviceAutoParams`, `parseDeviceParam`, `paramDef` gives label/range/readout for
any param), values are the **knob position 0..1** (`knobPosition`/`knobValue` through `knobMath`, so frequency sweeps move like the log knob). `MixGraph.scheduleAutomation`
groups the lanes of one device and sends one `Slot.automate` per moment (otherwise lanes would overwrite each other); `setParam` in `devicenodes.ts` takes the env with
`at`/`ramp`/`touched` and schedules instead of gliding; an automated slot ignores `apply` updates until `resetAutomation` cancels the touched params. Measured offline: an EQ
high-cut lane closing over 8 bars cuts hats' zero crossings 13k → 0.8k, a second lane on the same EQ (low-cut opening) works at the same time. Switches and pickers are not
automatable. The arrange lane header cycles track params, then device knobs; the sheet lists device knobs as their own chips.

## Multi-selection and Consolidate (Cmd/Ctrl+J)

Clip selection is `selectedClipId` (primary) plus `extraClipIds` (valid only while `extraHead` is still the primary one, so stale extras never leak); read it through
`selectedClipIds()`, set it with `setClipSelection(primary, extras)`. **Never select the array itself in a hook** (`useStore(st => selectedClipIds(st))` returns a new array each time
and loops forever): select a joined string or a length. Add/remove: Shift/Cmd/Ctrl-click, or the check button in the bottom bar (`multiSelect` mode, for touch); Ctrl/Cmd+A selects all clips of the
track (`selectAllClipsOfTrack`); Delete removes all selected. Move (drag or arrow keys), edge trims, duplicate (copies as a block right after the selection) and split (every selected clip under the playhead) act on the whole selection through `lib/clipgroup.ts` (pure, tested: `groupEdit` + `applyGroupEdit`; the group changes tracks only if every clip fits a track of its kind, never moves before bar 1). The press that ends a drag is ignored for 350 ms (`dragEndedAt`), or it would shrink the selection to the dragged clip. `consolidateSelectedClip` (`actions.ts`, pure parts in `lib/consolidate.ts`: `consolidateGroups`, `contiguousRun`, `mergeMidiClips`):
one selected clip = it plus the clips touching it; several = per track the range from the first to the last selected clip with everything in between (gaps = silence).
MIDI: notes merged (each cut at its own clip's end). Audio: rendered with `renderWav` on a bare copy of the track (no fx/devices/automation, volume 1; clip gain, fades and
looping included) into a new sample `cons:<id>` (bpm = project bpm, folder "Konsolidiert"); one undo step. Shortcut in `useShortcuts` (App.tsx), button in the clip sheet.

**Clip mute** (Live's "Deactivate clip"): `Clip.muted`, toggled by key 0, the speaker button in the BottomBar or the clip sheet, for the whole selection
(`toggleClipsMuted` in project.ts, tested: a mixed selection is muted, an all-muted one unmuted). `scheduleWindow` skips muted clips (live and export), the sidechain ignores
them, consolidate drops their notes. Shown grey with "⊘". Measured offline: the export of a muted clip is silent.

## Markers, clipboard, rubber band, master bus, meters

- **Markers** (`project.markers`, pure `lib/markers.ts`): a strip under the ruler (`MARKER_H`); tap = jump, double tap / long press on a marker, the "✎" button next to "+ Marker" or Bearbeiten → "Marker umbenennen / löschen …" = `MarkersPanel` (rename/nudge/delete),
  long press on the empty strip or "+ Marker" in the corner = new marker. The arranger names its sections as markers (`withMarkers`).
- **Clipboard** (`clipgroup.ts`: `copyClips`/`pasteClips`/`clipsSpan`/`clipsInRange`): Ctrl/Cmd+C/V paste at the playhead, the block's top on the selected track if every
  clip fits; Ctrl/Cmd+L or a quick double tap on a clip = loop region on the selection (`loopSelection`). Buttons for touch in the clip sheet.
- **Rubber band** in `ArrangeView`: a `PanResponder` on the timeline content (bubbling `onMoveShouldSetPanResponder`, so clips and their drags win), on with a mouse
  (`FINE_POINTER`) or in multi-select mode (on touch it would block scrolling otherwise); rows are mapped with the open automation lanes counted (`rowAt`).
- **Copy a device chain**: `copyDevices(project, fromId, toId, 'append' | 'replace')` (project.ts, tested; track or `MASTER_ID` on either side, fresh device ids, settings and on/off kept, capped at MAX_DEVICES, the devices' knob automation lanes come along). UI: `DevicePanel` chip "Kette kopieren auf …" with Anhängen/Ersetzen and one chip per other track (and Master); one undo step.
- **Master bus**: `project.master.devices`, `MixGraph` routes every chain and return into `bus` → `masterBay` (a `DeviceBay`) → the limiter; the device functions in
  `project.ts` take `MASTER_ID`, `DevicePanel` shows the master when `devicesFor === 'master'` (no source slot, no Splice). Measured: a master EQ lowpass at 400 Hz cuts
  hats' zero crossings 15x, bypassed it is transparent.
- **Track meters**: `MixGraph.meter(trackId)` (an analyser after the fader, live context only, made on first use), `engine.trackPeak`, `StripMeter` in the mixer.
- **Sidechain**: `fx.pumpFrom` (a track id) makes the pump duck on that track's kick hits instead of every beat (`lib/sidechain.ts`: `pumpHits` = the 909 kit's
  C1 notes, or every note of a kick/sample instrument; falls back to every beat when the source is gone; `sidechainSources` for the TrackPanel chips "Pumpt auf").
  The arranger points the bass/lead/pad pump at its 909 drums. Measured offline: with kicks on beats 1 and 3 only those beats duck.
- **Share the mixdown** (ExportPanel "Teilen"): `renderMixdown` then `shareMixdown` (Web Share API with files; native: the share sheet of `saveFile`). Browsers only open the
  sheet inside a fresh tap, so on web the render runs on the first tap and "Jetzt teilen" shares on the second; without file sharing it downloads instead.

## Arranger

`lib/arranger.ts` (pure, tested) lays out a whole track on the project: `sectionsFor(64|128)` = intro, build-up, drop, break, build-up 2, drop 2, outro; `roleOf(track)` reads
drums (kit909) / bass / lead / pad (MIDI, from the preset category or the name) and kickLoop / topLoop / synthLoop / vocal (audio, from the category); `SPANS` says in which
fraction of which section a role plays; MIDI roles get `generatePattern` clips (project key, scale and progression, so everything fits; the drums a snare roll in the last
bar of a build and a crash on each drop; no 909 kick when a kick loop carries it), audio roles the best library sample (`candidates`: category, ±8 BPM, `keysFit`, nearest
tempo first, one of the best three picked by the seed) looped over the whole span. `automationFor` adds filter openings, a reverb throw before each drop, drive build-ups on the
bass and a fade-out; bass/lead/pad get a pump when they have none. Missing roles are added as MIDI tracks (909 Drums, Rumble Bass, Lead, Pad with tuned faders). It **replaces** the
clips (undoable). Rule based with seeded randomness. **AI plan (Gemini)**: the sheet's text field sends the text, tempo, key, track roles and fitting
library counts to `api/arrange.ts` (`GEMINI_API_KEY`, model `GEMINI_MODEL` or `gemini-3.6-flash`, on 429/5xx one retry and a lighter `GEMINI_FALLBACK_MODEL` (`gemini-3.5-flash-lite`), JSON answer, `extractJson`); the model only picks the structure
(sections with bars and `mute` roles, names = markers), styles (bass/lead/drop drums), roles to add, automation on/off, optional tempo/key and a German summary.
`lib/arrangePlan.ts` (`parsePlan`, tested) checks every field (bars snap to 4, 4..64, total <= 256, needs a drop, keys normalised) and `planSections` turns it into
`ArrangeOptions.sections` (a second drop/build plays as drop2/build2); the notes and clips are still built by the rules. Never tested against the real Gemini API
(no key in the sandbox; tests and the browser check use mocks). **Effect sounds** (`plan.fx`, `FxHit` in arranger.ts): a one-off sound (impact, riser, downlifter, crash, other) from the library on its **own audio track** at one bar
("Impact FX bei Takt 65"). The plan holds `bar` as the 1-based ruler number (`parseFx` makes it 0-based), a track name, `search` words and optionally a library sample name.
`findFxSample` (tested) takes a named sample (loose name match; `keepNamedSamples` drops any name the user did not type himself, models invent names), else scores the **user's search words** (the first counts most; the kind's own `FX_WORDS` only when there are no search words, so nothing unrelated is ever picked, no match = not found) as whole words against name and folder ("impact" finds "SSE Impact Shot 3" in "06 Impact Shots"), prefers short
one-shots for hits, vocals only left out of the fallback by the kind's words (the import's category is a guess: Karl's "Impact Shots" came in as vocals, so **the user's words search all categories**), picks among equally good matches with the seed. `withUserWords` puts the words of the user's own sentence that occur in sample names/folders (`userSearchWords`, rarest first, stop words and 2-letter words out) in front of the model's search words, because a lite model returns useless search words; for single additions the panel shows only what the app really did (the model's summary may promise more). The clip is as long as the sample (`sampleLengthBars`), an existing track of the same name is
reused and re-rolling replaces only the clip at that bar. No match = `fxMissing`, shown in red with the hint to name the sample in the text. **Key and loop length for effects** (`FxHit.key`, `FxHit.length` up to 128 bars): "Screech Synth in key Fmin bei Takt 97 und loope 32 Takte" is an audio sample from the library (not a MIDI synth: Karl wants his own sample), looped over `length` bars; `keyFromPrompt`/`withPromptKey` read the key from the text, `isKeyWord` keeps key names ("fmin") out of the search words (a vocal named "..._Fmin" was picked because only the key matched), and `findFxSample` drops samples known to be in another key (`keyPitch`), prefers the key, and matches the category word too ("synth"). **Drive fallback** (`lib/fxDrive.ts` + pure `fxPick.ts`, tested with Karl's real file names): when an effect has no library sample and the Drive read scope is granted, the panel searches Drive by name (first two search words), `pickDriveFile` takes the best audio file (never MIDI, never another key, a loop for requests of 8+ bars), imports it as a normal Drive sample and then the effect is placed; the toast says "aus Google Drive geladen". **Sources** (chips "Sounds aus: Library / Google Drive / Splice" in `ArrangerPanel`, `FxSources`, kept while the app runs, default Library + Drive; Splice web only and off by default): `fetchMissingFx` serves each effect from the chosen sources in that order (library as is, then Drive, then Splice: search, `pickSpliceResult`, **confirm before the credit is spent**, `downloadFromSplice`); with the library off only what Drive/Splice supplied this run is offered to `arrange`. Splice not connected / Drive not readable show a note under the result. `parseSampleName` reads keys in brackets ("(F)", "(C#)"). `plan.notes` = what the text asked
for that the plan cannot express ("Nicht umgesetzt" in the panel), so the model cannot pretend; `requestPlan` also sends up to 120 sample names (effect-like first) and the
server prompt demands German texts (`summary`, `notes`) and low temperature; the model that answered is shown (the lite fallback gives noticeably worse plans). UI `ArrangerPanel` (FAB
"Arrangement" next to "AI Vocals") is **AI only**: the plan-less default (fixed 64/128 shape, "Arrangement erzeugen" without a text) was removed from the UI at Karl's request;
**One step** at Karl's request: the text goes to Gemini and the plan is applied at once ("Ausführen"; no separate "plan" step, no plan list, no option chips). The plan has a `scope`:
`fx_only` (single additions such as "Impact FX bei Takt 65 auf neuer Spur": only `placeFx` runs via `ArrangeOptions.fxOnly`, nothing else of the project is touched: no clips replaced,
no tracks added, no markers/loop/tempo change, no confirm) or `full` (a whole arrangement; if clips exist the app first asks "Vorhandene Clips ersetzen?" with the AI's summary).
The prompt says "when in doubt fx_only"; `parsePlan` turns an `fx_only` answer into a plan without structure (and rejects it when it has no usable effect). In `full` plans new
tracks come only from `addRoles` and automation only when `plan.automation` is true: **what the plan does not mention is not done**. After a run the panel offers "Anderes Ergebnis"
(`Anderes Sample` for fx_only; same plan, new seed, no AI call) and "Anhören"; everything is one undo step. `arrange()` itself still works without `sections` (default `sectionsFor(128)`), tests rely on it. Offline renders: the three added tracks come out at peaks 0.5 / 0.2 / 0.3 and the drop at 0.55 on the master.

## Rebuild a tune's structure from its stems

Arrangement panel → "Aufbau von einem Tune nachbauen" (`ReferenceRebuild.tsx`): one chip per tune with stems in the library (`stemTunes`: folders "Stems Export/<tune>",
stem files by name `stemKindOf`). `rebuildFromStems` (`referenceRun.ts`) decodes each stem (`engine.loadBuffer`), measures the RMS of every bar at the tune's tempo
(`barLevels`; the stems' `bpm`, required), and `structureFromStems` (pure, `referenceArrange.ts`, tested) builds the sections: phrases of 8 bars, a stem plays in a phrase
when it is louder than 25 % of its own 90th percentile in at least half the bars, equal neighbours merge, then drums + bass = drop, no drums = break (intro/outro at the
ends), drums without bass = build-up before a drop; silent stems become the section's `mute` roles; > 64 bars split. Then the normal `arrange` with `planSections`
(markers named after the sections), automation on, new tracks only for roles the tune has, and **never the tune's own stems** as library material (only the project's
tracks and the user's samples). Confirm before replacing clips; one undo step. The tune's tempo is not taken over. Tested on synthetic levels only (no real tune in the sandbox).

**"Aufbau nachbauen" = the original stems** (Karl: "simple first"): `rebuildWithOriginalStems` puts each stem of the tune on its own audio track "Stem Drums / Stem Bass /
Stem Synth + FX …" (stems silent all through are left out), with clips only in the sections where that stem plays (`stemClipRanges`, tested: a section gets the stem when it
plays in at least half its bars, neighbours merge, clip offset = its start, so it is exactly that part of the original), the sections as markers and **the project tempo set to
the tune's**. A second run replaces the clips of the "Stem …" tracks; other tracks are untouched. The MIDI-based chips ("Aufbau mit eigenen Sounds", "Drums → MIDI") were removed from the UI at Karl's request ("funktioniert nicht"); `rebuildFromStems`/`drumsToMidi` stay in referenceRun.ts, unused. Checked in Chromium with synthetic WAV stems in IndexedDB: 3 tracks, "Intro 16 · Drop 32 · Outro 16".

**Separate drums in the rebuild** (Karl: "use the separated drums for the rebuild, not only the full drums"): `rebuildWithOriginalStems` looks for drum part files in the
tune's library folder (`drumPartLabel`: the app's own split "<tune> - Kick / Clap + Snare / HiHats", or files from another tool such as Moises named kick / snare / clap /
hi-hat / toms / cymbal); with parts present the full drums stem gets **no track of its own** (it still tells where the drums play, for the sections) and each part gets "Stem Kick",
"Stem Clap + Snare", "Stem HiHats" … with clips only where that part plays; without parts and with a drums stem it runs `splitDrumsAudio` first (the result says so). Checked in
Chromium with synthetic kick + hat drums: tracks Stem Kick, Stem Clap + Snare, Stem HiHats, Stem Bass, Stem Synth + FX.

**Kick + Top Loop (current drum split; the older text below about three bands is superseded)**: Karl: a kick is rumble + body + click, split the drums only into kick and top loop. `makeDrumSplitter` returns `kick` = lows < 150 Hz all the time + the 150-600 Hz body for 140 ms (15 ms fade) after each kick on the beat + the highs > 600 Hz for 6 ms (click), and `top` = drums − kick, so kick + top loop add up to the original exactly (`low + body*mid + click*high`, mid = x − low − high). Onsets are held to the beat grid (`onBeat`). Ids `split3:` (`split:`/`split2:` are stale and re-split), names "<tune> - Kick" / "<tune> - Top Loop" (`drumPartLabel` knows 'Top Loop'). The band split `splitBands`/`transcribeDrums` stay for the MIDI transcription only.

**Kick designer** ("Kick bearbeiten" chip per tune in `ReferenceRebuild.tsx`, no AI): five knobs (`KickDesign`: rumble/body/click level in dB, body and click length in ms; `DEFAULT_KICK` = the split's values) and "Kick bauen" = `buildKick` (referenceRun.ts) → `makeDrumSplitter(...).kick(design)` combines the three bands into a new sample "<tune> - Kick (Edit)" (id `kickedit:`, replaced on each build, not a drum part for the rebuild), full length of the drums stem so it stays in sync; the split's Kick and Top Loop stay untouched. The bands are cut **zero-phase** (`chainZeroPhase`, forward + backward): with the normal filters a 55 Hz rumble left a big phase-shifted copy in the "body" (x − low − high), so the rumble knob did not control the rumble. Tested on synthetic kicks only.

**Kick click without phasing** (Karl: "the kick lacks the click, the hihats must lose the short click, because of phasing"): the drums split is **complementary**
(`makeDrumSplitter` in drumSplit.ts): kick onsets are found on the kick band (`kickOnsetsMs`), and in a window of 0.5 ms before to 6 ms after each onset (`clickWindow`, 1 ms fades)
the kick part gets everything the original has above its 150 Hz body (`band += w * (x - band)`) while the hats part is multiplied by `1 - w`, so the click lives only in the kick
stem and nothing is doubled when the stems play together. The onsets are held to the tune's beat grid (`onBeat`, ±25 ms, grid from `transcribeDrums` in `splitDrumsAudio`), otherwise bass notes or rolls between the beats got a click window too ("flickers like 16ths"). Claps are not ducked (a clap on a kick keeps its attack; its mid band may still hold a little kick click). New splits use
the id prefix `split2:`; an older split (`split:`, without the click) is replaced on the next split and counts as missing in the rebuild, so it is re-split automatically.
Tested on synthetic kicks with a 3 kHz click: the plain low band has < 5 % of the click energy, the new kick part > 60 %, the hats part < 10 % of the old hats band in the window, hats
between the kicks unchanged.

**Bar 1 and exact tempo** (`tuneGrid` in referenceRun.ts, used by all three: original stems, own sounds, drums → MIDI): measured on the drums stem with `transcribeDrums`:
the grid's tempo (kept as named when within 0.015 BPM) and `downbeatMs` = the first kick on a beat (tunes start on a downbeat), kept on the bar grid, so a pickup or silence
before it is cut; `barLevels(…, offsetSec)` starts bar 1 there, the stem clips get `offset = start + offsetBars`, the MIDI notes start at that bar, and when the measured tempo
differs the stems' `bpm` and the project tempo are set to it. Envelope ticks are exactly 1 ms (fractional hop): a whole-sample hop of 22 at 22.05 kHz had put the tempo 0.3 BPM
off (found in the browser check). Checked in Chromium with stems starting after 0.5 s of silence: "150 BPM, Takt 1 beginnt bei 0,50 s", same sections as without the lead.

**Drums of a stemmed tune** (same section, per tune): `drumSplit.ts` (pure, tested on synthetic drums incl. a late start, a 0.2 BPM wrong tempo and a tune without
claps). "Drums → MIDI" = `drumsToMidi` (referenceRun.ts): the drums stem mono at ≤ 24 kHz (`monoForAnalysis`), band filters (RBJ biquads, 24 dB/oct: kick < 150 Hz, clap
500–5000 Hz, hats > 7 kHz), 1 ms peak envelopes, the grid fitted to the kicks (`fitGrid`: tempo ±0.25 BPM and the first beat's phase), then per 16th step and band the jump
from before to after the step against the band's 95th percentile; bleed rules: a clap on a kick step must beat 1.6x the quieter kick steps' mid jump, on a hat-ish step 2.5x
the hats' mid jump; a hat on a clap/kick step likewise. Notes on the 909 pads (kick 36, clap 39, closed hat 42) in one clip over the whole tune on a new track "<tune> Drums"
(kit-909). "Drums → Kick / Clap / HiHats" = `splitDrumsAudio`: the same band filters per channel, one band at a time, as WAV samples "<tune> - Kick / Clap + Snare / HiHats"
in the tune's folder (`split:<id>`, not AI: bleed stays audible). Never run on a real tune.

## 909 drum machine (issue #4)

`wave: 'kit909'` is a whole drum kit as one instrument (`src/audio/drum909.ts`, pure): 12 pads on drum-rack/GM notes (kick C1 = 36, rim 37, snare 38,
clap 39, toms 41/45/48, closed hat 42, open hat 46, crash 49, ride 51, cowbell 56), each a recipe of parts (`osc` with a pitch drop, filtered `noise`, `metal` =
six squares through a highpass) with an exponential decay (`planHit`; `tune` in cents and `kitDecay` scale the whole kit). `startKitVoice` in `engine.ts` builds
it live and offline; a closed hat cuts the open hat before it (`scheduleNotes`, `chokes`). A note without a pad is silent, so a drum `.mid` plays as it is.
Levels were balanced by offline renders (peaks 0.3-0.7). UI: the "909" tile in `InstrumentPanel` (pad grid `synth/Pads.tsx`, responder grant like the keyboard,
Tune/Decay/Gain), preset `kit-909`, piano roll rows labelled with pad names, grooves `kit-techno`/`kit-rolling`/`kit-minimal` (`KIT_STYLES`, 2-bar phrases, fill in the
last beat). **Never heard on a phone**; the sounds are synthesized approximations of a 909, not samples.

## Drag samples into the sampler

`src/ui/dnd.tsx` (web only): a module store for one carried sample, `useSampleDragSource` (Library rows: mouse after 6 px; touch after a 350 ms hold, then
`touchmove` is `preventDefault`ed so the list does not scroll; a swipe before that scrolls as usual), `useSampleDropTarget(id, drop)` (registers the element; the hit
test reads `getBoundingClientRect`, the smallest target under the pointer wins), `SampleDragGhost` (in `Shell`). Audio clips in the arrangement are sources too: their move
drag (`useDrag` passes the page point) shows the ghost while over a target, and a release there hands the sample over instead of moving the clip. Targets: the Sound panel
(`InstrumentPanel`), the device chain's source card and the headers of MIDI tracks (`HeaderDrop`). The drop is `loadSampleIntoSampler` (actions.ts) → pure
`withSamplerSample` (presets.ts, tested: a sampler keeps its settings, any other instrument becomes a fresh sampler), one undo step, plays the root note.
On a phone the Library is a panel, so drop on a track header with the Library at half size. Checked with mouse and emulated touch in Chromium; not on a real iPhone.

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
