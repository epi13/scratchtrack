# Scratchtrack

**A shared musical scratchpad for ideas worth keeping.**

[![MNCS pressure boundary](docs/mncs-badge.svg)](docs/mncs-pressure.md)

Scratchtrack is a lightweight, browser-based 8-track workspace for quickly capturing, arranging, looping, and exchanging beats, MIDI motifs, bass lines, rough recordings, and song ideas.

> **Core principle: capture an idea in under thirty seconds.**

Scratchtrack deliberately sits between a voice memo and a DAW. It should be structured enough to develop a song, but simple enough that recording an idea never turns into a production session.

## What works now

- Fixed **8-track** arrangement: Drums, Synth, Bass, Audio 1–5
- Context-sensitive editor above the timeline with a common **Scratch action strip**: **＋ New Scratch**, **⧉ Duplicate Scratch**, and **Place @ Playhead** on every track
- Expressive drum sequencer with accent velocity, **five synthesized kits** (Pocket, Dust, Machine, **Club**, **Modern/Sub**)
- **Drum subdivision**: 1/4 through 1/32 including 1/8- and 1/16-note triplets — pattern length follows *time signature × subdivision*, and changing subdivision re-maps existing hits to their closest musical positions
- Switchable **Grid / Geometry** drum creation views that edit the exact same pattern data; both adapt to any step count
- Drum controls for swing, humanize, output, punch, and brightness
- **Real time signatures**, not just 4/4: any numerator × denominator of 2/4/8/16 (4/4, 5/4, 7/8, 11/8, 13/16 …). The bar ruler, metronome accents, snapping, loop boundaries, drum pattern length, synth motif lengths, and playback wrapping all follow the meter
- Two-oscillator analog-style Web Audio synth with a real **motif composer**: tap-to-place piano-roll editing with move/resize/delete, rests, snap to 1/4–1/32 (including triplets), exact pitch/start/length inspectors, and motif lengths from 1 to 8 bars
- **Key / Scale / Octave system**: every tonic, a broad scale library (modes, pentatonics, blues, harmonic minor families, Japanese and other scales) plus Custom intervals — and every individual keyboard pad can still be remapped to an exact MIDI note, stored per Scratch
- Mono browser recording for bass and general audio tracks, stored as independently playable WAV files
- **Multi-stage compression** toggle for Bass/Audio: serial peak → glue → safety-limiter chain scaled by the existing Compression control. Non-destructive; identical on audition and arrangement playback
- Persisted audio-track mix settings for trim, tone, compression mode, volume, pan, and space
- A decoded waveform for the **currently selected audio Scratch** directly below the track controls (decoded buffers are cached)
- Local-first project autosave plus IndexedDB audio blobs
- Scratch audition, notes, placement, deletion, and deliberate drag-to-timeline controls
- Timeline clips can be **selected, moved, resized, snipped, copied, pasted, duplicated, and deleted**
- Drum and synth clips repeat their source pattern when stretched longer
- Audio clips preserve source offsets when snipped so both halves play the correct portion of the original take
- Adjustable arrangement snapping: **Off, 1/32, 1/16, 1/8, Beat (1/4), 2 beats (1/2), or Whole bar**
- The same selected snap resolution applies to clip edits, playhead stepping, Set In/Out, and ruler-drag loop selection
- Live position/delta feedback while moving clips
- Loop In / Out points that are **directly editable as bar.beat values** (arrow keys step by the current snap), with a visible loop region
- Tap the bar ruler to set the playhead; drag across the ruler to create a custom multi-bar loop range
- Loop recording always starts with one full **warm-up pass** where nothing is recorded
- **Auto Scratch is on by default**; every completed pass after warm-up becomes a separate Scratch
- Auto Scratch stops after **12 takes per loop recording session**
- Record fills a selected blank recording slot instead of stacking another Scratch; loop sessions always create new takes
- Touch-safe timeline behavior: lane swipes scroll, clip bodies select, and dedicated move/resize handles perform edits on phones
- Pinch zoom remains available through the primary arrangement and Scratch surfaces
- Project JSON import/export with automatic v1/v2/v3 → v4 migration
- Optional Google Drive connection, Sync, Share project, **paste-a-standard-folder-link open flow**, and Open shared project (Google Picker)
- PWA manifest/service worker for installable phone/desktop use
- GitHub Actions build and GitHub Pages deployment

## Tracks

1. **Drums** — expressive pattern sequencer and five compact drum kits
2. **Synth** — built-in analog-style MIDI instrument + motif composer
3. **Bass** — DI-oriented recording and mix controls
4. **Audio 1** — general audio
5. **Audio 2** — general audio
6. **Audio 3** — general audio
7. **Audio 4** — general audio
8. **Audio 5** — general audio

A **Scratch** is an alternate take or variation. A **Clip** is a reference to a Scratch placed on the arrangement timeline, so repeating or editing an idea does not duplicate its underlying recording.

### The basic songwriting loop

Every track editor leads with the same three actions:

