# Scratchtrack project format v2

The project file is deliberately small and portable JSON. Binary audio remains outside the JSON document.

```json
{
  "format": "scratchtrack-project",
  "version": 2,
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
    "captureEachPass": false
  }
}
```

Version 1 project JSON is normalized into v2 when it is loaded or imported.

## Track

A Track has a fixed role (`drum`, `synth`, `bass`, or `audio`), mute/solo state, an active Scratch, Scratches, and persistent channel settings.

Audio-oriented channel settings currently include trim, tone, compression, volume, pan, space, and monitor state. The stored source recording remains separate from those mix decisions.

## Scratch

A Scratch is a variation of a musical thought. Depending on its parent Track it can contain:

- a 4 × 16 drum velocity grid, kit name, and drum settings;
- synth patch settings plus MIDI-like note events;
- an IndexedDB audio Blob reference, MIME metadata, and source duration.

The original six-Scratch constraint has been relaxed to a **24-Scratch safety cap** because loop recording can intentionally create a take on every pass. The product expectation is still active cleanup: obvious misses should be deleted rather than accumulated forever.

## Clip

A Clip contains placement/edit information:

- `trackId`
- `scratchId`
- `startBeat`
- `lengthBeats`
- `sourceOffsetBeats`

A Clip never owns media. Multiple Clips may point to the same Scratch.

`sourceOffsetBeats` makes non-destructive snipping possible. When a clip is split, the right-hand clip advances its source offset instead of creating a new audio file.

For drum and synth clips, `lengthBeats` may be longer than the underlying source pattern. Playback wraps the source pattern modulo its natural length, so stretching a drum clip behaves like a repeating MIDI region. Audio clips are currently bounded by the remaining source duration and are not time-stretched.

## Loop state

Loop state is project-level because it describes the current editing/recording focus region. `startBeat` and `endBeat` are absolute arrangement positions. When `captureEachPass` is enabled, an armed Bass/Audio recording writes each completed trip around the loop as a separate Scratch.

## Binary audio

Local audio is stored in IndexedDB under `audioBlobId`. Drive sync writes it as a sibling file in the project folder. Musical arrangement edits only mutate small JSON references, so moving, copying, repeating, or snipping clips does not duplicate the recording.

Future versions should maintain a content hash so identical recordings can be recognized without relying on file names.
