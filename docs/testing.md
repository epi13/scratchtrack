# Testing Scratchtrack

Scratchtrack should be tested as a musical notebook, not only as a static page.

## Core smoke test

1. Load the app with an empty browser profile.
2. Confirm the eight fixed tracks render and the Drums editor is selected.
3. Change drum steps through off → hit → accent → off, adjust Swing/Human/Punch/Brightness, and preview the pattern.
4. Select Synth, enable **Write motif**, play several on-screen notes, change filter/envelope/LFO controls, place the Scratch, and run transport.
5. Open a Bass or Audio track, grant microphone permission, record a short Scratch, audition it, and place it on the timeline.
6. Confirm pressing Record also starts the main arrangement transport.
7. Refresh the page and confirm project structure and recorded audio still exist locally.
8. Select the recorded Scratch and confirm a recognizable waveform appears below the audio controls.
9. Toggle mute and solo while the arrangement is playing.
10. Export the project JSON, change the project, then import the exported project again.

## Arrangement editing smoke test

1. Place at least two clips on a track.
2. Tap a clip and verify the editing toolbar shows it as selected.
3. With **Snap 1/32** on, move a clip and confirm the live position readout advances in 0.125-beat increments.
4. Turn Snap off and confirm movement can land between snapped subdivisions.
5. On desktop, drag the clip body. On touch, use only the **↔ move handle**.
6. Drag the clip's right-edge handle to resize it.
7. For a drum clip, stretch beyond four beats and confirm playback repeats the same source pattern rather than changing the Scratch.
8. Move the playhead inside a selected clip and press **Snip @ playhead**. Confirm two clips remain and the right side starts at the split point.
9. For recorded audio, verify the right-hand piece plays from the corresponding source offset rather than replaying from the beginning.
10. Copy and Paste the selected clip at a new playhead position.
11. Duplicate and delete clips; confirm deleting a Clip does not delete its Scratch.
12. On desktop, repeat Copy/Paste/Duplicate/Delete using the documented keyboard shortcuts.

## Loop range smoke test

1. Use the top transport scrubber to move the playhead.
2. Tap the bar ruler at another position and confirm the playhead moves there.
3. Drag across several bars on the ruler and confirm a loop range appears spanning the drag.
4. Confirm Loop is enabled automatically when a ruler drag creates a range.
5. Confirm **Set In / Set Out** can still refine the range using the current playhead.
6. Start playback and confirm transport wraps from Loop Out to Loop In.
7. Confirm tapping or swiping empty track lanes does **not** reposition the playhead.

## Loop + Auto Scratch recording smoke test

1. Define a loop of at least two bars.
2. Confirm **Auto Scratch On** is the default state after creating or migrating a project.
3. Select Bass or an Audio track and press **Record loop**.
4. Confirm the arrangement begins playing from Loop In immediately.
5. During the first complete lap, confirm the UI says **Warm-up** and no Scratch is created.
6. At the first wrap back to Loop In, confirm capture begins automatically.
7. Let three more loops complete and verify `Loop 01`, `Loop 02`, and `Loop 03` exist independently.
8. Confirm each take can be selected, **Hear**’d, and viewed as a separate waveform. A failed take must show a playback/format error rather than silence.
9. Let the session run to 12 captured loops and confirm it stops creating/recording takes after `Loop 12` without deleting older Scratches.
10. Confirm arrangement playback may continue after the 12-take recorder stops.
11. Start another loop recording session, then press the main Pause or Stop control and confirm the recording session also ends.
12. Turn **Auto Scratch Off**, begin another loop recording, confirm the same first-lap warm-up occurs, then confirm only one continuous Scratch is produced when recording is stopped.

## iPhone / touch regression test

Test on a current iPhone/Safari device or the closest available WebKit mobile environment.

1. At normal zoom, swipe horizontally over empty lanes and directly over clip bodies. The arrangement should scroll instead of immediately moving clips.
2. Swipe vertically while the timeline is visible and confirm page scrolling still works.
3. Pinch zoom over the arrangement, Scratch drawer, and editor surfaces. Zoom should not be blocked by broad `touch-action: none` regions.
4. Tap a clip body: it may select, but must not move from a normal tap/swipe.
5. Use the **↔ move handle** and confirm the clip moves while a live position/delta readout is visible.
6. Use the right-edge resize handle and confirm resizing remains deliberate.
7. Swipe the Scratch drawer without accidentally dragging a Scratch. Use the explicit **Drag** button when drag-to-timeline behavior is desired.
8. At roughly 390 px viewport width, confirm editor control banks scroll horizontally, important buttons remain finger-sized, and the timeline does not collapse.

## Waveform smoke test

1. Record a Scratch with obvious loud/quiet sections.
2. Select it in the Scratch drawer.
3. Confirm the waveform decodes locally and shows visible amplitude variation.
4. Select a different audio Scratch and confirm the waveform switches.
5. Delete the active Scratch and confirm the waveform switches to the next active Scratch or the empty state.
6. Refresh and confirm IndexedDB-backed waveforms can be regenerated without Drive access.

## Drive smoke test

Drive testing requires the owner one-time Google Cloud + GitHub Pages setup in the README. Musicians should not paste OAuth client IDs during normal use.

1. Click **Connect Google Drive** and sign in with your Google account.
2. Confirm the panel shows a connected status, then **Sync**.
3. In Drive, confirm a `Scratchtrack` folder exists with a per-project folder, `project.json`, audio files, and `scratchtrack.pack`.
4. **Share project**: the Scratchtrack link is copied (folder ID only) and the Drive folder opens so you can invite a collaborator as an editor.
5. As the collaborator, open that link, connect with a *different* Google account, and **Open this shared project**. Complete the Google Picker prompt.
6. Edit locally and sync again; existing named files should update rather than multiply.
7. Wait for the access token to expire (or disconnect and reconnect) and confirm **Reconnect Google Drive** restores access.

Never place an OAuth client secret in this public repository.

## Browser targets

The useful compatibility floor is current Chrome/Edge desktop, current Safari desktop, Chrome on Android, and Safari on iPhone. Recordings are stored as standalone 16-bit WAV files so Hear, waveforms, and arrangement playback do not depend on WebM/MP4 fragment decoding.

Auto Scratch slices a continuous PCM capture at loop boundaries, then encodes each take independently. Loop boundary timing still deserves real-device testing because browser event scheduling is not sample-accurate.
