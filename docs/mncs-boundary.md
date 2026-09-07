# MNCS browser/WASM application boundary

Phase 1 of the MNCS pressure campaign. This document defines the canonical
way ScratchTrack compiles MNCS to WASM and executes it inside the browser
application. The boundary is small, explicit, typed, and measurable.

## Proven shape (2026-09)

`mncs/meter.mncs` (`scratchtrack.meter.v1`) compiles through the MNCS
toolchain to a real WebAssembly MVP binary:

- one exported WASM function per MNCS function (`bar_ticks`,
  `steps_per_bar`, `quantize_tick`, `pad_midi`, ...),
- scalars pass directly (`i64` <-> BigInt, `bool` <-> 0/1),
- **zero host imports** — the module instantiates with `{}`.

Replay: `scripts/mncs-evidence.sh`. It runs source-study, executes
`mncs/meter-corpus.json` (33 cases) on the portable-WASM and
research-bytecode backends, checks cross-backend agreement, and performs
live calls into the compiled WASM module. All green as of this writing.

## Boundary rules

1. **MNCS owns domain semantics and data processing.** Musical time,
   arrangement state, DSP parameter math, geometry, and serialization logic
   live in `mncs/*.mncs` wherever the language can express them today.
2. **The host owns browser objects.** DOM nodes, `AudioContext` graph
   nodes, `MediaStream`, IndexedDB handles, Google API clients, and service
   workers stay on the TypeScript side. MNCS never names a browser type.
3. **Crossings are coarse and typed.** MNCS produces compact values or
   event batches (integers, codes, ticks); the host performs the browser
   calls. No per-sample host crossings, no JSON on hot paths, no chatty
   per-frame WASM calls from render loops.
4. **Codes cross the boundary, labels stay out.** MNCS has no string type
   yet, so enumerations cross as integer codes with the mapping pinned in
   exactly one place: `src/mncsMeter.ts` (`SUBDIVISION_CODES`,
   `subdivisionToCode`, `codeToSubdivision`). When MNCS gains finite/string
   vocabulary, the codes collapse into it.
5. **Sentinels, not exceptions.** Fallible MNCS kernels return `-1` for
   invalid input (all backends execute scalar returns; payload sums are
   refused by scalar backends). The TS projection maps `-1` to `null`.
   Rich `Result` payloads arrive when the backend envelope supports them.

## Current host-boundary inventory (thin adapters, kept deliberately)

| Area | TS owner | MNCS pressure target |
| --- | --- | --- |
| `AudioContext` graph, kit voicing calls | `src/audio.ts` | parameter math (envelopes, gains, pan, compression config) |
| `MediaDevices` / capture worklet | `src/capture.ts`, `public/capture-processor.js` | take-boundary arithmetic, level analysis |
| IndexedDB blob storage | `src/store.ts` | blob metadata, cache policy |
| Google Identity/Picker/Drive | `src/drive.ts` | manifest/state representation, link parsing |
| DOM/React shell, Canvas geometry mapping | `src/App.tsx`, `src/components/` | geometry generation, hit testing, event interpretation |
| WAV encode/decode bytes | `src/media.ts` | header math, PCM scaling (needs byte buffers + floats) |
| Project JSON parse/stringify | `src/project.ts` migration edges | schema validation, migration, normalization |

## What is NOT a boundary

- `music.ts` tick/subdivision/step math: delegated to the MNCS projection
  (`src/mncsMeter.ts`). The old float-division-plus-epsilon formulation is
  gone.
- Transport tick math in `App.tsx fireTick`: bar length, clip
  activation/length, bar/pattern/motif wraps, drum step index, and motif
  sizing all delegate to the MNCS arrangement projection
  (`src/mncsArrange.ts`). The beats→ticks `Math.round` stays at the edge.
- Session policy: loop-take and Scratch-count guards delegate to
  `mncsLoopTakeAllowed` / `mncsScratchAllowed`; tempo normalization in
  `project.ts` delegates to `mncsNormalizeBpm`.
- Migration math in `project.ts` / `music.ts`: legacy meter mapping, drum
  remap (one MNCS rule replacing two float copies), key normalization,
  motif-bar clamping, and the Auto Scratch version rule delegate to the
  MNCS migration projection (`src/mncsMigrate.ts`). Exact ties now round
  up deterministically (evidenced normalization, see D-003).
- Visual/interaction discretes: beat-step classification, swing phase (one
  MNCS rule replacing the App/DrumEditor copies), grid spacing, cell
  cycling, step advance, drag/tap thresholds, motif MIDI policy, row
  picking, grid-line counts, and waveform bucket partitioning delegate to
  the MNCS geometry projection (`src/mncsGeometry.ts`). Trig positioning,
  float peaks, and pixel layout stay host-side (see P-008).
- Any new TypeScript "helper" that hides work MNCS should express. When
  MNCS cannot express something, file it in `docs/mncs-pressure.md` and
  push the capability upstream — do not build a ScratchTrack-local
  workaround layer.

## Still beats-space (deferred with reason, see P-007)

- Clip move/resize/snip and loop-range editing in `App.tsx` / `project.ts`
  stay in beats: arrangement snap grids (e.g. 1/32 beat = 0.75 ticks) are
  finer than the transport tick grid, so those edits are not
  whole-tick-exact. Their tick kernels are specified, proven, and tested
  (`mncsSnipValid`, `mncsSnipHalves`, `mncsMoveStart`, `mncsResizeLength`,
  `mncsLoopStartTick`, `mncsLoopEndTick`) and waiting for tick-exact snap.
