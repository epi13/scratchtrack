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

## Module layout (v0.5)

| Module | Responsibility |
| --- | --- |
| `src/types.ts` | Project document types (format v4) |
| `src/music.ts` | Pure musical math: time signatures, subdivisions, the 1/24-beat tick model, position formatting/parsing, scale library and pad layouts |
| `src/project.ts` | Project construction + migration (v1/v2/v3 → v4), Scratch factories (`makeScratch`, `duplicateScratch`, `cloneScratch`) — the single authoritative place where Scratches are created or copied |
| `src/store.ts` | Persistence only: localStorage project autosave, IndexedDB audio blobs |
| `src/audio.ts` | Web Audio: kit voice profiles (five kits), synth, metronome, compression routes (single/multi-stage), decoded-buffer cache |
| `src/drive.ts` | Google Identity/Picker integration, Drive sync/open flows, share-link parsing |
| `src/App.tsx` | Transport (tick-scheduled), arrangement UI, drawers, Drive panel |
| `src/components/` | Track editors (Drum/Synth/Audio), motif composer piano roll, shared controls |

Musical invariants live in pure modules so they are unit-testable without a browser; React components only orchestrate state updates through immutable commit helpers.

## Runtime layers

### UI / interaction

React + Pointer Events. Primary editing concepts are shared across mouse, finger, and pen, but the interaction mechanics deliberately differ where phones need ordinary scrolling.

Every track editor leads with a common **Scratch action strip** — ＋ New Scratch, Duplicate Scratch, Place @ Playhead — so the core workflow (select track → create idea → edit/record → place at playhead) is identical for Drums, Synth, Bass, and Audio.

Desktop can drag a clip body directly. On touch devices, clip bodies remain scroll-friendly and a dedicated **move handle** enters custom movement. Resize has its own dedicated edge handle. The bar ruler handles tap-to-seek and drag-for-loop. Only small intentional editing handles opt into `touch-action: none`; broad surfaces keep browser pan/pinch gestures.

The Scratch drawer toggle shows **＋** closed and **−** open with matching `aria-expanded` state.

### Musical time model

- Timeline positions are quarter-note beats; one bar = `numerator × (4/denominator)` beats.
- Playback advances a fixed grid of **24 ticks per beat**, which divides every supported drum subdivision value exactly (quarters 24 … triplet-eighths 8, triplet-sixteenths 4, 1/32s 3).
- Drum patterns store their own subdivision; row length equals steps-per-bar derived from meter × subdivision.
- Metronome accents bar starts and clicks quarters in any meter.
- Loop In/Out are absolute beats; the transport wraps at whole ticks. Editing uses `bar.beat[.sixteenth]` strings parsed by `music.ts`.
- Changing meter re-maps existing drum hits to nearest equivalent positions (stronger hits win collisions).

### Arrangement model

A Clip stores `trackId`, `scratchId`, `startBeat`, `lengthBeats`, and `sourceOffsetBeats`.

For drum and synth clips, extending `lengthBeats` past the source pattern length repeats the pattern modulo its natural length (one bar of drums; the motif's declared bar count). Recorded audio clips are bounded by remaining source duration; audio is never time-stretched.

Snipping is non-destructive via source offsets. Snap resolution applies to placement, movement, resize, stepping, loop endpoints, and ruler drags.

### Synth composer

`MotifEditor` renders notes as absolutely-positioned elements over a CSS grid canvas. Background taps add notes (tap-vs-scroll disambiguation by movement threshold); note bodies and resize edges use dedicated pointer handlers with `touch-action: none`. An inspector exposes exact pitch/start/length plus deletion. Keyboard quick-entry writes at a moving cursor using the selected note length; **Rest ›** advances the cursor without writing.

Scale presets generate pad layouts from root + intervals + octave; per-pad overrides (`keyLayout`) pin exact MIDI notes and persist on the Scratch.

### Loop transport + recording

Unchanged state machine: warm-up lap → capture marks at loop boundaries → Auto Scratch slices the continuous PCM stream into independent WAV takes (max 12/session). Record outside loops fills the selected blank recording slot if one exists.

Pause/Stop ends an active session. Browser event scheduling is not sample-accurate; real-device boundary testing remains important.

### Audio

Web Audio powers kits, metronome, synth, processed playback of recordings, and waveform decoding.

- **Kits** are data-driven voice profiles (`KIT_PROFILES`); Club and Modern join Pocket/Dust/Machine. All synthesis, no samples.
- **Compression**: single-stage route preserved; multi-stage route = fast peak stage → glue stage → safety limiter, all scaled by the existing Compression amount (+ modest makeup). Route composition is described by a pure function (`compressionRouteStages`) shared/tested independently of Web Audio.
- **Decoded-buffer cache** keyed by blob ID avoids repeated decoding of the same take during waveforms/audition/arrangement playback (LRU-ish, 32 entries).

Processing is strictly playback-time; stored recordings remain clean.

### Local-first persistence

Project JSON in `localStorage` (debounced autosave); audio blobs in IndexedDB. `normalizeProject()` migrates v1/v2/v3 documents to v4 at load/import/Drive-open time and falls back to a fresh project for malformed input. Migration preserves synth notes, audio blob IDs, Drive references, and clips; legacy `beatsPerBar` becomes an explicit time signature and drum rows are resized/re-mapped to the new steps-per-bar.

### Google Drive

Optional durable copy using only `drive.file`. Flows:

1. **Sync** creates/updates `project.json`, audio files, and `scratchtrack.pack` under a per-project folder.
2. **Share project** copies a Scratchtrack link containing only the folder ID and opens Drive for permission management.
3. **Open Drive link** accepts *standard* Google folder share links (`drive.google.com/drive/folders/<id>…`), multi-account/mobile variants, Scratchtrack links, or bare IDs (`parseDriveFolderLink`). After connecting the user's own account, Scratchtrack tries direct access; if Google has not yet granted `drive.file` access to that shared folder, the Picker opens pre-positioned at that folder for a one-time confirmation.

Standard Google sharing decides human access. Scratchtrack never requests broader OAuth scope and holds no accounts.

Token expiry surfaces a reconnect state; local work is never discarded on Drive failure.

## Project data rules

- Project JSON never embeds audio.
- A timeline Clip references a Scratch ID; multiple Clips may share a Scratch.
- Audio is stored once per Scratch.
- Moving/copying/repeating/snipping Clips only changes JSON references.
- Waveforms are regenerated locally instead of stored as redundant media.
- Musical edits update local state before any remote sync begins; remote errors never discard local copies.
- Loop take capture creates new Scratches rather than destructively replacing prior takes.
- Scratch creation/duplication always allocates fresh nested containers (see `project.ts`).

## GitHub Pages

Vite is configured with `/scratchtrack/` as the base URL. The service worker, manifest, and Pages workflow use the same path. The GitHub Actions workflow typechecks, tests, and builds on pull requests, then deploys only from `main`.
