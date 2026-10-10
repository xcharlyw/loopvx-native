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
src/audio/          engine.ts (react-native-audio-api), timing.ts (pure tempo math), wav.ts, pageAudio.ts
src/lib/            store.ts (state, undo, autosave), project.ts (pure project mutations), actions.ts,
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
  Drive (trash only). The SoulVX Supabase project and its Google client are unrelated: don't touch.
- Commit trailers per the session's attribution reminder; no model names in pushed artifacts.

## Not done yet

Drive import of existing loop folders (needs `drive.readonly` or the Picker), recording / pads,
sample-based synth (MIDI clips play a per-track oscillator synth: `src/audio/synth.ts`, piano roll in
`src/ui/PianoRollPanel.tsx`, `.mid` I/O in `src/lib/midi.ts`, Ableton naming 60 = C3),
App Store build (EAS; never tested on a real device natively).
