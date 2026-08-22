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
- Local-first project autosave plus IndexedDB audio blobs
- Up to **24 Scratches** per track so repeated loop takes can be captured without silently replacing older ideas
- Scratch audition, notes, placement, deletion, and pointer drag-to-timeline
- Timeline clips can be **selected, moved, resized, snipped, copied, pasted, duplicated, and deleted**
- Drum and synth clips repeat their source pattern when stretched longer
- Audio clips preserve source offsets when snipped so both halves play the correct portion of the original take
- Loop In / Out points with a visible loop region
- Optional **Take each pass** recording mode: each trip around the active loop becomes a new Scratch until recording is stopped
- Mute, solo, transport, playhead, metronome, and arrangement playback
- Project JSON import/export with automatic v1 → v2 migration
- Optional Google Drive connection and direct project/audio sync scaffold
- PWA manifest/service worker for installable phone/desktop use
- Phone-oriented touch targets and horizontally scrollable control banks
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

Tap a clip to select it. Drag the body to move it. Drag the right-edge handle to change its duration. Drum and synth clips loop their source pattern as they grow; recorded audio clips are trimmed rather than time-stretched.

The edit toolbar supports:

- **Snip @ playhead**
- **Copy** / **Paste**
- **Duplicate**
- **Delete**

Desktop shortcuts mirror the basic operations: `Cmd/Ctrl+C`, `Cmd/Ctrl+V`, `Cmd/Ctrl+D`, and Delete/Backspace. The visible buttons remain the primary interface so the same workflow works on a phone.

## Loop recording

Enable **Loop**, move the playhead to the desired start and choose **Set In**, then set the end with **Set Out**. Playback wraps inside the highlighted region.

When **Take each pass** is enabled on a Bass or Audio track, recording stays armed across the loop. Each completed pass is written as its own `Loop 01`, `Loop 02`, etc. Scratch. Scratchtrack currently keeps a 24-Scratch safety limit per track; delete obvious misses as you go to keep the drawer useful.

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
- Loop-take capture may temporarily create many Scratches; deletion is the intended cleanup mechanism.
- Touch, mouse, and pen should express the same interactions.
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