1. **Select a track** → press **＋ New Scratch** (clean idea; useful sound configuration such as kit, patch, or scale layout carries over).
2. **Edit or record it** (drum grid/geometry, motif composer + keys, or the microphone).
3. Press **Place @ Playhead** to drop it into the arrangement at the playhead, then keep going.

Use **Duplicate Scratch** when you deliberately want to start from the current pattern/motif. Scratches are strictly independent: creating, duplicating, or editing one can never mutate another.

## Time signatures and drum subdivision

The project stores an explicit meter (`numerator/denominator`, denominators 2/4/8/16) while the timeline itself stays in quarter-note beats:

`barLength = numerator × (4 ÷ denominator)` → 4/4 = 4 beats, 7/8 = 3.5, 11/8 = 5.5, 13/16 = 3.25.

The transport runs on a fixed 1/24-beat tick grid so every supported value — quarter notes, eighths, triplet eighths/sixteenths, and 1/32s — lands exactly on ticks in any meter.

Each drum Scratch stores its own **subdivision**. Pattern rows are exactly `stepsPerBar = barLength ÷ subdivisionValue` long (4/4 at 1/16 → 16 steps, 7/8 at 1/16 → 14, 5/4 at 1/8 → 10, 4/4 at 1/8-triplets → 12). Subdivision combinations that cannot align to the tick grid are disabled rather than silently rounded. Changing the meter or subdivision re-maps existing hits to their nearest equivalent positions instead of wiping them.

Swing delays every second binary step (or third triplet step); the metronome accents bar starts and clicks quarters regardless of meter.

## Drum kits

Five data-driven synthesized kits, shared by Grid and Geometry views:

- **Pocket / Dust / Machine** — the original characters
- **Club** — round acoustic/electronic kick, realistic snare body, controlled transient
- **Modern** — bass-heavy sub kick with saturation, punchy modern snare, crisp hats

Everything is Web Audio synthesis; no samples are bundled.

## Synth: motif composer + key system

The motif composer is a compact, touch-first piano roll:

- Tap empty space to add a note; drag note bodies to move (pitch + time); drag the right edge to resize; use the inspector (or the × badge) for exact MIDI pitch, start, length, and deletion
- Snap options: Free, 1/4, 1/8, 1/8T, 1/16, 1/32; motif length 1–8 bars
- Rests: advance the green write cursor without adding a note (**Rest ›**)
- Keyboard quick-entry writes into the timeline at the cursor using the chosen note length

Key/Scale/Octave presets generate the playable pads; the library covers major/minor modes, harmonic and melodic minor families, pentatonics, blues, symmetric scales, Phrygian dominant, double harmonic, Hungarian minor, Persian, Hirajoshi, Insen, Iwato, Yo, Egyptian, plus **Custom** intervals. Any pad can be remapped to any exact MIDI note via its ⋯ button; overrides persist with the Scratch and survive duplication.

## Multi-stage compression

Bass and Audio tracks have a single **Multi-stage comp** toggle next to Compression:

- **Off** — the original single compressor, unchanged.
- **On** — a serial chain: fast peak control → slower glue/leveling → gentle safety limiter. The existing Compression amount scales thresholds/ratios and adds modest makeup gain.

Processing happens only during playback (both audition and arrangement share one code path); stored recordings remain clean.

## Arrangement editing

Tap a clip to select it. On desktop, drag the clip body to move it. On touch devices, use the dedicated **↔ move handle** so ordinary swipes on the arrangement remain available for scrolling. The right-edge handle changes clip duration.

Drum and synth clips loop their source pattern as they grow. Recorded audio clips are trimmed rather than time-stretched.

The edit toolbar supports an adjustable **Snap** selector (Off / 1/32 / 1/16 / 1/8 / Beat / 2 beats / Whole bar). The chosen resolution applies consistently to clip placement, movement, resizing, playhead stepping, Set In / Out stepping, and ruler-drag loop selection. While moving a clip, Scratchtrack displays the exact target position and movement delta.

Loop In / Out show editable `bar.beat` fields — type a position (e.g. `1.1`, `7.3`) or focus the field and use ↑/↓ to step by the current snap resolution. Invalid entries revert with a visible error state.

The rest of the edit toolbar supports **Snip @ playhead**, **Copy / Paste**, **Duplicate**, and **Delete**. Desktop shortcuts mirror the basics: `Cmd/Ctrl+C`, `Cmd/Ctrl+V`, `Cmd/Ctrl+D`, Delete/Backspace.

## Loop selection

- **Tap** the ruler to place the playhead.
- **Drag** across the ruler to define a contiguous custom loop range spanning one or many bars.
- **Set In / Set Out** set points from the playhead; the adjacent fields edit either point directly.
- The current **Snap** setting determines selection granularity.

Track lanes do not reposition the playhead when touched.

## Loop recording + Auto Scratch

Unchanged in spirit:

