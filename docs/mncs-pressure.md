# MNCS pressure log

Consumer-driven language-development evidence for the ScratchTrack
conversion campaign. Each item follows the required shape:

**ScratchTrack requirement → MNCS limitation → upstream solution → proof**

## Baseline (2026-09-06, pre-conversion)

- ScratchTrack tests: 50 passed (6 files).
- Production bundle: `dist/assets/index-D9MHhpMm.js` 284,131 bytes,
  `index-6a74pugY.css` 35,955 bytes.
- MNCS meter WASM module (`scratchtrack.meter.v1`, 11 functions): 2,983
  bytes, zero host imports.

## Delivered

### D-001 — exact integer meter kernels in MNCS (Phases 1+2)

- Requirement: meter, tick, subdivision, step, and pad-note math must be
  exact (24-tick grid; triplets land exactly).
- MNCS limitation: none for this slice — Profile 0.6 scalars, boolean
  operators, and explicit arithmetic intents already express it.
- Solution: new `mncs/meter.mncs` (`scratchtrack.meter.v1`), kept in
  ScratchTrack because music theory is product-domain, not stdlib-generic.
  Float `barBeats`/`STEP_BEATS` reasoning replaced by `bar_ticks =
  numerator * 96 / denominator` and divisibility-checked `steps_per_bar`.
  Addition/multiplication use explicit wrapping intents (`+%`, `*%`),
  discharging 13 of 29 overflow obligations; the wrap path is unreachable
  in product ranges (numerators <= 32, MIDI 0..127, ticks <= 1536).
- Proof: `mncs/meter-corpus.json` (33 cases) executes 33/33 on
  portable-WASM and research-bytecode; compiled WASM instantiates with zero
  imports and 12/12 live calls agree; `src/mncsMeter.test.ts` pins every
  vector in the app suite; `scripts/mncs-meter-evidence.sh` replays it all.
  Semantic fingerprint `17dbdf26...` (see script output).
- Ratio effect: `music.ts` `barTicks`/`stepsPerBar`/`STEP_TICKS` now
  delegate to the MNCS projection; all 50 pre-existing tests still pass
  unchanged (plus 7 new conformance tests).

## Open pressure (upstream work, ordered by campaign value)

### P-001 — float semantics (blocks Phase 4 audio/DSP)

- Requirement: envelopes, gains, pan curves, compression config, MIDI
  frequency, waveform analysis are float workloads.
- MNCS limitation: integer-only today (`i8..i64`, `u*`, `byte`, `bool`);
  no float type, no float intents, no backend float envelope.
- Upstream path: float scalar type + explicit intent family (analogous to
  `+%`/`+|`), backend realization facts, bounded float corpora. DSP stays
  host-side until this lands; `audio.ts` parameter math is the waiting
  workload.

### P-002 — string/UTF-8 vocabulary (blocks Phases 7+8)

- Requirement: note names, scale labels, JSON keys, Drive metadata,
  position strings (`bar.beat.sixteenth`) are string workloads.
- MNCS limitation: no string type; `byte` + bounded views + `text_view`
  cover spans and matching but not general string values.
- Upstream path: bounded string/value-text tranche above `text_view.v1`;
  until then, enumerations cross the WASM boundary as integer codes
  (`SUBDIVISION_CODES` in `src/mncsMeter.ts`) and formatting stays host-side.

### P-003 — guarded-division obligations stay UNKNOWN

- Requirement: `steps_per_bar`, `quantize_tick`, `pitch_class` guard every
  divisor by control flow (`step <= 0` early-return; validated
  denominators; literal 12).
- MNCS limitation: no prover discharges divisor-nonzero facts, so 16
  `integer-overflow` obligations remain UNKNOWN and top-level experiment
  status is UNKNOWN (bounded observations still carry verified values —
  same contract as the `bounded-min` precedent).
- Upstream path: range/provenance reasoning that turns guarded divisors
  into discharged obligations. ScratchTrack's kernels are a ready-made
  corpus for it.

### P-004 — async/effect model (blocks Phases 8+9)

- Requirement: microphone capture, IndexedDB, Drive sync, file picker are
  async capability workloads needing an explicit host-access model
  (`audio.capture`, `storage.read`, ...).
- MNCS limitation: `capability/` in the stdlib is explicitly reserved and
  empty; no async/effect/callback/future semantics exist yet.
- Upstream path: capability/effect-shape declarations per current RFC
  direction; ScratchTrack's `store.ts`/`drive.ts`/`capture.ts` are the
  waiting workloads. Nothing async was wrapped in promises-shaped TS glue
  this tranche.

### P-005 — packed render data / typed buffer views (blocks Phase 6)

- Requirement: waveform/drum/timeline geometry wants packed numeric
  buffers shared with the host (zero-copy or minimum-copy).
- MNCS limitation: bounded sequences/views exist but host-visible buffer
  views over WASM linear memory are only proven for composite memory via
  `mncs_host_buffer`; the browser `Float32Array`-over-memory path is
  unproven.
- Upstream path: host-visible buffer-view ABI + browser interop test.
  Geometry stays host-mapped until then.

### P-006 — direct browser instantiation of MNCS WASM modules

- Requirement: the end state loads `scratchtrack.meter.v1` (and
  successors) as real browser WASM instead of a TS mirror.
- Status: closer than expected — the module is already a zero-import WASM
  MVP binary callable from JS (proven in node). Remaining work is build
  wiring (emit artifact into `public/` or bundle) and a capability-shaped
  loader, not language work.
