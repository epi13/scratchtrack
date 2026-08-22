# Scratchtrack roadmap

The roadmap is ordered around one question: **does this make exchanging a musical idea faster?**

## v0.1 — musical notebook foundation

- [x] Fixed eight-track arrangement
- [x] Contextual editor for track type
- [x] Pointer-based Scratch placement to timeline
- [x] Functional synthesized 16-step drum sequencer
- [x] Accent velocity states in drum steps
- [x] Three lightweight synthesized drum characters
- [x] Functional analog-style two-oscillator synth
- [x] Tiny motif writer stored as note events
- [x] Bass/general browser recording
- [x] Mono + compressed recording preference
- [x] IndexedDB audio persistence
- [x] Local project autosave
- [x] Timeline clips, mute, solo, playhead and arrangement playback
- [x] JSON project import/export
- [x] Google Identity Services connection scaffold
- [x] Google Drive project + audio upload
- [x] Installable PWA shell
- [x] GitHub Pages build/deploy workflow
- [x] Mobile responsive layout

## v0.2 — arrangement + focused looping

- [x] Select and move timeline clips with pointer/touch
- [x] Resize clips with a dedicated right-edge touch handle
- [x] Drum/synth clip stretching repeats the underlying pattern
- [x] Non-destructive clip snip at playhead
- [x] Source offsets preserved after audio snips
- [x] Copy, paste, duplicate and delete clip actions
- [x] Desktop editing shortcuts without making them required
- [x] Loop In / Out points
- [x] Visible loop-region overlay in ruler and lanes
- [x] Looping transport
- [x] Persistent richer drum controls: swing, humanize, output, punch, brightness
- [x] Expanded synth patch: detune, resonance, sustain, drive, LFO rate/depth
- [x] Persistent audio-track trim/tone/compression/volume/pan/space controls
- [x] Phone-oriented scrollable control banks and larger touch targets
- [x] Project format v2 and v1 migration

## v0.3 — final core songwriting interaction pass

- [x] Loop recording starts the main arrangement transport
- [x] First loop pass is a no-record warm-up lap
- [x] Auto Scratch defaults ON with a single Off switch
- [x] Each completed post-warm-up loop becomes its own Scratch
- [x] Auto Scratch session limit of 12 loop takes
- [x] Continuous MediaRecorder with per-loop `requestData()` boundaries instead of recorder restart on every pass
- [x] Pausing/stopping the main transport also ends active recording
- [x] Track lanes no longer reposition the playhead when touched
- [x] Bar ruler tap sets playhead
- [x] Bar ruler drag selects a custom multi-bar loop range
- [x] Dedicated touch move handle for clips while clip bodies remain scroll-friendly
- [x] Dedicated touch resize handle retained
- [x] Pinch-zoom-friendly touch behavior through primary arrangement and Scratch surfaces
- [x] More granular clip positioning
- [x] Snap 1/32 / Off toggle
- [x] Live clip-move position and delta feedback
- [x] Selected audio Scratch waveform under track controls
- [x] Project format v3 with automatic v1/v2 migration

## v0.4 — collaboration that stays simple

- [ ] Google Picker for intentionally opening a shared Scratchtrack project folder
- [ ] Drive revision IDs and optimistic conflict checks
- [ ] “Collaborator changed this while you were working” conflict screen rather than silent overwrite
- [ ] Author identity on Scratches
- [ ] Pull remote changes without replacing unsynced local work
- [ ] Compact change journal: added Scratch, changed pattern, placed Clip

## v0.5 — stronger capture

- [ ] Input device selector
- [ ] Real input meter from `AnalyserNode`
- [ ] Count-in and punch recording outside the loop warm-up workflow
- [ ] Waveform overview on timeline clips, not only the selected Scratch editor
- [ ] Short audio fade handles
- [ ] Better non-destructive bass/audio processing chain
- [ ] Audio latency calibration per device
- [ ] Cross-browser timing calibration for sample-accurate-ish loop boundaries

## v0.6 — stronger musical structure

- [ ] Named sections: Intro / Verse / Chorus / Bridge / Outro
- [ ] Section duplication and rearrangement
- [ ] Variable drum-pattern lengths
- [ ] Per-step microtiming and probability / flam where musically useful
- [ ] MIDI keyboard input
- [ ] MIDI quantize strength rather than only hard quantize
- [ ] Synth preset library and six macro controls
- [ ] Optional clip fade and gain envelope without automation-lane complexity

## v0.7 — sharing and preview

- [ ] Offline arrangement rendering to a compact preview file
- [ ] “What changed?” collaborator comparison
- [ ] Shareable project invitation flow built on Drive permissions
- [ ] Project list / recent ideas home screen

## Explicit non-goals

Unless the product direction changes, Scratchtrack should not grow toward unlimited tracks, plugin hosting, a full mixer, detailed mastering, complex automation lanes, or studio-grade interchange. Those belong in a DAW.
