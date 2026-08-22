# Scratchtrack architecture

Scratchtrack is intentionally a **static application shell with private user-owned data**. GitHub Pages can serve the public code while the musical projects stay in the browser and, when enabled, in Google Drive.

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

Each track owns at most six **Scratches**, alternate versions of the part. A **Clip** is a reference to a Scratch placed on the timeline. Reusing a Scratch never duplicates its underlying audio.

## Runtime layers

### UI / interaction

React + Pointer Events. All primary interactions are designed so pointer input can come from a mouse, finger, or pen. The timeline is horizontally scrollable on small screens.

### Audio

The Web Audio API powers the synthesized drum kit, metronome, and analog-style synth. `MediaRecorder` handles compressed microphone / interface capture. Scratchtrack currently asks for mono capture and prefers Opus/WebM at roughly 96 kbps when the browser exposes it.

### Local-first persistence

Project structure is JSON stored in `localStorage`. Recorded Blob data is kept separately in IndexedDB so binary audio never inflates the project document. Local save is immediate and does not depend on network access.

### Google Drive

Drive is an optional durable copy. The prototype loads Google Identity Services in the browser and requests `drive.file`, then creates a `Scratchtrack` folder, one subfolder per project, `project.json`, and one compressed audio file per recorded Scratch.

The OAuth **client ID is not a secret** and is configured at runtime. No OAuth client secret belongs in the repository.

The next Drive milestone is Google Picker-based opening of collaborator-shared project folders and revision-aware conflict handling. That keeps the narrow `drive.file` scope while allowing two collaborators to intentionally grant the app access to the same files.

## Project data rules

- Project JSON never embeds audio.
- A timeline Clip references a Scratch ID.
- A Scratch can be reused by multiple Clips.
- Audio is stored once per Scratch.
- Musical edits update local state before any remote sync begins.
- Remote sync errors must never discard the local copy.

## GitHub Pages

Vite is configured with `/scratchtrack/` as the base URL. The service worker, manifest, and Pages workflow use the same path. The GitHub Actions workflow typechecks and builds on pull requests, then deploys only from `main`.
