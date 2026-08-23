# Scratchtrack project format v4

The project file is deliberately small and portable JSON. Binary audio remains outside the JSON document.

```json
{
  "format": "scratchtrack-project",
  "version": 4,
  "id": "uuid",
  "title": "Untitled idea",
  "bpm": 104,
  "timeSignature": { "numerator": 4, "denominator": 4 },
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

## Versions and migration

- **v1/v2** — early prototypes (fixed beats-per-bar, no Auto Scratch flag).
- **v3** — added `autoScratch`, normalized clips; still assumed 4/4 with 16-step drum patterns.
- **v4** — explicit `timeSignature`, per-Scratch drum `subdivision` with variable pattern lengths, channel `multiStage` compression, synth scale/key-layout/motif metadata.

All versions are migrated automatically by `normalizeProject()` when a project loads, imports, or arrives from Drive:

| Legacy data | v4 result |
| --- | --- |
| `beatsPerBar: n` | `timeSignature {numerator: n, denominator: 4}` |
| 4 × 16 drum rows at any meter | rows resized/re-mapped to `stepsPerBar(meter, subdivision)`, keeping each hit's musical position |
| missing drum subdivision/kit/settings | defaults (`1/16`, kit kept if present, default settings merged per-field) |
| synth notes | preserved exactly; `motifBars` derived from content length |
| missing synth scale metadata | root C, Major, octave 3, 0.5-beat quick-entry length |
| audio `audioBlobId` / MIME / duration | untouched |
| Drive folder references (`drive`) | untouched |
| malformed documents | fall back to a fresh project instead of throwing |

Migration is idempotent: normalizing an already-v4 project returns equal data.

## Musical time model

The timeline stays in **quarter-note beats** so clip math never changes shape across meters:

```
barLengthBeats = numerator × (4 / denominator)
```

The transport quantizes the whole arrangement to a fixed grid of **24 ticks per quarter-note beat**, which divides every supported drum subdivision (1/4 → 24 ticks … 1/8-triplet → 8, 1/16-triplet → 4, 1/32 → 3). Positions used by playback, snapping, loop bounds, and editors are always whole ticks.

## Track

A Track has a fixed role (`drum`, `synth`, `bass`, or `audio`), mute/solo state, an active Scratch, Scratches, and persistent channel settings.

Audio-oriented channel settings include trim, tone, compression amount, **multiStage** mode, volume, pan, space, and monitor state. The stored source recording remains separate from those mix decisions.

## Scratch

A Scratch is a variation of a musical thought — and strictly independent musical data. Duplication deep-copies every nested structure (pattern rows, note lists, patch/settings objects, key layout), so no two Scratches can share references.

Depending on its parent track it can contain:

### Drums
- `drumPattern` — 4 velocity rows, each exactly `stepsPerBar(timeSignature, drumSubdivision)` cells long;
- `drumKit` — `Pocket`, `Dust`, `Machine`, `Club`, or `Modern`;
- `drumSubdivision` — `1/4 | 1/8 | 1/8t | 1/16 | 1/16t | 1/32`;
- `drumSettings` — swing, humanize, output, punch, brightness.

`stepsPerBar = barLengthBeats ÷ subdivisionValue`. Combinations that cannot land on whole transport ticks (e.g. 7/8 at 1/8-triplets) are invalid and disabled in the UI rather than rounded.

Changing meter or subdivision re-maps hits to their closest equivalent positions; stronger hits win collisions.

### Synth
- `synthPatch` — oscillator/filter/envelope/drive/LFO settings;
- `synthNotes` — MIDI pitch + start beat + length events (rests are simply absent beats);
- `scaleRoot` (0–11), `scaleName` (library entry or `Custom`), `customIntervals` (e.g. `"0-2-3-5-7-8-10"` for Custom);
- `keyOctave`, plus optional `keyLayout` — explicit MIDI note per keyboard pad; pads without an override derive from the scale;
- `motifBars` (1–8), `noteLengthBeats` (quick-entry duration).

### Audio
- IndexedDB `audioBlobId`, MIME metadata, source duration.

## Clip

Unchanged from v3: `trackId`, `scratchId`, `startBeat`, `lengthBeats`, `sourceOffsetBeats`. Clips reference the exact Scratch they were created from; stretching drum/synth clips repeats the source modulo one bar's worth of source pattern.

## Loop state

Project-level, in quarter-note beats. `enabled`, `startBeat`, `endBeat` (absolute positions), `autoScratch` (default true). Loop-session runtime details stay out of the document.

Loop In/Out are edited as `bar.beat` (optionally `bar.beat.sixteenth`) strings in the UI and stored as absolute beats, which keeps odd meters displayable without changing storage.

## Editing preference: Snap

Local browser preference, not project data: Off / 1/32 / 1/16 / 1/8 / Beat / 2 beats / Whole bar. "Whole bar" follows the project meter.

## Binary audio

Unchanged from v3: standalone 16-bit mono WAV files in IndexedDB; Drive sync mirrors `project.json`, one audio file per Scratch, and `scratchtrack.pack`. Waveforms are regenerated locally from decoded buffers (cached per blob ID).

Future versions should maintain a content hash so identical recordings can be recognized without relying on file names.
