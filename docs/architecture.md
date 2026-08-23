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
2. PCM capture starts immediately so the audio graph is already running, but the first full pass is always a **warm-up** and those samples are discarded.
3. At the first loop wrap, a capture mark is set and saving begins.
4. If `autoScratch` is on (default), each later loop boundary slices the continuous PCM stream and encodes that slice as its own 16-bit WAV Scratch.
5. Every saved Blob is a complete, independently decodable audio file. Auto Scratch does **not** use `MediaRecorder.requestData()` fragments.
6. At 12 loop takes, capture stops automatically while arrangement playback may continue.
7. If Auto Scratch is off, capture still begins after warm-up and runs until explicitly stopped, producing one Scratch.

Continuous PCM capture avoids both inter-take gaps and the WebM/MP4 fragment problem where later `requestData()` chunks are missing container headers and cannot be decoded. Browser transport scheduling is still not sample-accurate, so real-device loop-boundary testing remains important.

Pause or Stop on the main transport terminates an active recording session. Record is therefore part of the transport workflow rather than a disconnected microphone action.

### Audio

The Web Audio API powers the synthesized drum kit, metronome, synth, processed playback of recorded Scratches, and local waveform decoding. Live input is captured as PCM (AudioWorklet with ScriptProcessor fallback) and each Scratch is stored as a standalone 16-bit mono WAV. That format decodes on both desktop Chromium and iPhone Safari. Waveform and Hear/arrangement playback share the same decoder; a missing header or failed decode surfaces a clear error instead of failing silently.

Drum playback exposes swing/humanization and compact timbre controls. Synth playback exposes oscillator, filter, envelope, drive, and LFO settings. Recorded audio is kept clean in IndexedDB while track mix settings remain editable in project JSON.

The selected audio Scratch waveform is derived on demand from the stored Blob. Peaks are display data only and are not persisted.

### Local-first persistence

Project structure is JSON stored in `localStorage`. Recorded Blob data is kept separately in IndexedDB so binary audio never inflates the project document. Local save is immediate and does not depend on network access.

Project format v3 is normalized at load/import time; v1 and v2 projects are upgraded in memory without a manual migration step. The migration intentionally enables Auto Scratch for older prototype projects to match the new default workflow.

### Google Drive

Drive is an optional durable copy. The app loads Google Identity Services in the browser and requests only `drive.file`. A configured `VITE_GOOGLE_CLIENT_ID` is public application configuration baked in at build time — not a client secret. No OAuth client secret belongs in the repository.

Because `drive.file` cannot silently open someone else’s files from an ID alone, sharing is:

1. Owner connects Google Drive and syncs. Scratchtrack creates a project folder containing `project.json`, individual audio files, and a single `scratchtrack.pack` zip.
2. Owner shares that Drive folder with the collaborator using normal Google Drive permissions, then sends a Scratchtrack link that contains only the folder ID.
3. The collaborator signs in with their own Google account and uses Google Picker to explicitly open the shared folder or pack. That is the Google-supported way to grant this static app access under `drive.file`.

Token expiry shows a reconnect state. Local work is never discarded on a Drive failure.

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
