# Scratchtrack project format v3

The project file is deliberately small and portable JSON. Binary audio remains outside the JSON document.

```json
{
  "format": "scratchtrack-project",
  "version": 3,
  "id": "uuid",
  "title": "Untitled idea",
  "bpm": 104,
  "beatsPerBar": 4,
  "tracks": [],
  "clips": [],
  "loop": {
    "enabled": false,
    "startBeat": 0,
    "endBeat": 16,
    "autoScratch": true
  }
}
```

Version 1 and version 2 project JSON are normalized into v3 when loaded or imported. The v3 migration intentionally enables `autoScratch` for older prototype projects because the simplified loop workflow now treats automatic take generation as the default behavior.

## Track

A Track has a fixed role (`drum`, `synth`, `bass`, or `audio`), mute/solo state, an active Scratch, Scratches, and persistent channel settings.

Audio-oriented channel settings currently include trim, tone, compression, volume, pan, space, and monitor state. The stored source recording remains separate from those mix decisions.

## Scratch

A Scratch is a variation of a musical thought. Depending on its parent Track it can contain:

- a 4 × 16 drum velocity grid, kit name, and drum settings;
- synth patch settings plus MIDI-like note events;
- an IndexedDB audio Blob reference, MIME metadata, and source duration.

The general per-track Scratch cap is deliberately larger than a single loop session. Auto Scratch creates at most **12 new Scratches per recording session**, allowing a player to keep several older ideas while still doing a full loop-take pass. Cleanup remains intentional: obvious misses should be deleted rather than accumulated forever.

## Clip

A Clip contains placement/edit information:

- `trackId`
- `scratchId`
- `startBeat`
- `lengthBeats`
- `sourceOffsetBeats`

A Clip never owns media. Multiple Clips may point to the same Scratch.

`sourceOffsetBeats` makes non-destructive snipping possible. When a clip is split, the right-hand clip advances its source offset instead of creating a new audio file.

For drum and synth clips, `lengthBeats` may be longer than the underlying source pattern. Playback wraps the source pattern modulo its natural length, so stretching a drum clip behaves like a repeating MIDI region. Audio clips are bounded by the remaining source duration and are not time-stretched.

## Loop state

Loop state is project-level because it describes the active editing/recording focus region.

- `startBeat` and `endBeat` are absolute arrangement positions.
- `enabled` controls transport wrapping.
- `autoScratch` is the simple automatic-take switch and defaults to `true`.

Loop-session runtime details are intentionally **not** persisted in project JSON. Warm-up state, current pass number, and the 12-take session counter exist only while recording.

When loop recording begins, the first complete pass is always a warm-up and creates no recording. If `autoScratch` is on, capture begins at the first return to Loop In and each subsequent completed pass becomes its own Scratch, up to 12 in that session. If `autoScratch` is off, capture still begins after the warm-up but runs as one continuous recording until stopped.

## Editing preference: Snap

The Snap toggle is an editor preference rather than musical project data. It is stored locally in the browser. Snap On currently uses 0.125-beat increments (1/32-note subdivisions in 4/4); Snap Off preserves finer pointer placement to hundredths of a beat.

## Binary audio

Local audio is stored in IndexedDB under `audioBlobId`. Drive sync writes it as a sibling file in the project folder. Musical arrangement edits only mutate small JSON references, so moving, copying, repeating, or snipping clips does not duplicate the recording.

Waveform previews are generated locally by decoding the selected Scratch's IndexedDB audio and sampling display peaks. The waveform itself is not stored in project JSON.

Future versions should maintain a content hash so identical recordings can be recognized without relying on file names.
