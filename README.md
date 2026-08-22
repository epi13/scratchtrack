# Scratchtrack

**A shared musical scratchpad for ideas worth keeping.**

Scratchtrack is a lightweight, browser-based 8-track workspace for quickly capturing, arranging, looping, and exchanging beats, MIDI motifs, bass lines, rough recordings, and song ideas.

> **Core principle: capture an idea in under thirty seconds.**

Scratchtrack deliberately sits between a voice memo and a DAW. It should be structured enough to develop a song, but simple enough that recording an idea never turns into a production session.

## What works now

- Fixed **8-track** arrangement: Drums, Synth, Bass, Audio 1–5
- Context-sensitive editor above the timeline
- Expressive 16-step drum sequencer with accent velocity and three compact synthesized kits
- Drum controls for swing, humanize, output, punch, and brightness
- Two-oscillator analog-style Web Audio synth with editable motifs
- Expanded synth controls: detune, cutoff, resonance, ADSR-like envelope, drive, and filter LFO
- Mono browser recording for bass and general audio tracks
- Persisted audio-track mix settings for trim, tone, compression, volume, pan, and space
- A decoded waveform for the **currently selected audio Scratch** directly below the track controls
- Local-first project autosave plus IndexedDB audio blobs
- Scratch audition, notes, placement, deletion, and deliberate drag-to-timeline controls
- Timeline clips can be **selected, moved, resized, snipped, copied, pasted, duplicated, and deleted**
- Drum and synth clips repeat their source pattern when stretched longer
- Audio clips preserve source offsets when snipped so both halves play the correct portion of the original take
- More granular clip movement with a **Snap 1/32 / Off** toggle and live position/delta feedback
- Loop In / Out points with a visible loop region
- Tap the bar ruler to set the playhead; drag across the ruler to create a custom multi-bar loop range
- Loop recording always starts with one full **warm-up pass** where nothing is recorded
- **Auto Scratch is on by default**; every completed pass after warm-up becomes a separate Scratch
- Auto Scratch stops after **12 takes per loop recording session**
- Record starts the same main playback transport, so the arrangement plays while a Scratch is being recorded
- Pause/Stop on the main transport also ends an active recording session
- Touch-safe timeline behavior: lane swipes scroll, clip bodies select, and dedicated move/resize handles perform edits on phones
- Pinch zoom remains available through the primary arrangement and Scratch surfaces
- Project JSON import/export with automatic v1/v2 → v3 migration
- Optional Google Drive connection and direct project/audio sync scaffold
- PWA manifest/service worker for installable phone/desktop use
- GitHub Actions build and GitHub Pages deployment

## Tracks

1. **Drums** — expressive pattern sequencer and compact drum kits
2. **Synth** — built-in analog-style MIDI instrument
3. **Bass** — DI-oriented recording and mix controls
4. **Audio 1** — general audio
5. **Audio 2** — general audio
6. **Audio 3** — general audio
7. **Audio 4** — general audio
8. **Audio 5** — general audio

A **Scratch** is an alternate take or variation. A **Clip** is a reference to a Scratch placed on the arrangement timeline, so repeating or editing an idea does not duplicate its underlying recording.

## Arrangement editing

Tap a clip to select it. On desktop, drag the clip body to move it. On touch devices, use the dedicated **↔ move handle** so ordinary swipes on the arrangement remain available for scrolling. The right-edge handle changes clip duration.

Drum and synth clips loop their source pattern as they grow. Recorded audio clips are trimmed rather than time-stretched.

The edit toolbar supports:

- **Snap 1/32 / Off**
- **Snip @ playhead**
- **Copy** / **Paste**
- **Duplicate**
- **Delete**

While moving a clip, Scratchtrack displays the exact target position and movement delta. Desktop shortcuts mirror the basic operations: `Cmd/Ctrl+C`, `Cmd/Ctrl+V`, `Cmd/Ctrl+D`, and Delete/Backspace. Visible controls remain the primary interface so the workflow also works on a phone.

## Loop selection

The main transport scrubber remains the primary fine playhead control. The bar/measure ruler above the tracks is also interactive:

- **Tap** the ruler to place the playhead.
- **Drag** across the ruler to define a contiguous custom loop range spanning one or many bars.
- **Set In / Set Out** remain available in the transport for precise manual endpoints.

Track lanes themselves no longer reposition the playhead when touched. That removes one of the biggest conflicts between timeline editing and normal phone scrolling.

## Loop recording + Auto Scratch

Loop recording is intentionally simple:

1. Define a loop and leave **Auto Scratch On** (the default).
2. Select Bass or an Audio track and press **Record loop**.
3. The arrangement starts playing from Loop In.
4. The **first full loop is warm-up only** — no file is created.
5. Capture begins automatically when the transport returns to Loop In.
6. Every completed loop becomes `Loop 01`, `Loop 02`, and so on.
7. A single session can create up to **12 loop Scratches**, then recording stops automatically while playback may continue.

Auto Scratch uses one continuous `MediaRecorder` and requests a data boundary at each loop completion rather than stopping and reconstructing the recorder on every pass. This reduces browser-dependent gaps between takes.

Turn **Auto Scratch Off** for a simpler single recording after the same warm-up lap. The recorder then keeps running until you stop it rather than creating one Scratch per loop.

The general per-track Scratch safety cap remains larger than one loop session so a 12-take session does not have to replace existing ideas. Delete obvious misses as you go to keep the drawer useful.

## Selected Scratch waveform

Bass and Audio editors show a waveform for the currently active Scratch. Selecting another Scratch in that track's drawer immediately switches the waveform. Waveform peaks are decoded locally from the stored IndexedDB audio; no upload is required.

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

The current Drive implementation creates a `Scratchtrack` folder and uploads `project.json` plus each recorded audio Scratch. Google Picker and revision-aware two-person collaboration remain the next major collaboration milestone.

## Design rules

- Capture should be faster than setup.
- Eight tracks are a feature, not a temporary limitation.
- Scratches should encourage experiments without becoming an archive dump.
- The first loop lap is preparation, not a take.
- Auto Scratch should be automatic unless the musician explicitly turns it off.
- Touch, mouse, and pen should express the same concepts without sacrificing ordinary phone scrolling or pinch zoom.
- Musical data stays editable; audio is stored once and referenced.
- Local work must survive a network or OAuth failure.
- Arrangement editing should stay direct and tactile rather than growing into a DAW tool matrix.
- Scratchtrack is **not a DAW**.

## Documentation

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/project-format.md`](docs/project-format.md)
- [`docs/roadmap.md`](docs/roadmap.md)
- [`docs/testing.md`](docs/testing.md)

## License

Apache-2.0
