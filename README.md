# Scratchtrack

**A shared musical scratchpad for ideas worth keeping.**

Scratchtrack is a lightweight, browser-based 8-track workspace for quickly capturing, arranging, and exchanging beats, MIDI motifs, bass lines, rough recordings, and song ideas.

> **Core principle: capture an idea in under thirty seconds.**

Scratchtrack deliberately sits between a voice memo and a DAW. It should be structured enough to develop a song, but simple enough that recording an idea never turns into a production session.

## What works in the first prototype

- Fixed **8-track** arrangement: Drums, Synth, Bass, Audio 1–5
- Context-sensitive editor above the timeline
- Expressive 16-step drum sequencer with normal/accent hits and three compact synthesized kits
- Two-oscillator analog-style Web Audio synth with a tiny motif writer
- Mono browser recording for bass and general audio tracks
- Local-first project autosave plus IndexedDB audio blobs
- Up to **six Scratches** per track, with audition, notes, placement, deletion, and pointer drag-to-timeline
- Timeline clip arrangement with mute, solo, transport, playhead, drum/synth sequencing, and rough audio playback
- Project JSON import/export
- Optional Google Drive connection and direct project/audio sync scaffold
- PWA manifest/service worker for installable phone/desktop use
- GitHub Actions build and GitHub Pages deployment

## Tracks

1. **Drums** — expressive pattern sequencer and compact drum kits
2. **Synth** — built-in analog-style MIDI instrument
3. **Bass** — DI-oriented recording and monitoring controls
4. **Audio 1** — general audio
5. **Audio 2** — general audio
6. **Audio 3** — general audio
7. **Audio 4** — general audio
8. **Audio 5** — general audio

A **Scratch** is an alternate take or variation. A **Clip** is a reference to a Scratch placed on the arrangement timeline, so repeating an idea does not duplicate its underlying recording.

## Run locally

```bash
npm install
npm run dev
```

Production checks:

```bash
npm run typecheck
npm run build
```

The Vite base path is configured for GitHub Pages at `/scratchtrack/`.

## Google Drive setup

Scratchtrack works without Drive. When Drive is enabled, the browser talks directly to Google — there is no Scratchtrack server holding music or credentials.

1. Create a Google Cloud OAuth **Web application** client for the site.
2. Add the deployed GitHub Pages origin to its authorized JavaScript origins.
3. Paste the OAuth client ID into Scratchtrack's Drive panel.
4. Connect and sync.

The client ID is stored in that browser's local storage. Do **not** add a client secret to this public repository.

The current Drive implementation creates a `Scratchtrack` folder and uploads `project.json` plus each recorded audio Scratch. Google Picker and revision-aware two-person collaboration are the next collaboration milestone.

## Design rules

- Capture should be faster than setup.
- Eight tracks are a feature, not a temporary limitation.
- Six Scratches encourage decisions without destroying experiments.
- Touch, mouse, and pen should express the same interactions.
- Musical data stays editable; audio is stored once and referenced.
- Local work must survive a network or OAuth failure.
- Scratchtrack is **not a DAW**.

## Documentation

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/project-format.md`](docs/project-format.md)
- [`docs/roadmap.md`](docs/roadmap.md)

## License

Apache-2.0
