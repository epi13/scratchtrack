# Testing Scratchtrack

Scratchtrack should be tested as a musical notebook, not only as a static page.

## Automated checks

```bash
npm test          # vitest: pure music math, migration, isolation, UI smoke tests
npm run typecheck
npm run build
```

Test files:

- `src/music.test.ts` — meter math (4/4, 5/4, 7/8, 11/8, 13/16 …), subdivision step counts including triplets and invalid combinations, `bar.beat` formatting/parsing round trips, snap stepping, scale library + custom intervals + pad derivation/overrides.
- `src/project.test.ts` — **scratch isolation regressions** (edit/duplicate/mutate B; A stays byte-for-byte identical), v3→v4 migration (patterns, notes, audio blob IDs, Drive refs, loop state), legacy `beatsPerBar` mapping with drum-row re-mapping, malformed-document fallbacks, v4 idempotence.
- `src/features.test.ts` — compression route specs (single vs multi-stage), kit list, Drive link parsing.
- `src/app.test.tsx` — jsdom render tests: eight tracks, meter switch to 7/8 re-grids drums to 14 steps, triplet subdivision, drawer ＋/− ARIA state, New vs Duplicate semantics, typed Loop In/Out validation, multi-stage comp toggle.
- `src/isolation.test.tsx` — end-to-end UI isolation: create A → duplicate → edit B through the real components → assert stored project keeps A byte-for-byte unchanged (drums, brand-new scratches, synth motifs, audio metadata).
- `src/media.test.ts` — WAV encoding/decoding, fragment detection, zip pack round trip.

## Core smoke test

1. Load the app with an empty browser profile.
2. Confirm the eight fixed tracks render and the Drums editor is selected.
3. Change drum steps, adjust Swing/Human/Punch/Brightness, preview the pattern.
4. Try each subdivision: the grid/geometry node count follows *time signature × subdivision* (e.g. 7/8 at 1/16 → 14 steps) and existing hits keep their musical position when you switch.
5. Switch meters in the transport (try 5/4 and 7/8): ruler bar count, metronome accents, whole-bar snapping, and drum pattern length all follow.
6. Select Synth: tap notes into the motif composer, drag one, resize another, delete one via the inspector; enable Write motif and quick-enter from the pads; press Rest › to leave gaps.
7. Change Key/Scale/Octave and confirm the pads follow; map one pad via ⋯ to an exact note and confirm it sticks after duplicating the Scratch.
8. Record on Bass/Audio (grant mic permission); confirm playback of the take, waveform, and that recording again fills a blank selected slot instead of adding another Scratch.
9. Toggle Multi-stage comp and confirm both audition and arrangement playback still work and sound glued.
10. Refresh; confirm structure + audio survive. Export/import JSON.

## Isolation regression

1. Note Scratch A's pattern. Duplicate it → edit B heavily (steps, kit, settings).
2. Select A: unchanged. Export JSON: A's object is byte-for-byte what it was.
3. Repeat for synth (motif + patch + pad overrides).

## Arrangement editing smoke test

1. Place two clips; select one.
2. Move with Snap 1/32 and confirm 0.125-beat increments; Snap Off allows hundredths.
3. Desktop: drag clip body. Touch: use ↔ handle only.
4. Resize via right-edge handle; stretch a drum clip past one bar and confirm repeats.
5. Snip @ playhead; verify right side source offset (audio).
6. Copy/paste/duplicate/delete; keyboard shortcuts on desktop.

## Loop range smoke test

1. Scrubber + ruler tap set the playhead.
2. Ruler drag creates a loop range; Loop enables automatically.
3. Type `2.1` into Loop Out (or any odd-meter position like `3.4` at 7/8) and confirm the region matches; type nonsense and confirm graceful revert.
4. Arrow-key stepping inside the fields follows the current Snap setting.
5. Playback wraps Out→In; lanes never seek.

## Loop + Auto Scratch recording smoke test

Unchanged from previous versions (warm-up lap, per-loop takes up to 12, Auto Scratch Off = single take). Additionally:

- With a blank Audio Scratch selected, Record fills that Scratch instead of creating another.
- Odd-meter loops (e.g. 2 bars of 7/8) capture takes of the correct length.

## iPhone / touch regression test

Real-device confirmation is still required for anything below marked ⚠.

1. Swipe horizontally over empty lanes and clip bodies → scrolls, no edits.
2. Vertical page scroll and pinch zoom remain available everywhere except deliberate handles.
3. Motif composer: background tap adds a note; dragging your finger on empty canvas scrolls instead; note bodies/resize handles drag reliably ⚠.
4. Geometry nodes at high step counts (e.g. 20 steps at 5/4×1/16) remain tappable ⚠.
5. Drawer ＋/− toggles; scratch cards swipe-scroll without accidental drags.
6. Loop In/Out fields are usable at 390 px width; number keyboards appear (`inputMode="decimal"`).
7. Pad mapper grid scrolls vertically; chromatic buttons ≥36 px.
8. Subdivision select disables impossible triplet combos rather than silently rounding ⚠.

## Waveform smoke test

Unchanged: decode locally, switch with selection, error states for broken takes. Repeated selections of the same take should now reuse cached decoded buffers (no repeated decode work).

## Drive smoke test

1. Connect, Sync, confirm folder structure in Drive.
2. Share project → link copied; invite collaborator as Editor in Google's UI.
3. Collaborator pastes a **standard** `drive.google.com/drive/folders/…?usp=sharing` link into Open Drive link → connects own account → Picker confirms once → project loads.
4. Edit and Sync writes back into the same shared folder.
5. Reconnect flow after token expiry.
6. Malformed/garbage paste shows a clear error, not a crash.

## Browser targets

Current Chrome/Edge desktop, Safari desktop, Chrome Android, Safari iOS. Recordings stay standalone WAVs so decoding is portable. The transport remains interval-scheduled (not sample-accurate); loop-boundary timing deserves real-device checks.
