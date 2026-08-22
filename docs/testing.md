# Testing Scratchtrack

Scratchtrack should be tested as a musical notebook, not only as a static page.

## Core smoke test

1. Load the app with an empty browser profile.
2. Confirm the eight fixed tracks render and the Drums editor is selected.
3. Change drum steps through off → hit → accent → off, adjust Swing/Human/Punch/Brightness, and preview the pattern.
4. Select Synth, enable **Write motif**, play several on-screen notes, change filter/envelope/LFO controls, place the Scratch, and run transport.
5. Open a Bass or Audio track, grant microphone permission, record a short Scratch, audition it, and place it on the timeline.
6. Refresh the page and confirm project structure and recorded audio still exist locally.
7. Drag a Scratch onto its timeline lane using a mouse and repeat with touch emulation or a real touch device.
8. Toggle mute and solo while the arrangement is playing.
9. Export the project JSON, change the project, then import the exported project again.
10. At 390 px viewport width, confirm editor control banks scroll horizontally, important buttons remain at least finger-sized, and the timeline scrolls rather than collapsing.

## Arrangement editing smoke test

1. Place at least two clips on a track.
2. Tap a clip and verify the editing toolbar shows it as selected.
3. Drag the clip body left/right and confirm its start is quantized to quarter-beat increments.
4. Drag the clip's right-edge handle to resize it.
5. For a drum clip, stretch beyond four beats and confirm playback repeats the same source pattern rather than changing the Scratch.
6. Move the playhead inside a selected clip and press **Snip @ playhead**. Confirm two clips remain and the right side starts at the split point.
7. For recorded audio, verify the right-hand piece plays from the corresponding source offset rather than replaying from the beginning.
8. Copy and Paste the selected clip at a new playhead position.
9. Duplicate the selected clip and confirm a new clip is created after the original where room permits.
10. Delete the selected clip and confirm the underlying Scratch still exists.
11. On desktop, repeat Copy/Paste/Duplicate/Delete using the documented keyboard shortcuts.

## Loop + take capture smoke test

1. Move the playhead to the desired loop start and press **Set In**.
2. Move to the loop end and press **Set Out**.
3. Enable **Loop** and verify the ruler/lane range is highlighted.
4. Start playback and confirm transport wraps back to the loop start at the out point.
5. Select Bass or an Audio track and enable **Take each pass**.
6. Start recording and let the transport complete at least three loops.
7. Stop recording and verify separate `Loop 01`, `Loop 02`, `Loop 03` Scratches are present.
8. Audition the loop Scratches independently and delete an unwanted take.
9. Confirm the recording mode does not silently replace older Scratches.
10. Repeat on Safari/iPhone and Chrome/Android because MediaRecorder boundary behavior is browser-dependent.

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

Loop-take capture deserves special cross-browser attention: the current prototype cuts one MediaRecorder pass at each loop boundary, so small browser-specific boundary gaps are still a known area to tighten before treating loop capture as production-grade recording.
