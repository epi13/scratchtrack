# Testing Scratchtrack

Scratchtrack should be tested as a musical notebook, not only as a static page.

## Core smoke test

1. Load the app with an empty browser profile.
2. Confirm the eight fixed tracks render and the Drums editor is selected.
3. Change several drum steps through off → hit → accent → off and preview the pattern.
4. Select Synth, enable **Write motif**, play several on-screen notes, place the Scratch, and run the transport.
5. Open a Bass or Audio track, grant microphone permission, record a short Scratch, audition it, and place it on the timeline.
6. Refresh the page and confirm project structure and recorded audio still exist locally.
7. Drag a Scratch onto its timeline lane using a mouse and repeat with touch emulation or a real touch device.
8. Toggle mute and solo while the arrangement is playing.
9. Export the project JSON, change the project, then import the exported project again.
10. At 390 px viewport width, confirm the contextual editor remains usable and the timeline scrolls horizontally rather than collapsing.

## Drive smoke test

Drive testing requires a Google OAuth Web application client whose authorized JavaScript origins include the deployed GitHub Pages origin.

1. Add the OAuth client ID in the Drive panel.
2. Connect and grant the requested `drive.file` scope.
3. Sync a project with at least one recorded audio Scratch.
4. In Drive, confirm a `Scratchtrack` folder exists with a per-project folder, `project.json`, and the audio file.
5. Edit locally and sync again; existing named files should update rather than multiply.

Never place an OAuth client secret in this public repository.

## Browser targets

The first useful compatibility floor is current Chrome/Edge desktop, current Safari desktop, Chrome on Android, and Safari on iPhone. Recording format is selected at runtime because MediaRecorder containers differ between browsers.
