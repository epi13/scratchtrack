# Scratchtrack

**A shared musical scratchpad for ideas worth keeping.**

Scratchtrack is a lightweight, browser-based 8-track workspace for quickly capturing, arranging, looping, and exchanging beats, MIDI motifs, bass lines, rough recordings, and song ideas.

> **Core principle: capture an idea in under thirty seconds.**

Scratchtrack deliberately sits between a voice memo and a DAW. It should be structured enough to develop a song, but simple enough that recording an idea never turns into a production session.

## What works now

- Fixed **8-track** arrangement: Drums, Synth, Bass, Audio 1–5
- Context-sensitive editor above the timeline
- Expressive 16-step drum sequencer with accent velocity and three compact synthesized kits
- Switchable **Grid / Geometry** drum creation views that edit the exact same pattern data
- Circular geometric drum sequencing with connected rhythmic shapes for Kick, Snare, Hat, and Open Hat
- Drum controls for swing, humanize, output, punch, and brightness
- Two-oscillator analog-style Web Audio synth with editable motifs
- Expanded synth controls: detune, cutoff, resonance, ADSR-like envelope, drive, and filter LFO
- Mono browser recording for bass and general audio tracks, stored as independently playable WAV files
- Persisted audio-track mix settings for trim, tone, compression, volume, pan, and space
- A decoded waveform for the **currently selected audio Scratch** directly below the track controls
- Local-first project autosave plus IndexedDB audio blobs
- Scratch audition, notes, placement, deletion, and deliberate drag-to-timeline controls
- Timeline clips can be **selected, moved, resized, snipped, copied, pasted, duplicated, and deleted**
- Drum and synth clips repeat their source pattern when stretched longer
- Audio clips preserve source offsets when snipped so both halves play the correct portion of the original take
- Adjustable arrangement snapping: **Off, 1/32, 1/16, 1/8, Beat (1/4), 2 beats (1/2), or Whole bar**
- The same selected snap resolution applies to clip edits, playhead stepping, Set In/Out, and ruler-drag loop selection
- Live position/delta feedback while moving clips
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
- Optional Google Drive connection, Sync, Share project, and Open shared project (Google Picker)
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

## Drum creation views

The drum editor has two interchangeable ways to create the same four-voice, 16-step pattern:

- **Grid** — the direct step-sequencer view.
- **Geometry** — each drum voice is arranged around a circular 16-step orbit. Active hits are connected in sequence, turning the rhythm into a geometric figure. Accents are visually stronger nodes.

Nothing is converted when switching views. A Kick hit placed at step 5 in Grid is the same Kick hit at node 5 in Geometry, and edits made in either view appear immediately in the other. The preferred drum view is remembered locally in the browser.

## Arrangement editing

Tap a clip to select it. On desktop, drag the clip body to move it. On touch devices, use the dedicated **↔ move handle** so ordinary swipes on the arrangement remain available for scrolling. The right-edge handle changes clip duration.

Drum and synth clips loop their source pattern as they grow. Recorded audio clips are trimmed rather than time-stretched.

The edit toolbar supports an adjustable **Snap** selector with:

- **Off** — free movement to hundredth-beat precision
- **1/32 note**
- **1/16 note**
- **1/8 note**
- **Beat / 1/4 note** — the practical default
- **2 beats / 1/2 note**
- **Whole bar** — follows the project's beats-per-bar setting

The chosen resolution applies consistently to clip placement, movement, resizing, playhead stepping, Set In / Set Out, and ruler-drag loop selection. While moving a clip, Scratchtrack displays the exact target position and movement delta.

The rest of the edit toolbar supports **Snip @ playhead**, **Copy / Paste**, **Duplicate**, and **Delete**. Desktop shortcuts mirror the basic operations: `Cmd/Ctrl+C`, `Cmd/Ctrl+V`, `Cmd/Ctrl+D`, and Delete/Backspace. Visible controls remain the primary interface so the workflow also works on a phone.

