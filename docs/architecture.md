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

The general Scratch cap is currently 36 per track. A single Auto Scratch loop session is independently capped at 12 new takes. The product still expects users to delete obvious misses and keep the drawer useful.

## Runtime layers

### UI / interaction

React + Pointer Events. Primary editing concepts are shared across mouse, finger, and pen, but the interaction mechanics deliberately differ where phones need ordinary scrolling.

Desktop can drag a clip body directly. On touch devices, clip bodies remain scroll-friendly and a dedicated **move handle** enters custom movement. Resize has its own dedicated edge handle. This keeps the majority of each timeline lane available to horizontal/vertical browser gestures instead of claiming every touch as an edit.

The bar ruler is the second playhead/loop control surface: tap sets the playhead; drag defines a custom contiguous loop range. Track lanes themselves do not seek the transport.

Broad app, arrangement, clip, and Scratch surfaces allow pan/pinch browser gestures. Only small intentional editing handles opt into `touch-action: none`.

### Arrangement model

A Clip stores `trackId`, `scratchId`, `startBeat`, `lengthBeats`, and `sourceOffsetBeats`.

For drum and synth clips, extending `lengthBeats` past the source pattern length repeats the musical pattern modulo its natural length. For recorded audio, clip length is bounded by the remaining source duration; Scratchtrack does not time-stretch audio.

Snipping is non-destructive. The left side keeps its original source offset while the right side advances `sourceOffsetBeats` by the split amount.

The editor Snap preference is local rather than project musical data. Snap On currently resolves clip movement to 0.125 beats; Snap Off keeps hundredth-beat placement. Movement is committed live so the toolbar and drag ghost can display the exact target and delta while editing.

### Loop transport + recording

The project stores one active loop range. When enabled, transport wraps from `loop.endBeat` back to `loop.startBeat` and the range is highlighted in the ruler and track lanes.

Bass/Audio loop recording follows a fixed simple state machine:

1. Record arms microphone/interface capture and starts the **main arrangement transport** from Loop In.
2. The first full pass is always a **warm-up**. No `MediaRecorder` data is saved.
3. At the first loop wrap, capture starts.
4. If `autoScratch` is on (default), one `MediaRecorder` stays active and `requestData()` is called at each subsequent loop boundary.
5. Each requested Blob becomes an independent Scratch.
6. At 12 requested loop takes, the recorder stops automatically while arrangement playback may continue.
7. If Auto Scratch is off, the recorder begins after warm-up but runs continuously until explicitly stopped, producing one Scratch.

Using one recorder after warm-up avoids deliberately inserting a stop/restart gap between every pass. Browser event scheduling is still not sample-accurate, so real-device loop-boundary testing remains important.

Pause or Stop on the main transport terminates an active recording session. Record is therefore part of the transport workflow rather than a disconnected microphone action.

### Audio

The Web Audio API powers the synthesized drum kit, metronome, synth, processed playback of recorded Scratches, and local waveform decoding. `MediaRecorder` handles compact microphone/interface capture. Scratchtrack asks for mono capture and prefers Opus/WebM at roughly 96 kbps when supported.

Drum playback exposes swing/humanization and compact timbre controls. Synth playback exposes oscillator, filter, envelope, drive, and LFO settings. Recorded audio is kept clean in IndexedDB while track mix settings remain editable in project JSON.

The selected audio Scratch waveform is derived on demand from the stored Blob. Peaks are display data only and are not persisted.

### Local-first persistence

Project structure is JSON stored in `localStorage`. Recorded Blob data is kept separately in IndexedDB so binary audio never inflates the project document. Local save is immediate and does not depend on network access.

Project format v3 is normalized at load/import time; v1 and v2 projects are upgraded in memory without a manual migration step. The migration intentionally enables Auto Scratch for older prototype projects to match the new default workflow.

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
- Waveforms are regenerated locally instead of stored as redundant media.
- Musical edits update local state before any remote sync begins.
- Remote sync errors must never discard the local copy.
- Loop take capture creates new Scratches rather than destructively replacing prior takes.

## GitHub Pages

Vite is configured with `/scratchtrack/` as the base URL. The service worker, manifest, and Pages workflow use the same path. The GitHub Actions workflow typechecks and builds on pull requests, then deploys only from `main`.