1. Define a loop and leave **Auto Scratch On** (the default).
2. Select Bass or an Audio track and press **Record loop**.
3. The arrangement starts playing from Loop In; the first lap is warm-up only.
4. Every completed loop becomes its own WAV Scratch (`Loop 01`, `Loop 02` …), up to 12 per session.
5. Turn **Auto Scratch Off** for one continuous take instead.

New: pressing **Record** outside a loop fills the currently selected blank recording slot if there is one (create it with **＋ New Scratch** first), otherwise it creates a fresh Scratch as before.

## Using Google Drive with a collaborator

Scratchtrack works without Drive. When Drive is connected, the browser talks directly to Google — there is no Scratchtrack server holding music or credentials.

Two kinds of links work in the Drive panel's **Open Drive link** field:

1. **Standard Google Drive folder share links** — the normal `https://drive.google.com/drive/folders/<id>?usp=sharing` link you get from Google's Share dialog. Paste it, connect your own Google account, and Scratchtrack opens the project inside.
2. **Scratchtrack share links** (`…?project=<folder-id>`) produced by the **Share project** button.

Because Scratchtrack uses Google's narrow `drive.file` scope, a pasted URL alone does not grant this website access to a folder someone else owns. When Google requires it, Scratchtrack automatically opens the Picker positioned at that folder; you confirm once and the project loads normally. Standard Drive sharing decides who can read/write — Scratchtrack adds no account system of its own and never requests broad Drive permissions.

Reconnect if the top bar says Google Drive needs you to reconnect — access tokens expire after about an hour.

## Owner setup (once): Google Cloud + GitHub Pages

A Google OAuth **client ID** is public configuration, not a secret. Never create or commit a Google **client secret** for Scratchtrack.

### A. Google Cloud

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. APIs & Services → Library: enable **Google Drive API** and **Google Picker API**.
3. APIs & Services → OAuth consent screen:
   - User type **External**.
   - App name `Scratchtrack`.
   - Add your email as developer contact.
   - Scopes: `https://www.googleapis.com/auth/drive.file` only.
   - Until Google verifies the app, add your Google account and your collaborator's account as **Test users**.
4. APIs & Services → Credentials → Create credentials → **OAuth client ID** → application type **Web application**.
   - Name it `Scratchtrack web`.
   - Authorized JavaScript origins (no path):
     - `https://epi13.github.io`
     - `http://localhost:5173`
     - `http://127.0.0.1:5173`
   - Copy the **Client ID** (`….apps.googleusercontent.com`). Ignore or delete any client secret if Google shows one.
5. Credentials → Create credentials → **API key**. Restrict it:
   - Application restrictions: HTTP referrers, same origins as above.
   - API restrictions: Google Picker API and Google Drive API.
6. Optional: Project Settings → copy the numeric **project number** for `VITE_GOOGLE_APP_ID`.

### B. GitHub Pages build settings

1. Repo Settings → Secrets and variables → Actions → add:
   - `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, optional `VITE_GOOGLE_APP_ID`
2. Redeploy by pushing to `main` or running the **Build and deploy Scratchtrack** workflow.
3. Confirm `https://epi13.github.io/scratchtrack/` shows **Connect Google Drive**.

### C. Local development

```bash
cp .env.example .env.local
```

Put the same three `VITE_` values in `.env.local`. That file is gitignored.

The Drive implementation creates a `Scratchtrack` folder, one subfolder per project, `project.json`, one audio file per recorded Scratch, and `scratchtrack.pack` for collaborator open-via-Picker.

## Design rules

- Capture should be faster than setup.
- Eight tracks are a feature, not a temporary limitation.
- Every Scratch is fully independent musical data; duplication produces deep copies.
- The first loop lap is preparation, not a take.
- Multiple visual interfaces may edit the same musical data when the alternate view adds a genuinely different creative way to think about the music.
- Touch, mouse, and pen should express the same concepts without sacrificing ordinary phone scrolling or pinch zoom.
- Musical data stays editable; audio is stored once and referenced.
- Local work must survive a network or OAuth failure.
- Scratchtrack is **not a DAW**.

## MNCS pressure boundary

The rhythmic, arrangement, migration, geometry, container, text, and
checksum kernels live in MNCS (`mncs/*.mncs`) as the semantic
authority, execute in production as compiled zero-import WASM
(`public/mncs/`, loaded at boot with conformance-pinned TypeScript
fallback), and are proven by corpus on two backends. The badge above
is rendered by `mncs-actions` from the `mncs-verify` workflow verdict
— never hand-edited. Details: [`docs/mncs-pressure.md`](docs/mncs-pressure.md)
(pressure log, ownership, unlock graph),
[`docs/mncs-boundary.md`](docs/mncs-boundary.md) (boundary claim),
[`docs/fabric-log.md`](docs/fabric-log.md) (Fabric cross-checks).

## Documentation

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/project-format.md`](docs/project-format.md)
- [`docs/roadmap.md`](docs/roadmap.md)
- [`docs/testing.md`](docs/testing.md)

## License

Apache-2.0
