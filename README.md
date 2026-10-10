# LOOPVX

Minimal mobile producing studio for hard techno – "Ableton, but small". One Expo / React Native
codebase for web, iOS and Android. Live web build: https://loopvx-native.vercel.app

- Arrangement and session view, loops warped to the project tempo, mixer, WAV mixdown and stems
- Clip editing: drag, trim, split, gain and fades; undo/redo
- AI vocals via the ElevenLabs Music API (server-side key, `api/vocals.ts`)
- Google sign-in (Supabase) and sync of projects and samples through the user's Google Drive
- `.loopvx` project files as an offline backup

Developer notes, architecture and verification steps: [CLAUDE.md](CLAUDE.md).

```bash
npm install
npx expo start --web     # or: npx expo start (Expo Go / dev build)
npx tsc --noEmit && npx jest
```

Icons are rendered by `python3 scripts/render-brand-assets.py`.
