# Scratchtrack roadmap

The roadmap is ordered around one question: **does this make exchanging a musical idea faster?**

## v0.1 — musical notebook foundation
- [x] Fixed eight-track arrangement, contextual editors, Pointer-based placement
- [x] Synth + motif writer, browser recording, IndexedDB, autosave, clips, JSON import/export
- [x] Drive scaffold + upload, PWA shell, Pages deploy

## v0.2 — arrangement + focused looping
- [x] Clip move/resize/snip/copy/paste/duplicate/delete with touch-safe handles
- [x] Pattern-repeat stretching, loop In/Out + region, looping transport
- [x] Richer drum/synth/audio controls, phone-oriented control banks

## v0.3 — final core songwriting interaction pass
- [x] Loop recording on the main transport, warm-up lap, Auto Scratch takes (12/session)
- [x] Ruler tap/drag playhead + loop selection, lanes stay scroll-only
- [x] Snap divisions, live move feedback, selected-scratch waveform, project format v3

## v0.4 — collaboration that stays simple
- [x] Google Picker shared-project open flow, folder-ID-only share links, WAV loop takes
- [ ] Drive revision IDs and optimistic conflict checks
- [ ] “Collaborator changed this while you were working” conflict screen rather than silent overwrite
- [ ] Author identity on Scratches
- [ ] Pull remote changes without replacing unsynced local work

## v0.5 — meters, composer, and the fast songwriting loop (this release)
- [x] **Scratch independence guarantee**: one audited deep-copy module (`project.ts`) + regression tests proving edits to one Scratch never mutate another
- [x] **Scratch action strip** on every track: ＋ New Scratch / Duplicate / Place @ Playhead; New keeps sound config but starts clean; Record fills a selected blank audio slot
- [x] **Real time signatures**: any numerator × denominator 2/4/8/16; meter-aware ruler, metronome accents, snapping, loop bounds, playback wrapping, pattern lengths; legacy `beatsPerBar` migration
- [x] **Drum subdivision** (1/4 … 1/32 incl. triplets) with timing-preserving re-maps and dynamic Grid/Geometry views
- [x] **Club + Modern/Sub drum kits** (pure Web Audio synthesis)
- [x] **Multi-stage compression** for Bass/Audio (peak → glue → safety limiter, non-destructive)
- [x] **Motif composer**: tap/drag/resize/delete piano-roll editing with rests, snap, exact-pitch inspector, 1–8 bar motifs
- [x] **Key/Scale/Octave system** with broad scale library, Custom intervals, per-pad exact-MIDI remapping stored on the Scratch
- [x] Editable Loop In/Out as `bar.beat` values with snap stepping and validation
- [x] Standard Google Drive folder links accepted via paste, with Picker confirmation fallback under the narrow `drive.file` scope
- [x] Drawer toggle ＋/− with correct ARIA state; decoded-audio cache

## v0.6 — stronger musical structure
- [ ] Named sections: Intro / Verse / Chorus / Bridge / Outro
- [ ] Section duplication and rearrangement
- [ ] Per-step microtiming and probability / flam where musically useful
- [ ] MIDI keyboard input
- [ ] Synth preset library and six macro controls
- [ ] Optional clip fade and gain envelope without automation-lane complexity
- [ ] Lookahead (AudioContext-clock) scheduler for tighter low-latency playback on mobile

## v0.7 — sharing and preview
- [ ] Offline arrangement rendering to a compact preview file
- [ ] “What changed?” collaborator comparison
- [ ] Project list / recent ideas home screen

## Explicit non-goals

Unless the product direction changes, Scratchtrack should not grow toward unlimited tracks, plugin hosting, a full mixer, detailed mastering, complex automation lanes, or studio-grade interchange. Those belong in a DAW.
