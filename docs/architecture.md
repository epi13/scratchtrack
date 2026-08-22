# Scratchtrack architecture

Scratchtrack is intentionally a **static application shell with private user-owned data**. GitHub Pages can serve the public code while musical projects stay in the browser and, when enabled, in Google Drive.

## Product boundary

Scratchtrack is not a DAW. The architecture should make fast capture and musical exchange easy without accumulating production-suite complexity.

The fixed model is eight tracks:

1. Drums
2. Synth
3. Bass
4. Audio 1
5. Audio 2
6. Audio 3
7. Audio 4
8. Audio 5

Each track owns **Scratches**, alternate versions of the part. A **Clip** is a lightweight reference to a Scratch placed on the timeline. Reusing, moving, repeating, copying, or snipping a Clip never duplicates its underlying recording.

The Scratch cap is currently 24 per track. That is intentionally higher than the original six because loop recording can create several takes in one session, but the product still expects users to delete obvious misses and keep the drawer useful.

## Runtime layers

### UI / interaction

React + Pointer Events. Primary timeline interactions are built around the same pointer model for mouse, finger, and pen:

- drag a Scratch onto its lane;
- select and drag a Clip to move it;
- drag a Clip's right edge to resize it;
- use large visible controls for snip/copy/paste/duplicate/delete;
- set Loop In / Out from the playhead.

The timeline and control banks are horizontally scrollable on small screens. Touch targets receive explicit minimum sizes instead of relying on desktop-sized controls.

### Arrangement model

A Clip stores `trackId`, `scratchId`, `startBeat`, `lengthBeats`, and `sourceOffsetBeats`.

For drum and synth clips, extending `lengthBeats` past the source pattern length repeats the musical pattern modulo its natural length. For recorded audio, clip length is bounded by the remaining source duration; Scratchtrack does not time-stretch audio.

Snipping is non-destructive. The left side keeps its original source offset while the right side advances `sourceOffsetBeats` by the split amount.

### Loop transport

The project stores one active loop range. When enabled, transport wraps from `loop.endBeat` back to `loop.startBeat` and the range is highlighted in the ruler and track lanes.

On Bass/Audio tracks, **Take each pass** keeps recording armed while the loop repeats. Each completed pass is persisted as a separate Scratch. This is deliberately a take-generation workflow rather than an overdub/compositing system.

### Audio

The Web Audio API powers the synthesized drum kit, metronome, synth, and processed playback of recorded Scratches. `MediaRecorder` handles compact microphone/interface capture. Scratchtrack asks for mono capture and prefers Opus/WebM at roughly 96 kbps when supported.

Drum playback exposes swing/humanization and compact timbre controls. Synth playback exposes oscillator, filter, envelope, drive, and LFO settings. Recorded audio is kept clean in IndexedDB while track mix settings remain editable in project JSON.

### Local-first persistence

Project structure is JSON stored in `localStorage`. Recorded Blob data is kept separately in IndexedDB so binary audio never inflates the project document. Local save is immediate and does not depend on network access.

Project format v2 is normalized at load/import time; v1 projects are upgraded in memory without requiring a manual migration step.

### Google Drive

Drive is an optional durable copy. The prototype loads Google Identity Services in the browser and requests `drive.file`, then creates a `Scratchtrack` folder, one subfolder per project, `project.json`, and one compressed audio file per recorded Scratch.

The OAuth **client ID is not a secret** and is configured at runtime. No OAuth client secret belongs in the repository.

The next Drive milestone is Google Picker-based opening of collaborator-shared project folders and revision-aware conflict handling. That keeps the narrow `drive.file` scope while allowing two collaborators to intentionally grant the app access to the same files.

## Project data rules

- Project JSON never embeds audio.
- A timeline Clip references a Scratch ID.
- A Scratch can be reused by multiple Clips.
- Audio is stored once per Scratch.
- Moving/copying/repeating/snipping Clips only changes JSON references.
- Musical edits update local state before any remote sync begins.
- Remote sync errors must never discard the local copy.
- Loop take capture creates new Scratches rather than destructively replacing prior takes.

## GitHub Pages

Vite is configured with `/scratchtrack/` as the base URL. The service worker, manifest, and Pages workflow use the same path. The GitHub Actions workflow typechecks and builds on pull requests, then deploys only from `main`.