## Loop selection

The main transport scrubber remains the primary fine playhead control. The bar/measure ruler above the tracks is also interactive:

- **Tap** the ruler to place the playhead.
- **Drag** across the ruler to define a contiguous custom loop range spanning one or many bars.
- **Set In / Set Out** remain available in the transport for precise manual endpoints.
- The current **Snap** setting determines how finely or coarsely the selection locks to musical time.

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

Auto Scratch captures a continuous PCM stream and encodes each completed loop as its own WAV file. Takes stay gapless at the capture layer and each Scratch is independently decodable on Chromium and Safari.

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
npm test
npm run build
```

The Vite base path is configured for GitHub Pages at `/scratchtrack/`.

## Using Google Drive with a collaborator

Scratchtrack works without Drive. When Drive is connected, the browser talks directly to Google — there is no Scratchtrack server holding music or credentials.

Normal musician flow (after the owner setup below):

1. Click **Connect Google Drive** and sign in with your own Google account.
2. Click **Sync** to save this idea to Drive.
3. Click **Share project**. Scratchtrack copies a share link (it contains only a Drive folder ID, never a password or token) and opens the Drive folder.
4. In Google Drive, share that folder with your collaborator as an **Editor** if you both want to save changes.
5. Send them the Scratchtrack link.
6. They open the link, click **Connect Google Drive** with *their* Google account, then **Open this shared project**. Google Picker asks them to choose the shared folder once. That is required: a static website using Google’s narrow `drive.file` permission cannot silently open someone else’s files from an ID alone.

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
   - Until Google verifies the app, add your Google account and your collaborator’s account as **Test users**.
4. APIs & Services → Credentials → Create credentials → **OAuth client ID** → application type **Web application**.
   - Name it `Scratchtrack web`.
   - Authorized JavaScript origins (no path):
     - `https://epi13.github.io`
     - `http://localhost:5173`
     - `http://127.0.0.1:5173`
   - Authorized redirect URIs are not required for this token flow.
   - Copy the **Client ID** (`….apps.googleusercontent.com`). Ignore or delete any client secret if Google shows one — do not put it in GitHub.
5. Credentials → Create credentials → **API key**. Restrict it:
   - Application restrictions: HTTP referrers, same origins as above.
   - API restrictions: Google Picker API and Google Drive API.
6. Optional: Project Settings → copy the numeric **project number**. Google Picker can use it as `VITE_GOOGLE_APP_ID`.

### B. GitHub Pages build settings

1. In the `epi13/scratchtrack` GitHub repo: Settings → Secrets and variables → Actions → New repository secret.
2. Add:
   - `VITE_GOOGLE_CLIENT_ID` = the OAuth client ID from step A.4
   - `VITE_GOOGLE_API_KEY` = the browser API key from step A.5
   - `VITE_GOOGLE_APP_ID` = the project number from step A.6 (optional)
3. Redeploy by pushing to `main` or running the **Build and deploy Scratchtrack** workflow. Vite inlines these values at build time.
4. After deploy, confirm `https://epi13.github.io/scratchtrack/` shows **Connect Google Drive** rather than asking musicians to paste OAuth configuration.

### C. Local development

```bash
cp .env.example .env.local
```

Put the same three `VITE_` values in `.env.local`. That file is gitignored.

The current Drive implementation creates a `Scratchtrack` folder, one subfolder per project, `project.json`, one audio file per recorded Scratch, and `scratchtrack.pack` for collaborator open-via-Picker.

## Design rules

- Capture should be faster than setup.
- Eight tracks are a feature, not a temporary limitation.
- Scratches should encourage experiments without becoming an archive dump.
- The first loop lap is preparation, not a take.
- Auto Scratch should be automatic unless the musician explicitly turns it off.
- Multiple visual interfaces may edit the same musical data when the alternate view adds a genuinely different creative way to think about the music.
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
