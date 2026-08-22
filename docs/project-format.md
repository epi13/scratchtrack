# Scratchtrack project format v1

The project file is deliberately small and portable JSON.

```json
{
  "format": "scratchtrack-project",
  "version": 1,
  "id": "uuid",
  "title": "Untitled idea",
  "bpm": 104,
  "beatsPerBar": 4,
  "tracks": [],
  "clips": []
}
```

## Track

A Track has a fixed role (`drum`, `synth`, `bass`, or `audio`), mute/solo state, an active Scratch, and zero to six Scratches.

## Scratch

A Scratch is a variation of a musical thought. Depending on its parent Track it can contain:

- a 4 × 16 drum velocity grid plus kit name;
- synth patch settings plus MIDI-like note events;
- an IndexedDB audio Blob reference plus MIME metadata.

The six-Scratch limit is a product constraint, not a storage constraint. It exists to keep experimentation useful instead of creating a take-management system.

## Clip

A Clip contains only placement information:

- `trackId`
- `scratchId`
- `startBeat`
- `lengthBeats`

A Clip never owns the media itself. Multiple Clips may point to the same Scratch.

## Binary audio

Local audio is stored in IndexedDB under `audioBlobId`. Drive sync writes it as a sibling file in the project folder. Future versions should maintain a content hash so identical recordings can be recognized without relying on file names.
