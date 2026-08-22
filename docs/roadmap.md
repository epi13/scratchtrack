# Scratchtrack roadmap

The roadmap is ordered around one question: **does this make exchanging a musical idea faster?**

## v0.1 — musical notebook foundation

- [x] Fixed eight-track arrangement
- [x] Contextual editor for track type
- [x] Pointer-based Scratch drag to timeline
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
- [x] Continuous take capture: every completed loop can become a new Scratch
- [x] Scratch safety cap raised to 24 for loop take workflows
- [x] Persistent richer drum controls: swing, humanize, output, punch, brightness
- [x] Expanded synth patch: detune, resonance, sustain, drive, LFO rate/depth
- [x] Persistent audio-track trim/tone/compression/volume/pan/space controls
- [x] Phone-oriented scrollable control banks and larger touch targets
- [x] Project format v2 and v1 migration

## v0.3 — collaboration that stays simple

- [ ] Google Picker for intentionally opening a shared Scratchtrack project folder
- [ ] Drive revision IDs and optimistic conflict checks
- [ ] “Joel changed this while you were working” conflict screen rather than silent overwrite
- [ ] Author identity on Scratches
- [ ] Pull remote changes without replacing unsynced local work
- [ ] Compact change journal: added Scratch, changed pattern, placed Clip

## v0.4 — stronger capture

- [ ] Input device selector
- [ ] Real input meter from `AnalyserNode`
- [ ] Count-in and punch recording
- [ ] Waveform overview generation
- [ ] Short audio fade handles
- [ ] Better non-destructive bass/audio processing chain
- [ ] Audio latency calibration per device
- [ ] Tighten loop-boundary capture so adjacent loop takes have minimal boundary gaps across browsers

## v0.5 — stronger musical structure

- [ ] Named sections: Intro / Verse / Chorus / Bridge / Outro
- [ ] Section duplication and rearrangement
- [ ] Variable drum-pattern lengths
- [ ] Per-step microtiming and probability / flam where musically useful
- [ ] MIDI keyboard input
- [ ] MIDI quantize strength rather than only hard quantize
- [ ] Synth preset library and six macro controls
- [ ] Optional clip fade and gain envelope without automation-lane complexity

## v0.6 — sharing and preview

- [ ] Offline arrangement rendering to a compact preview file
- [ ] “What changed?” collaborator comparison
- [ ] Shareable project invitation flow built on Drive permissions
- [ ] Project list / recent ideas home screen

## Explicit non-goals

Unless the product direction changes, Scratchtrack should not grow toward unlimited tracks, plugin hosting, a full mixer, detailed mastering, complex automation lanes, or studio-grade interchange. Those belong in a DAW.
