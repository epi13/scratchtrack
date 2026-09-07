/**
 * Thin host ABI over compiled MNCS WASM modules (all eight product modules).
 *
 * Production execution path for MNCS authority: `public/mncs/*.wasm` is
 * built from the checked-in `mncs/*.mncs` by `scripts/mncs-wasm-build.sh`
 * (byte-deterministic; the manifest binds each artifact to its source
 * SHA-256 and compiler revision, and CI rebuilds and fails on mismatch).
 * Every module has zero host imports.
 *
 * Loader design (hardened):
 * - per-module state machine: unloaded → loading → ready | failed.
 *   Failure is isolated per module; a failed module is retryable via
 *   `initMncsModule(name, { retry: true })` without disturbing ready
 *   modules. There is no global init bit.
 * - digest verification: fetched bytes are SHA-256-checked against the
 *   served `mncs/manifest.json` before instantiation, so a stale or
 *   mismatched artifact (e.g. served from an old service-worker cache
 *   after a deploy) fails the module instead of executing silently.
 *   Byte-provided inits (tests, embedding) skip verification: the
 *   caller owns those bytes.
 * - memory discipline: every call builds fresh `Uint8Array`/`DataView`
 *   handles (never retained across calls, so WASM memory growth can
 *   never detach a live view); record/cell pointers are read
 *   immediately into JS values and never stored.
 *
 * Boundary rules, all observed against the real artifacts:
 * - instantiation is async; every export call after that is synchronous.
 * - `i64`/`u64` cross as BigInt, `i32`/`u32`/`u16`/`byte`/`bool` as
 *   numbers (bool 0/1). JS `Number()` conversion bounds callers to the
 *   2^53 integer range; every product value is far below it (pinned by
 *   corpus), and wrappers reject non-integers up front.
 * - the MNCS `-1` sentinel maps to null (see `mncsMeter.ts`).
 * - byte views cross through the host-buffer ABI (`mncs_host_buffer(n)`
 *   reserves `n` bytes and returns packed capacity/offset; the host
 *   writes bytes at the offset and passes `offset | len << 32`).
 * - exact byte sequences (`[byte; N]`) cross as canonical cells: one
 *   8-byte slot per element (byte stored in the low 4 bytes), allocated
 *   with `mncs_alloc`, passed as an i32 pointer.
 * - records cross as pointers to canonical cells in NAME-SORTED field
 *   order (e.g. `Clip{start,length,offset}` reads/writes as
 *   length,offset,start) with 8-byte slots (`i64`/`u64` full width,
 *   narrower scalars in the low 4 bytes). Verified field-by-field
 *   against every record-returning export; no nested records exist in
 *   the product modules, so nested marshalling is untested by design.
 * - init never throws: without a usable artifact every entry degrades
 *   to "not ready" and callers use the conformance-pinned TypeScript
 *   projection instead. Both paths agree by corpus; the projection is
 *   the fallback, never a second authority.
 *
 * Path attribution (for browser E2E, never for control flow):
 * wrappers record a `wasm` hit on success; projections record a
 * `fallback` hit when they run instead. `mncsPathStats()` exposes the
 * counters; the E2E hook in `main.tsx` surfaces them in test mode.
 */

export type MncsModuleName =
  | 'meter' | 'arrange' | 'migrate' | 'geometry'
  | 'wav' | 'pack' | 'text' | 'crc';

export type MncsModuleState = 'unloaded' | 'loading' | 'ready' | 'failed';

const MODULE_FILES: Record<MncsModuleName, string> = {
  meter: 'mncs/meter.wasm',
  arrange: 'mncs/arrange.wasm',
  migrate: 'mncs/migrate.wasm',
  geometry: 'mncs/geometry.wasm',
  wav: 'mncs/wav.wasm',
  pack: 'mncs/pack.wasm',
  text: 'mncs/text.wasm',
  crc: 'mncs/crc.wasm',
};

const moduleState: Record<MncsModuleName, MncsModuleState> = {
  meter: 'unloaded', arrange: 'unloaded', migrate: 'unloaded', geometry: 'unloaded',
  wav: 'unloaded', pack: 'unloaded', text: 'unloaded', crc: 'unloaded',
};

const moduleError: Record<MncsModuleName, string | null> = {
  meter: null, arrange: null, migrate: null, geometry: null,
  wav: null, pack: null, text: null, crc: null,
};

/**
 * In-flight loads keyed by module. Concurrent init calls for a module
 * that is already loading join the same promise instead of reporting
 * failure, so a readiness probe racing boot observes the real outcome.
 */
const inFlightLoad: Record<MncsModuleName, Promise<boolean> | null> = {
  meter: null, arrange: null, migrate: null, geometry: null,
  wav: null, pack: null, text: null, crc: null,
};

/** Current loader state for one module. */
export function mncsModuleState(name: MncsModuleName): MncsModuleState {
  return moduleState[name];
}

/** Last failure reason for one module (null when never failed). */
export function mncsModuleError(name: MncsModuleName): string | null {
  return moduleError[name];
}

function setState(name: MncsModuleName, state: MncsModuleState, error: string | null = null): void {
  moduleState[name] = state;
  moduleError[name] = error;
}

/* ------------------------------------------------------------------ */
/* Path attribution                                                     */
/* ------------------------------------------------------------------ */

export interface MncsPathCounters { wasm: number; fallback: number; }

const pathStats = new Map<string, MncsPathCounters>();

/** Record a successful compiled-WASM call (called by wrappers). */
export function noteWasmPath(fn: string): void {
  const entry = pathStats.get(fn) ?? { wasm: 0, fallback: 0 };
  entry.wasm += 1;
  pathStats.set(fn, entry);
}

/** Record a projection-fallback execution (called by projections). */
export function noteFallbackPath(fn: string): void {
  const entry = pathStats.get(fn) ?? { wasm: 0, fallback: 0 };
  entry.fallback += 1;
  pathStats.set(fn, entry);
}

/** Snapshot of per-function execution-path counters. */
export function mncsPathStats(): Record<string, MncsPathCounters> {
  return Object.fromEntries(pathStats);
}

/**
 * WASM-first call convention shared by all projections: return the
 * compiled result when the module answered, otherwise record the
 * fallback path and run the canonical projection body. Keeps every
 * kernel to exactly two implementations (WASM authority + projection),
 * never three.
 */
export function wasmFirst<T>(fn: string, wasm: T | null, fallback: () => T): T {
  if (wasm !== null) return wasm;
  noteFallbackPath(fn);
  return fallback();
}

/** Reset path counters (tests, E2E). */
export function resetMncsPathStats(): void {
  pathStats.clear();
}

/* ------------------------------------------------------------------ */
/* Shared ABI primitives                                                */
/* ------------------------------------------------------------------ */

interface HostBufferExports {
  memory: WebAssembly.Memory;
  mncs_host_buffer: (bytes: number) => bigint;
  mncs_host_buffer_reset: () => void;
}

interface AllocExports {
  mncs_alloc: (bytes: number) => number;
}

/** Stage raw bytes into the module's host region; returns the view descriptor. */
function stageView(module: HostBufferExports, bytes: Uint8Array): bigint | null {
  if (bytes.length > 64) return null;
  try {
    module.mncs_host_buffer_reset();
    const offset = Number(module.mncs_host_buffer(bytes.length) & 0xffffffffn);
    new Uint8Array(module.memory.buffer).set(bytes, offset);
    return (BigInt(bytes.length) << 32n) | BigInt(offset);
  } catch {
    return null;
  }
}

/**
 * Build a canonical exact-sequence cell: one 8-byte slot per element,
 * byte stored in the low 4 bytes. Returns the i32 cell pointer.
 */
function stageExactBytes(module: HostBufferExports & AllocExports, bytes: Uint8Array): number | null {
  try {
    const ptr = module.mncs_alloc(bytes.length * 8);
    const view = new DataView(module.memory.buffer);
    for (let i = 0; i < bytes.length; i += 1) view.setUint32(ptr + i * 8, bytes[i]!, true);
    return ptr;
  } catch {
    return null;
  }
}

/** Read one little-endian i64/u64 slot as BigInt. */
function readI64(module: { memory: WebAssembly.Memory }, ptr: number, slot: number): bigint {
  return new DataView(module.memory.buffer).getBigInt64(ptr + slot * 8, true);
}

/**
 * Reclaim dead composite cells after their values have been copied to JS.
 * Rewinds the bump cursor past the last host region, discarding result
 * cells (callers must have finished reading). Never throws. Does NOT
 * reclaim host-input regions themselves, which append-only across reset
 * cycles by codegen design (~8 bytes per staged call, measured) — see
 * the memory-pressure notes in docs/mncs-pressure.md.
 *
 * Reclaim rule: applied after record reads (result cells) and after
 * `clip_end` (whose input cell would otherwise never be reclaimed —
 * arrange stages no views). Staged view/cell inputs for other modules
 * are reclaimed by the *next* stageView reset; their per-call retention
 * (≤368 bytes, rare call rates) is measured-negligible.
 */
function reclaim(module: HostBufferExports): void {
  try {
    module.mncs_host_buffer_reset();
  } catch {
    /* best effort: a failed reclaim only costs retained cells */
  }
}

/** Validate integer args for i64/u64 params (null when any is non-integer). */
function i64args(values: number[]): bigint[] | null {
  if (!values.every(Number.isInteger)) return null;
  return values.map(BigInt);
}

/** Validate one u32-range integer arg for i32 params. */
function u32arg(value: number): number | null {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff ? value : null;
}

/* ------------------------------------------------------------------ */
/* meter (`scratchtrack.meter.v1`, all scalar i64/bool)                 */
/* ------------------------------------------------------------------ */

interface MeterExports {
  ticks_per_beat: () => bigint;
  ticks_per_whole: () => bigint;
  denominator_valid: (denominator: bigint) => number;
  bar_ticks: (numerator: bigint, denominator: bigint) => bigint;
  step_ticks: (code: bigint) => bigint;
  steps_per_bar: (numerator: bigint, denominator: bigint, code: bigint) => bigint;
  quantize_tick: (tick: bigint, step: bigint) => bigint;
  clamp_midi: (note: bigint) => bigint;
  pad_midi: (root: bigint, interval: bigint, shift: bigint) => bigint;
  pitch_class: (note: bigint) => bigint;
  octave_of: (note: bigint) => bigint;
}

let meter: MeterExports | null = null;

const METER_FNS = [
  'ticks_per_beat', 'ticks_per_whole', 'denominator_valid', 'bar_ticks',
  'step_ticks', 'steps_per_bar', 'quantize_tick', 'clamp_midi',
  'pad_midi', 'pitch_class', 'octave_of',
];

async function instantiateMeter(bytes: ArrayBuffer): Promise<boolean> {
  // No imports: the module is fully self-contained (verified: zero
  // import entries in the compiled artifact).
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as Record<string, unknown>;
  if (!METER_FNS.every((k) => typeof exports[k] === 'function')) return false;
  meter = exports as unknown as MeterExports;
  return true;
}

/** Load and instantiate the meter module from raw bytes (tests, embedding). */
export async function initMeterWasmFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  return initModuleFromBytes('meter', bytes, instantiateMeter);
}

/** @deprecated Use {@link initMeterWasmFromBytes}. Kept for existing call sites. */
export async function initMncsWasmFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  return initMeterWasmFromBytes(bytes);
}

/** True once the compiled meter module is instantiated and callable. */
export function wasmMeterReady(): boolean {
  return meter !== null;
}

/** Compiled `bar_ticks` (MNCS authority, WASM-executed). Null when not loaded or invalid (-1). */
export function wasmMeterBarTicks(numerator: number, denominator: number): number | null {
  const a = i64args([numerator, denominator]);
  if (!meter || !a) return null;
  try {
    const result = meter.bar_ticks(a[0]!, a[1]!);
    noteWasmPath('bar_ticks');
    if (result < 0) return null;
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `denominator_valid`. */
export function wasmMeterDenominatorValid(denominator: number): boolean | null {
  const a = i64args([denominator]);
  if (!meter || !a) return null;
  try {
    const result = meter.denominator_valid(a[0]!);
    noteWasmPath('denominator_valid');
    return result === 1;
  } catch {
    return null;
  }
}

/** Compiled `step_ticks` (-1 sentinel → null). */
export function wasmMeterStepTicks(code: number): number | null {
  const a = i64args([code]);
  if (!meter || !a) return null;
  try {
    const result = meter.step_ticks(a[0]!);
    noteWasmPath('step_ticks');
    if (result < 0) return null;
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `steps_per_bar` (-1 sentinel → null). */
export function wasmMeterStepsPerBar(numerator: number, denominator: number, code: number): number | null {
  const a = i64args([numerator, denominator, code]);
  if (!meter || !a) return null;
  try {
    const result = meter.steps_per_bar(a[0]!, a[1]!, a[2]!);
    noteWasmPath('steps_per_bar');
    if (result < 0) return null;
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `quantize_tick`. */
export function wasmMeterQuantizeTick(tick: number, step: number): number | null {
  const a = i64args([tick, step]);
  if (!meter || !a) return null;
  try {
    const result = meter.quantize_tick(a[0]!, a[1]!);
    noteWasmPath('quantize_tick');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `clamp_midi`. */
export function wasmMeterClampMidi(note: number): number | null {
  const a = i64args([note]);
  if (!meter || !a) return null;
  try {
    const result = meter.clamp_midi(a[0]!);
    noteWasmPath('clamp_midi');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `pad_midi`. */
export function wasmMeterPadMidi(root: number, interval: number, shift: number): number | null {
  const a = i64args([root, interval, shift]);
  if (!meter || !a) return null;
  try {
    const result = meter.pad_midi(a[0]!, a[1]!, a[2]!);
    noteWasmPath('pad_midi');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `pitch_class`. */
export function wasmMeterPitchClass(note: number): number | null {
  const a = i64args([note]);
  if (!meter || !a) return null;
  try {
    const result = meter.pitch_class(a[0]!);
    noteWasmPath('pitch_class');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `octave_of`. */
export function wasmMeterOctaveOf(note: number): number | null {
  const a = i64args([note]);
  if (!meter || !a) return null;
  try {
    const result = meter.octave_of(a[0]!);
    noteWasmPath('octave_of');
    return Number(result);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* arrange (`scratchtrack.arrange.v1`): scalars + Clip records          */
/*                                                                     */
/* Clip crosses in canonical NAME-SORTED slot order                    */
/* (length, offset, start), verified field-by-field against the real   */
/* artifact: `sanitize_clip(10,20,5)` reads back as slots 20,5,10.     */
/* ------------------------------------------------------------------ */

interface ArrangeExports extends HostBufferExports, AllocExports {
  max_loop_takes: () => bigint;
  loop_take_allowed: (saved: bigint) => number;
  max_scratches: () => bigint;
  scratch_allowed: (count: bigint) => number;
  normalize_bpm: (bpm: bigint) => bigint;
  sanitize_clip: (start: bigint, length: bigint, offset: bigint, minLength: bigint) => bigint;
  clip_end: (clip: number) => bigint;
  clip_active: (localTick: bigint, lengthTicks: bigint) => number;
  clip_length_ticks: (lengthTicks: bigint) => bigint;
  move_start: (start: bigint, delta: bigint, upper: bigint) => bigint;
  resize_length: (length: bigint, delta: bigint, minLength: bigint, maxLength: bigint) => bigint;
  snip_valid: (start: bigint, length: bigint, split: bigint) => number;
  snip_left: (start: bigint, length: bigint, offset: bigint, split: bigint) => bigint;
  snip_right: (start: bigint, length: bigint, offset: bigint, split: bigint) => bigint;
  wrap_tick: (tick: bigint, modulus: bigint) => bigint;
  step_index: (position: bigint, stepTicks: bigint) => bigint;
  clamp_motif_bars: (bars: bigint) => bigint;
  motif_ticks: (barTicks: bigint, bars: bigint) => bigint;
  loop_start_tick: (start: bigint) => bigint;
  loop_end_tick: (start: bigint, end: bigint) => bigint;
}

let arrange: ArrangeExports | null = null;

const ARRANGE_FNS = [
  'max_loop_takes', 'loop_take_allowed', 'max_scratches', 'scratch_allowed',
  'normalize_bpm', 'sanitize_clip', 'clip_end', 'clip_active',
  'clip_length_ticks', 'move_start', 'resize_length', 'snip_valid',
  'snip_left', 'snip_right', 'wrap_tick', 'step_index',
  'clamp_motif_bars', 'motif_ticks', 'loop_start_tick', 'loop_end_tick',
];

async function instantiateArrange(bytes: ArrayBuffer): Promise<boolean> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as Record<string, unknown>;
  if (!ARRANGE_FNS.every((k) => typeof exports[k] === 'function')) return false;
  if (!(exports['memory'] instanceof WebAssembly.Memory)) return false;
  arrange = exports as unknown as ArrangeExports;
  return true;
}

/** Load and instantiate the arrange module from raw bytes (tests, embedding). */
export async function initArrangeWasmFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  return initModuleFromBytes('arrange', bytes, instantiateArrange);
}

/** True once the compiled arrange module is instantiated and callable. */
export function wasmArrangeReady(): boolean {
  return arrange !== null;
}

/** Whole-tick clip reference: mirrors MNCS record `Clip`. */
export interface WasmClipTicks { start: number; length: number; offset: number; }

/** Read a Clip cell (sorted slots length,offset,start) into JS values. */
function readClip(ptr: number): WasmClipTicks {
  if (!arrange) throw new Error('unreachable');
  const clip = {
    length: Number(readI64(arrange, ptr, 0)),
    offset: Number(readI64(arrange, ptr, 1)),
    start: Number(readI64(arrange, ptr, 2)),
  };
  reclaim(arrange);
  return clip;
}

/** Write a Clip cell in sorted slot order; returns the pointer. */
function writeClip(clip: WasmClipTicks): number | null {
  if (!arrange) return null;
  try {
    const ptr = arrange.mncs_alloc(24);
    const view = new DataView(arrange.memory.buffer);
    view.setBigInt64(ptr, BigInt(clip.length), true);
    view.setBigInt64(ptr + 8, BigInt(clip.offset), true);
    view.setBigInt64(ptr + 16, BigInt(clip.start), true);
    return ptr;
  } catch {
    return null;
  }
}

/** Compiled `sanitize_clip` (record return). */
export function wasmArrangeSanitizeClip(start: number, length: number, offset: number, minLength: number): WasmClipTicks | null {
  const a = i64args([start, length, offset, minLength]);
  if (!arrange || !a) return null;
  try {
    const ptr = Number(arrange.sanitize_clip(a[0]!, a[1]!, a[2]!, a[3]!));
    noteWasmPath('sanitize_clip');
    return readClip(ptr);
  } catch {
    return null;
  }
}

/** Compiled `clip_end` (record argument). */
export function wasmArrangeClipEnd(clip: WasmClipTicks): number | null {
  if (!arrange) return null;
  if (![clip.start, clip.length, clip.offset].every(Number.isInteger)) return null;
  const ptr = writeClip(clip);
  if (ptr === null) return null;
  try {
    const result = arrange.clip_end(ptr);
    noteWasmPath('clip_end');
    const end = Number(result);
    // The input cell is dead after the call, and arrange never stages
    // views (no other reset source), so reclaim here — otherwise drag
    // sessions would retain 24 bytes per move indefinitely.
    reclaim(arrange);
    return end;
  } catch {
    return null;
  }
}

/** Compiled `clip_active`. */
export function wasmArrangeClipActive(localTick: number, lengthTicks: number): boolean | null {
  const a = i64args([localTick, lengthTicks]);
  if (!arrange || !a) return null;
  try {
    const result = arrange.clip_active(a[0]!, a[1]!);
    noteWasmPath('clip_active');
    return result === 1;
  } catch {
    return null;
  }
}

/** Compiled `wrap_tick`. */
export function wasmArrangeWrapTick(tick: number, modulus: number): number | null {
  const a = i64args([tick, modulus]);
  if (!arrange || !a) return null;
  try {
    const result = arrange.wrap_tick(a[0]!, a[1]!);
    noteWasmPath('wrap_tick');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `step_index` (-1 sentinel → null). */
export function wasmArrangeStepIndex(position: number, stepTicks: number): number | null {
  const a = i64args([position, stepTicks]);
  if (!arrange || !a) return null;
  try {
    const result = arrange.step_index(a[0]!, a[1]!);
    noteWasmPath('step_index');
    if (result < 0) return null;
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `loop_take_allowed`. */
export function wasmArrangeLoopTakeAllowed(saved: number): boolean | null {
  const a = i64args([saved]);
  if (!arrange || !a) return null;
  try {
    const result = arrange.loop_take_allowed(a[0]!);
    noteWasmPath('loop_take_allowed');
    return result === 1;
  } catch {
    return null;
  }
}

/** Compiled `scratch_allowed`. */
export function wasmArrangeScratchAllowed(count: number): boolean | null {
  const a = i64args([count]);
  if (!arrange || !a) return null;
  try {
    const result = arrange.scratch_allowed(a[0]!);
    noteWasmPath('scratch_allowed');
    return result === 1;
  } catch {
    return null;
  }
}

/** Compiled `normalize_bpm`. */
export function wasmArrangeNormalizeBpm(bpm: number): number | null {
  const a = i64args([bpm]);
  if (!arrange || !a) return null;
  try {
    const result = arrange.normalize_bpm(a[0]!);
    noteWasmPath('normalize_bpm');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `clip_length_ticks`. */
export function wasmArrangeClipLengthTicks(lengthTicks: number): number | null {
  const a = i64args([lengthTicks]);
  if (!arrange || !a) return null;
  try {
    const result = arrange.clip_length_ticks(a[0]!);
    noteWasmPath('clip_length_ticks');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `move_start`. */
export function wasmArrangeMoveStart(start: number, delta: number, upper: number): number | null {
  const a = i64args([start, delta, upper]);
  if (!arrange || !a) return null;
  try {
    const result = arrange.move_start(a[0]!, a[1]!, a[2]!);
    noteWasmPath('move_start');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `resize_length`. */
export function wasmArrangeResizeLength(length: number, delta: number, minLength: number, maxLength: number): number | null {
  const a = i64args([length, delta, minLength, maxLength]);
  if (!arrange || !a) return null;
  try {
    const result = arrange.resize_length(a[0]!, a[1]!, a[2]!, a[3]!);
    noteWasmPath('resize_length');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `snip_valid`. */
export function wasmArrangeSnipValid(start: number, length: number, split: number): boolean | null {
  const a = i64args([start, length, split]);
  if (!arrange || !a) return null;
  try {
    const result = arrange.snip_valid(a[0]!, a[1]!, a[2]!);
    noteWasmPath('snip_valid');
    return result === 1;
  } catch {
    return null;
  }
}

/** Compiled `snip_left` / `snip_right` (record returns). */
export function wasmArrangeSnipHalves(start: number, length: number, offset: number, split: number): [WasmClipTicks, WasmClipTicks] | null {
  const a = i64args([start, length, offset, split]);
  if (!arrange || !a) return null;
  try {
    const left = Number(arrange.snip_left(a[0]!, a[1]!, a[2]!, a[3]!));
    const right = Number(arrange.snip_right(a[0]!, a[1]!, a[2]!, a[3]!));
    noteWasmPath('snip_left');
    noteWasmPath('snip_right');
    return [readClip(left), readClip(right)];
  } catch {
    return null;
  }
}

/** Compiled `clamp_motif_bars`. */
export function wasmArrangeClampMotifBars(bars: number): number | null {
  const a = i64args([bars]);
  if (!arrange || !a) return null;
  try {
    const result = arrange.clamp_motif_bars(a[0]!);
    noteWasmPath('clamp_motif_bars');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `motif_ticks`. */
export function wasmArrangeMotifTicks(barTicks: number, bars: number): number | null {
  const a = i64args([barTicks, bars]);
  if (!arrange || !a) return null;
  try {
    const result = arrange.motif_ticks(a[0]!, a[1]!);
    noteWasmPath('motif_ticks');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `loop_start_tick` / `loop_end_tick`. */
export function wasmArrangeLoopStartTick(start: number): number | null {
  const a = i64args([start]);
  if (!arrange || !a) return null;
  try {
    const result = arrange.loop_start_tick(a[0]!);
    noteWasmPath('loop_start_tick');
    return Number(result);
  } catch {
    return null;
  }
}

export function wasmArrangeLoopEndTick(start: number, end: number): number | null {
  const a = i64args([start, end]);
  if (!arrange || !a) return null;
  try {
    const result = arrange.loop_end_tick(a[0]!, a[1]!);
    noteWasmPath('loop_end_tick');
    return Number(result);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* migrate (`scratchtrack.migrate.v1`, all scalar i64/bool)             */
/* ------------------------------------------------------------------ */

interface MigrateExports {
  legacy_numerator: (beats: bigint) => bigint;
  remap_index: (step: bigint, fromSteps: bigint, toSteps: bigint) => bigint;
  remap_cell: (existing: bigint, incoming: bigint) => bigint;
  content_bars: (contentTicks: bigint, meterTicks: bigint) => bigint;
  normalize_root: (root: bigint) => bigint;
  normalize_octave: (octave: bigint) => bigint;
  auto_scratch_upgrade: (isV3OrLater: number, storedFlag: number) => number;
}

let migrate: MigrateExports | null = null;

const MIGRATE_FNS = [
  'legacy_numerator', 'remap_index', 'remap_cell', 'content_bars',
  'normalize_root', 'normalize_octave', 'auto_scratch_upgrade',
];

async function instantiateMigrate(bytes: ArrayBuffer): Promise<boolean> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as Record<string, unknown>;
  if (!MIGRATE_FNS.every((k) => typeof exports[k] === 'function')) return false;
  migrate = exports as unknown as MigrateExports;
  return true;
}

/** Load and instantiate the migrate module from raw bytes (tests, embedding). */
export async function initMigrateWasmFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  return initModuleFromBytes('migrate', bytes, instantiateMigrate);
}

/** True once the compiled migrate module is instantiated and callable. */
export function wasmMigrateReady(): boolean {
  return migrate !== null;
}

/** Compiled `legacy_numerator` (-1 sentinel → null). */
export function wasmMigrateLegacyNumerator(beats: number): number | null {
  const a = i64args([beats]);
  if (!migrate || !a) return null;
  try {
    const result = migrate.legacy_numerator(a[0]!);
    noteWasmPath('legacy_numerator');
    if (result < 0) return null;
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `remap_index`. */
export function wasmMigrateRemapIndex(step: number, fromSteps: number, toSteps: number): number | null {
  const a = i64args([step, fromSteps, toSteps]);
  if (!migrate || !a) return null;
  try {
    const result = migrate.remap_index(a[0]!, a[1]!, a[2]!);
    noteWasmPath('remap_index');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `remap_cell`. */
export function wasmMigrateRemapCell(existing: number, incoming: number): number | null {
  const a = i64args([existing, incoming]);
  if (!migrate || !a) return null;
  try {
    const result = migrate.remap_cell(a[0]!, a[1]!);
    noteWasmPath('remap_cell');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `content_bars`. */
export function wasmMigrateContentBars(contentTicks: number, meterTicks: number): number | null {
  const a = i64args([contentTicks, meterTicks]);
  if (!migrate || !a) return null;
  try {
    const result = migrate.content_bars(a[0]!, a[1]!);
    noteWasmPath('content_bars');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `normalize_root`. */
export function wasmMigrateNormalizeRoot(root: number): number | null {
  const a = i64args([root]);
  if (!migrate || !a) return null;
  try {
    const result = migrate.normalize_root(a[0]!);
    noteWasmPath('normalize_root');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `normalize_octave`. */
export function wasmMigrateNormalizeOctave(octave: number): number | null {
  const a = i64args([octave]);
  if (!migrate || !a) return null;
  try {
    const result = migrate.normalize_octave(a[0]!);
    noteWasmPath('normalize_octave');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `auto_scratch_upgrade` (bool args cross as 0/1 numbers). */
export function wasmMigrateAutoScratchUpgrade(isV3OrLater: boolean, storedFlag: boolean): boolean | null {
  if (!migrate) return null;
  try {
    const result = migrate.auto_scratch_upgrade(isV3OrLater ? 1 : 0, storedFlag ? 1 : 0);
    noteWasmPath('auto_scratch_upgrade');
    return result === 1;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* geometry (`scratchtrack.geometry.v1`): scalars + Bounds record       */
/* Bounds crosses in sorted slot order (end, start), verified:         */
/* `bucket_bounds(1000,3,10)` reads back as slots 400,300.             */
/* ------------------------------------------------------------------ */

interface GeometryExports extends HostBufferExports {
  is_beat_step: (step: bigint, stepsPerBeat: bigint) => number;
  swing_applies: (isTriplet: number, step: bigint) => number;
  steps_per_beat: (steps: bigint, numerator: bigint) => bigint;
  cycle_cell: (cell: bigint) => bigint;
  advance_step: (step: bigint, steps: bigint) => bigint;
  floor_div: (numerator: bigint, denominator: bigint) => bigint;
  row_delta: (dyPx: bigint, rowH: bigint) => bigint;
  drag_started: (dxPx: bigint, dyRows: bigint) => number;
  tap_cancelled: (dxPx: bigint, dyPx: bigint) => number;
  clamp_motif_midi: (midi: bigint) => bigint;
  shift_motif_midi: (midi: bigint, delta: bigint) => bigint;
  pick_row_midi: (hi: bigint, row: bigint, rowCount: bigint) => bigint;
  half_beatline_count: (motifTicks: bigint) => bigint;
  bucket_bounds: (length: bigint, bucket: bigint, count: bigint) => bigint;
  bucket_stride: (start: bigint, end: bigint) => bigint;
}

let geometry: GeometryExports | null = null;

const GEOMETRY_FNS = [
  'is_beat_step', 'swing_applies', 'steps_per_beat', 'cycle_cell',
  'advance_step', 'floor_div', 'row_delta', 'drag_started',
  'tap_cancelled', 'clamp_motif_midi', 'shift_motif_midi',
  'pick_row_midi', 'half_beatline_count', 'bucket_bounds', 'bucket_stride',
];

async function instantiateGeometry(bytes: ArrayBuffer): Promise<boolean> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as Record<string, unknown>;
  if (!GEOMETRY_FNS.every((k) => typeof exports[k] === 'function')) return false;
  if (!(exports['memory'] instanceof WebAssembly.Memory)) return false;
  geometry = exports as unknown as GeometryExports;
  return true;
}

/** Load and instantiate the geometry module from raw bytes (tests, embedding). */
export async function initGeometryWasmFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  return initModuleFromBytes('geometry', bytes, instantiateGeometry);
}

/** True once the compiled geometry module is instantiated and callable. */
export function wasmGeometryReady(): boolean {
  return geometry !== null;
}

/** Compiled `is_beat_step`. */
export function wasmGeometryIsBeatStep(step: number, stepsPerBeat: number): boolean | null {
  const a = i64args([step, stepsPerBeat]);
  if (!geometry || !a) return null;
  try {
    const result = geometry.is_beat_step(a[0]!, a[1]!);
    noteWasmPath('is_beat_step');
    return result === 1;
  } catch {
    return null;
  }
}

/** Compiled `swing_applies` (bool arg crosses as 0/1). */
export function wasmGeometrySwingApplies(isTriplet: boolean, step: number): boolean | null {
  const a = i64args([step]);
  if (!geometry || !a) return null;
  try {
    const result = geometry.swing_applies(isTriplet ? 1 : 0, a[0]!);
    noteWasmPath('swing_applies');
    return result === 1;
  } catch {
    return null;
  }
}

/** Compiled `steps_per_beat`. */
export function wasmGeometryStepsPerBeat(steps: number, numerator: number): number | null {
  const a = i64args([steps, numerator]);
  if (!geometry || !a) return null;
  try {
    const result = geometry.steps_per_beat(a[0]!, a[1]!);
    noteWasmPath('steps_per_beat');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `cycle_cell`. */
export function wasmGeometryCycleCell(cell: number): number | null {
  const a = i64args([cell]);
  if (!geometry || !a) return null;
  try {
    const result = geometry.cycle_cell(a[0]!);
    noteWasmPath('cycle_cell');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `advance_step`. */
export function wasmGeometryAdvanceStep(step: number, steps: number): number | null {
  const a = i64args([step, steps]);
  if (!geometry || !a) return null;
  try {
    const result = geometry.advance_step(a[0]!, a[1]!);
    noteWasmPath('advance_step');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `floor_div`. */
export function wasmGeometryFloorDiv(numerator: number, denominator: number): number | null {
  const a = i64args([numerator, denominator]);
  if (!geometry || !a) return null;
  try {
    const result = geometry.floor_div(a[0]!, a[1]!);
    noteWasmPath('floor_div');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `row_delta`. */
export function wasmGeometryRowDelta(dyPx: number, rowH: number): number | null {
  const a = i64args([dyPx, rowH]);
  if (!geometry || !a) return null;
  try {
    const result = geometry.row_delta(a[0]!, a[1]!);
    noteWasmPath('row_delta');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `drag_started`. */
export function wasmGeometryDragStarted(dxPx: number, dyRows: number): boolean | null {
  const a = i64args([dxPx, dyRows]);
  if (!geometry || !a) return null;
  try {
    const result = geometry.drag_started(a[0]!, a[1]!);
    noteWasmPath('drag_started');
    return result === 1;
  } catch {
    return null;
  }
}

/** Compiled `tap_cancelled`. */
export function wasmGeometryTapCancelled(dxPx: number, dyPx: number): boolean | null {
  const a = i64args([dxPx, dyPx]);
  if (!geometry || !a) return null;
  try {
    const result = geometry.tap_cancelled(a[0]!, a[1]!);
    noteWasmPath('tap_cancelled');
    return result === 1;
  } catch {
    return null;
  }
}

/** Compiled `clamp_motif_midi`. */
export function wasmGeometryClampMotifMidi(midi: number): number | null {
  const a = i64args([midi]);
  if (!geometry || !a) return null;
  try {
    const result = geometry.clamp_motif_midi(a[0]!);
    noteWasmPath('clamp_motif_midi');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `shift_motif_midi`. */
export function wasmGeometryShiftMotifMidi(midi: number, delta: number): number | null {
  const a = i64args([midi, delta]);
  if (!geometry || !a) return null;
  try {
    const result = geometry.shift_motif_midi(a[0]!, a[1]!);
    noteWasmPath('shift_motif_midi');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `pick_row_midi`. */
export function wasmGeometryPickRowMidi(hi: number, row: number, rowCount: number): number | null {
  const a = i64args([hi, row, rowCount]);
  if (!geometry || !a) return null;
  try {
    const result = geometry.pick_row_midi(a[0]!, a[1]!, a[2]!);
    noteWasmPath('pick_row_midi');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `half_beatline_count`. */
export function wasmGeometryHalfBeatlineCount(motifTicks: number): number | null {
  const a = i64args([motifTicks]);
  if (!geometry || !a) return null;
  try {
    const result = geometry.half_beatline_count(a[0]!);
    noteWasmPath('half_beatline_count');
    return Number(result);
  } catch {
    return null;
  }
}

/** Whole-sample waveform bucket window: mirrors MNCS record `Bounds`. */
export interface WasmSampleBounds { start: number; end: number; }

/** Compiled `bucket_bounds` (record return, sorted slots end,start). */
export function wasmGeometryBucketBounds(length: number, bucket: number, count: number): WasmSampleBounds | null {
  const a = i64args([length, bucket, count]);
  if (!geometry || !a) return null;
  try {
    const ptr = Number(geometry.bucket_bounds(a[0]!, a[1]!, a[2]!));
    noteWasmPath('bucket_bounds');
    const bounds = { end: Number(readI64(geometry, ptr, 0)), start: Number(readI64(geometry, ptr, 1)) };
    reclaim(geometry);
    return bounds;
  } catch {
    return null;
  }
}

/** Compiled `bucket_stride`. */
export function wasmGeometryBucketStride(start: number, end: number): number | null {
  const a = i64args([start, end]);
  if (!geometry || !a) return null;
  try {
    const result = geometry.bucket_stride(a[0]!, a[1]!);
    noteWasmPath('bucket_stride');
    return Number(result);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* wav (`scratchtrack.wav.v1`): u16/u32 scalars + exact-seq cells       */
/*                                                                     */
/* `[byte; 44]` / `[byte; 12]` args cross as canonical cells (one      */
/* 8-byte slot per byte); `magic_code` over a RIFF header cell         */
/* returns 1n, verified against the real artifact.                     */
/* ------------------------------------------------------------------ */

interface WavExports extends HostBufferExports, AllocExports {
  le_u16_at: (header: number, offset: bigint) => number;
  le_u32_at: (header: number, offset: bigint) => number;
  wav_format_tag: (header: number) => number;
  wav_channels: (header: number) => number;
  wav_sample_rate: (header: number) => number;
  wav_bits_per_sample: (header: number) => number;
  wav_data_size: (header: number) => number;
  header_magic_ok: (header: number) => number;
  header_decodable: (header: number) => number;
  bits_supported: (bits: number) => number;
  wav_sample_count: (dataSize: number) => number;
  wav_riff_chunk_size: (dataSize: number) => number;
  wav_data_size_for_samples: (samples: number) => number;
  wav_byte_rate: (sampleRate: number) => number;
  magic_code: (window: number) => bigint;
}

let wav: WavExports | null = null;

const WAV_FNS = [
  'le_u16_at', 'le_u32_at', 'wav_format_tag', 'wav_channels',
  'wav_sample_rate', 'wav_bits_per_sample', 'wav_data_size',
  'header_magic_ok', 'header_decodable', 'bits_supported',
  'wav_sample_count', 'wav_riff_chunk_size', 'wav_data_size_for_samples',
  'wav_byte_rate', 'magic_code',
];

async function instantiateWav(bytes: ArrayBuffer): Promise<boolean> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as Record<string, unknown>;
  if (!WAV_FNS.every((k) => typeof exports[k] === 'function')) return false;
  if (!(exports['memory'] instanceof WebAssembly.Memory)) return false;
  wav = exports as unknown as WavExports;
  return true;
}

/** Load and instantiate the wav module from raw bytes (tests, embedding). */
export async function initWavWasmFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  return initModuleFromBytes('wav', bytes, instantiateWav);
}

/** True once the compiled wav module is instantiated and callable. */
export function wasmWavReady(): boolean {
  return wav !== null;
}

/** Stage an exact N-byte window as a canonical cell (null unless length matches). */
function stageExactWindow(bytes: Uint8Array, exact: number): number | null {
  if (!wav || bytes.length !== exact) return null;
  return stageExactBytes(wav, bytes);
}

/** Compiled `magic_code` over exactly 12 leading bytes. */
export function wasmWavMagicCode(window: Uint8Array): number | null {
  const cell = stageExactWindow(window, 12);
  if (cell === null || !wav) return null;
  try {
    const result = wav.magic_code(cell);
    noteWasmPath('magic_code');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `header_magic_ok` over exactly 44 header bytes. */
export function wasmWavMagicOk(header: Uint8Array): boolean | null {
  const cell = stageExactWindow(header, 44);
  if (cell === null || !wav) return null;
  try {
    const result = wav.header_magic_ok(cell);
    noteWasmPath('header_magic_ok');
    return result === 1;
  } catch {
    return null;
  }
}

/** Compiled `header_decodable` over exactly 44 header bytes. */
export function wasmWavDecodable(header: Uint8Array): boolean | null {
  const cell = stageExactWindow(header, 44);
  if (cell === null || !wav) return null;
  try {
    const result = wav.header_decodable(cell);
    noteWasmPath('header_decodable');
    return result === 1;
  } catch {
    return null;
  }
}

/** Compiled `le_u16_at` over exactly 44 header bytes. */
export function wasmWavLeU16(header: Uint8Array, offset: number): number | null {
  const cell = stageExactWindow(header, 44);
  const a = i64args([offset]);
  if (cell === null || !wav || !a) return null;
  try {
    const result = wav.le_u16_at(cell, a[0]!);
    noteWasmPath('le_u16_at');
    return result;
  } catch {
    return null;
  }
}

/** Compiled `le_u32_at` over exactly 44 header bytes. */
export function wasmWavLeU32(header: Uint8Array, offset: number): number | null {
  const cell = stageExactWindow(header, 44);
  const a = i64args([offset]);
  if (cell === null || !wav || !a) return null;
  try {
    const result = wav.le_u32_at(cell, a[0]!);
    noteWasmPath('le_u32_at');
    return result;
  } catch {
    return null;
  }
}

/** Compiled `wav_sample_count` (u32 scalar). */
export function wasmWavSampleCount(dataSize: number): number | null {
  const v = u32arg(dataSize);
  if (!wav || v === null) return null;
  try {
    const result = wav.wav_sample_count(v);
    noteWasmPath('wav_sample_count');
    return result;
  } catch {
    return null;
  }
}

/** Compiled `wav_riff_chunk_size` (u32 scalar). */
export function wasmWavRiffChunkSize(dataSize: number): number | null {
  const v = u32arg(dataSize);
  if (!wav || v === null) return null;
  try {
    const result = wav.wav_riff_chunk_size(v);
    noteWasmPath('wav_riff_chunk_size');
    return result;
  } catch {
    return null;
  }
}

/** Compiled `wav_data_size_for_samples` (u32 scalar). */
export function wasmWavDataSizeForSamples(samples: number): number | null {
  const v = u32arg(samples);
  if (!wav || v === null) return null;
  try {
    const result = wav.wav_data_size_for_samples(v);
    noteWasmPath('wav_data_size_for_samples');
    return result;
  } catch {
    return null;
  }
}

/** Compiled `wav_byte_rate` (u32 scalar). */
export function wasmWavByteRate(sampleRate: number): number | null {
  const v = u32arg(sampleRate);
  if (!wav || v === null) return null;
  try {
    const result = wav.wav_byte_rate(v);
    noteWasmPath('wav_byte_rate');
    return result;
  } catch {
    return null;
  }
}

/** Compiled `bits_supported` (u16 scalar). */
export function wasmWavBitsSupported(bits: number): boolean | null {
  if (!wav || !Number.isInteger(bits) || bits < 0 || bits > 0xffff) return null;
  try {
    const result = wav.bits_supported(bits);
    noteWasmPath('bits_supported');
    return result === 1;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* pack (`scratchtrack.pack.v1`): u64/u32 scalars, cells, Entry record  */
/*                                                                     */
/* Entry crosses in sorted slot order (comment_len, crc, data_size,    */
/* extra_len, local_offset, name_len); `central_entry` over a staged   */
/* 46-byte window reads back field-exact, verified on the artifact.    */
/* ------------------------------------------------------------------ */

interface PackExports extends HostBufferExports, AllocExports {
  le16_46: (window: number, offset: bigint) => number;
  le32_46: (window: number, offset: bigint) => number;
  le16_22: (window: number, offset: bigint) => number;
  le32_22: (window: number, offset: bigint) => number;
  local_signature_ok: (window: number) => number;
  local_name_len: (window: number) => number;
  local_extra_len: (window: number) => number;
  local_data_size: (window: number) => number;
  local_data_start: (localOffset: bigint, nameLen: bigint, extraLen: bigint) => bigint;
  local_record_size: (nameLen: bigint, dataLen: bigint) => bigint;
  central_signature_ok: (window: number) => number;
  central_entry: (window: number) => bigint;
  central_next: (central: bigint, nameLen: bigint, extraLen: bigint, commentLen: bigint) => bigint;
  central_record_size: (nameLen: bigint) => bigint;
  eocd_signature_ok: (window: number) => number;
  eocd_count: (window: number) => number;
  eocd_central_size: (window: number) => number;
  eocd_central_offset: (window: number) => number;
  eocd_size: () => bigint;
}

let pack: PackExports | null = null;

const PACK_FNS = [
  'le16_46', 'le32_46', 'le16_22', 'le32_22', 'local_signature_ok',
  'local_name_len', 'local_extra_len', 'local_data_size',
  'local_data_start', 'local_record_size', 'central_signature_ok',
  'central_entry', 'central_next', 'central_record_size',
  'eocd_signature_ok', 'eocd_count', 'eocd_central_size',
  'eocd_central_offset', 'eocd_size',
];

async function instantiatePack(bytes: ArrayBuffer): Promise<boolean> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as Record<string, unknown>;
  if (!PACK_FNS.every((k) => typeof exports[k] === 'function')) return false;
  if (!(exports['memory'] instanceof WebAssembly.Memory)) return false;
  pack = exports as unknown as PackExports;
  return true;
}

/** Load and instantiate the pack module from raw bytes (tests, embedding). */
export async function initPackWasmFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  return initModuleFromBytes('pack', bytes, instantiatePack);
}

/** True once the compiled pack module is instantiated and callable. */
export function wasmPackReady(): boolean {
  return pack !== null;
}

/** Structured central-directory entry: mirrors MNCS record `Entry`. */
export interface WasmPackEntry {
  nameLen: number;
  extraLen: number;
  commentLen: number;
  localOffset: number;
  dataSize: number;
  crc: number;
}

/** Stage a 46-byte local/central window as a canonical cell. */
function stageWindow46(window: Uint8Array): number | null {
  if (!pack || window.length !== 46) return null;
  return stageExactBytes(pack, window);
}

/** Stage a 22-byte EOCD window as a canonical cell. */
function stageWindow22(window: Uint8Array): number | null {
  if (!pack || window.length !== 22) return null;
  return stageExactBytes(pack, window);
}

/** Compiled `le16_46` / `le32_46` over a 46-byte window plus intra-window offset. */
export function wasmPackLeU16At(window: Uint8Array, offset: number): number | null {
  const cell = stageWindow46(window);
  const a = i64args([offset]);
  if (cell === null || !pack || !a) return null;
  try {
    const result = pack.le16_46(cell, a[0]!);
    noteWasmPath('le16_46');
    return result;
  } catch {
    return null;
  }
}

export function wasmPackLeU32At(window: Uint8Array, offset: number): number | null {
  const cell = stageWindow46(window);
  const a = i64args([offset]);
  if (cell === null || !pack || !a) return null;
  try {
    const result = pack.le32_46(cell, a[0]!);
    noteWasmPath('le32_46');
    return result;
  } catch {
    return null;
  }
}

/** Compiled `local_signature_ok` over a 46-byte window. */
export function wasmPackLocalSignatureOk(window: Uint8Array): boolean | null {
  const cell = stageWindow46(window);
  if (cell === null || !pack) return null;
  try {
    const result = pack.local_signature_ok(cell);
    noteWasmPath('local_signature_ok');
    return result === 1;
  } catch {
    return null;
  }
}

/** Compiled `local_name_len` / `local_extra_len` / `local_data_size`. */
export function wasmPackLocalNameLen(window: Uint8Array): number | null {
  const cell = stageWindow46(window);
  if (cell === null || !pack) return null;
  try {
    const result = pack.local_name_len(cell);
    noteWasmPath('local_name_len');
    return result;
  } catch {
    return null;
  }
}

export function wasmPackLocalExtraLen(window: Uint8Array): number | null {
  const cell = stageWindow46(window);
  if (cell === null || !pack) return null;
  try {
    const result = pack.local_extra_len(cell);
    noteWasmPath('local_extra_len');
    return result;
  } catch {
    return null;
  }
}

export function wasmPackLocalDataSize(window: Uint8Array): number | null {
  const cell = stageWindow46(window);
  if (cell === null || !pack) return null;
  try {
    const result = pack.local_data_size(cell);
    noteWasmPath('local_data_size');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `local_data_start` / `local_record_size` (u64 scalars). */
export function wasmPackLocalDataStart(localOffset: number, nameLen: number, extraLen: number): number | null {
  const a = i64args([localOffset, nameLen, extraLen]);
  if (!pack || !a) return null;
  try {
    const result = pack.local_data_start(a[0]!, a[1]!, a[2]!);
    noteWasmPath('local_data_start');
    return Number(result);
  } catch {
    return null;
  }
}

export function wasmPackLocalRecordSize(nameLen: number, dataLen: number): number | null {
  const a = i64args([nameLen, dataLen]);
  if (!pack || !a) return null;
  try {
    const result = pack.local_record_size(a[0]!, a[1]!);
    noteWasmPath('local_record_size');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled `central_signature_ok` over a 46-byte window. */
export function wasmPackCentralSignatureOk(window: Uint8Array): boolean | null {
  const cell = stageWindow46(window);
  if (cell === null || !pack) return null;
  try {
    const result = pack.central_signature_ok(cell);
    noteWasmPath('central_signature_ok');
    return result === 1;
  } catch {
    return null;
  }
}

/** Compiled `central_entry` (Entry record return, sorted slots). */
export function wasmPackCentralEntry(window: Uint8Array): WasmPackEntry | null {
  const cell = stageWindow46(window);
  if (cell === null || !pack) return null;
  try {
    const ptr = Number(pack.central_entry(cell));
    noteWasmPath('central_entry');
    const view = new DataView(pack.memory.buffer);
    const entry = {
      commentLen: Number(view.getBigUint64(ptr, true)),
      crc: Number(view.getBigUint64(ptr + 8, true)),
      dataSize: Number(view.getBigUint64(ptr + 16, true)),
      extraLen: Number(view.getBigUint64(ptr + 24, true)),
      localOffset: Number(view.getBigUint64(ptr + 32, true)),
      nameLen: Number(view.getBigUint64(ptr + 40, true)),
    };
    reclaim(pack);
    return entry;
  } catch {
    return null;
  }
}

/** Compiled `central_next` / `central_record_size` (u64 scalars). */
export function wasmPackCentralNext(central: number, nameLen: number, extraLen: number, commentLen: number): number | null {
  const a = i64args([central, nameLen, extraLen, commentLen]);
  if (!pack || !a) return null;
  try {
    const result = pack.central_next(a[0]!, a[1]!, a[2]!, a[3]!);
    noteWasmPath('central_next');
    return Number(result);
  } catch {
    return null;
  }
}

export function wasmPackCentralRecordSize(nameLen: number): number | null {
  const a = i64args([nameLen]);
  if (!pack || !a) return null;
  try {
    const result = pack.central_record_size(a[0]!);
    noteWasmPath('central_record_size');
    return Number(result);
  } catch {
    return null;
  }
}

/** Compiled EOCD readers over a 22-byte window. */
export function wasmPackEocdSignatureOk(window: Uint8Array): boolean | null {
  const cell = stageWindow22(window);
  if (cell === null || !pack) return null;
  try {
    const result = pack.eocd_signature_ok(cell);
    noteWasmPath('eocd_signature_ok');
    return result === 1;
  } catch {
    return null;
  }
}

export function wasmPackEocdCount(window: Uint8Array): number | null {
  const cell = stageWindow22(window);
  if (cell === null || !pack) return null;
  try {
    const result = pack.eocd_count(cell);
    noteWasmPath('eocd_count');
    return result;
  } catch {
    return null;
  }
}

export function wasmPackEocdCentralSize(window: Uint8Array): number | null {
  const cell = stageWindow22(window);
  if (cell === null || !pack) return null;
  try {
    const result = pack.eocd_central_size(cell);
    noteWasmPath('eocd_central_size');
    return Number(result);
  } catch {
    return null;
  }
}

export function wasmPackEocdCentralOffset(window: Uint8Array): number | null {
  const cell = stageWindow22(window);
  if (cell === null || !pack) return null;
  try {
    const result = pack.eocd_central_offset(cell);
    noteWasmPath('eocd_central_offset');
    return Number(result);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* text (`scratchtrack.text.v1`): view ABI + Position record            */
/* Position crosses in sorted slot order (bar, beat, sixth, valid),    */
/* already sorted in declaration order; verified on the artifact.      */
/* ------------------------------------------------------------------ */

interface TextExports extends HostBufferExports {
  is_digit: (value: number) => number;
  parse_position: (view: bigint) => bigint;
  position_ticks: (bar: bigint, beat: bigint, sixth: bigint, barTicks: bigint) => bigint;
}

let text: TextExports | null = null;

const TEXT_FNS = ['is_digit', 'parse_position', 'position_ticks', 'mncs_host_buffer', 'mncs_host_buffer_reset'];

async function instantiateText(bytes: ArrayBuffer): Promise<boolean> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as Record<string, unknown>;
  if (!TEXT_FNS.every((k) => typeof exports[k] === 'function')) return false;
  if (!(exports['memory'] instanceof WebAssembly.Memory)) return false;
  text = exports as unknown as TextExports;
  return true;
}

/** Load and instantiate the text module from raw bytes (tests, embedding). */
export async function initTextWasmFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  return initModuleFromBytes('text', bytes, instantiateText);
}

/** @deprecated Use {@link initTextWasmFromBytes}. Kept for existing call sites. */
export async function initMncsTextWasmFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  return initTextWasmFromBytes(bytes);
}

/** True once the compiled text module is instantiated and callable. */
export function wasmTextReady(): boolean {
  return text !== null;
}

export interface WasmPositionParts {
  bar: number;
  beat: number;
  sixth: number;
}

/**
 * Compiled `parse_position` (MNCS authority, WASM-executed) over the
 * host-buffer view ABI. Returns null when the module is not loaded, the
 * input exceeds the 64-byte MNCS view bound, or the text is invalid
 * (`valid` flag clear) — every null falls back to the projection, which
 * agrees on all three cases by corpus.
 */
export function wasmTextParsePosition(input: string): WasmPositionParts | null {
  if (!text) return null;
  const encoded = new TextEncoder().encode(input);
  const descriptor = stageView(text, encoded);
  if (descriptor === null) return null;
  try {
    const resultPtr = Number(text.parse_position(descriptor));
    const view = new DataView(text.memory.buffer);
    const bar = view.getBigUint64(resultPtr, true);
    const beat = view.getBigUint64(resultPtr + 8, true);
    const sixth = view.getBigUint64(resultPtr + 16, true);
    const valid = view.getInt32(resultPtr + 24, true);
    if (valid !== 1) return null;
    noteWasmPath('parse_position');
    const parts = { bar: Number(bar), beat: Number(beat), sixth: Number(sixth) };
    reclaim(text);
    return parts;
  } catch {
    return null;
  }
}

/**
 * Compiled `position_ticks` (MNCS authority, WASM-executed). Returns null
 * when the module is not loaded or the parts are out of range (-1).
 */
export function wasmTextPositionTicks(
  bar: number,
  beat: number,
  sixth: number,
  barTicks: number,
): number | null {
  const a = i64args([bar, beat, sixth, barTicks]);
  if (!text || !a) return null;
  try {
    const result = text.position_ticks(a[0]!, a[1]!, a[2]!, a[3]!);
    noteWasmPath('position_ticks');
    if (result < 0) return null;
    return Number(result);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* crc (`scratchtrack.crc.v1`): streaming checksum windows              */
/* ------------------------------------------------------------------ */

interface CrcExports extends HostBufferExports {
  crc_init: () => bigint;
  crc_update: (crc: bigint, window: bigint) => bigint;
  crc_finalize: (crc: bigint) => bigint;
  crc_of: (window: bigint) => bigint;
}

let crc: CrcExports | null = null;

const CRC_FNS = ['crc_init', 'crc_update', 'crc_finalize', 'crc_of', 'mncs_host_buffer', 'mncs_host_buffer_reset'];

async function instantiateCrc(bytes: ArrayBuffer): Promise<boolean> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as Record<string, unknown>;
  if (!CRC_FNS.every((k) => typeof exports[k] === 'function')) return false;
  if (!(exports['memory'] instanceof WebAssembly.Memory)) return false;
  crc = exports as unknown as CrcExports;
  return true;
}

/** Load and instantiate the CRC module from raw bytes (tests, embedding). */
export async function initCrcWasmFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  return initModuleFromBytes('crc', bytes, instantiateCrc);
}

/** @deprecated Use {@link initCrcWasmFromBytes}. Kept for existing call sites. */
export async function initMncsCrcWasmFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  return initCrcWasmFromBytes(bytes);
}

/** True once the compiled CRC module is instantiated and callable. */
export function wasmCrcReady(): boolean {
  return crc !== null;
}

/** Compiled `crc_init` (raw streaming state). Null when not loaded. */
export function wasmCrcInit(): number | null {
  if (!crc) return null;
  try {
    const result = Number(crc.crc_init());
    noteWasmPath('crc_init');
    return result;
  } catch {
    return null;
  }
}

/**
 * Compiled `crc_update` over one <=64-byte window. Null when not loaded
 * or the window exceeds the MNCS view bound.
 */
export function wasmCrcUpdate(state: number, window: Uint8Array): number | null {
  if (!crc) return null;
  if (!Number.isInteger(state) || state < 0) return null;
  const descriptor = stageView(crc, window);
  if (descriptor === null) return null;
  try {
    const result = Number(crc.crc_update(BigInt(state), descriptor));
    noteWasmPath('crc_update');
    return result;
  } catch {
    return null;
  }
}

/** Compiled `crc_finalize`: raw state to checksum. Null when not loaded. */
export function wasmCrcFinalize(state: number): number | null {
  if (!crc) return null;
  if (!Number.isInteger(state) || state < 0) return null;
  try {
    const result = Number(crc.crc_finalize(BigInt(state))) >>> 0;
    noteWasmPath('crc_finalize');
    return result;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Generic init machinery: fetch, digest-verify, per-module states      */
/* ------------------------------------------------------------------ */

type ClearModule = (value: null) => void;

const CLEARERS: Record<MncsModuleName, ClearModule> = {
  meter: (v) => { meter = v; },
  arrange: (v) => { arrange = v; },
  migrate: (v) => { migrate = v; },
  geometry: (v) => { geometry = v; },
  wav: (v) => { wav = v; },
  pack: (v) => { pack = v; },
  text: (v) => { text = v; },
  crc: (v) => { crc = v; },
};

function toBytes(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  return bytes instanceof Uint8Array
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    : bytes;
}

/**
 * Byte-provided init shared by all modules (tests, embedding). Never
 * throws; records failed state with reason on bad bytes. Verification
 * is skipped: the caller owns these bytes.
 */
async function initModuleFromBytes(
  name: MncsModuleName,
  bytes: ArrayBuffer | Uint8Array,
  instantiate: (raw: ArrayBuffer) => Promise<boolean>,
): Promise<boolean> {
  const ongoingBytes = inFlightLoad[name];
  if (ongoingBytes) return ongoingBytes;
  const runBytes = (async () => {
    setState(name, 'loading');
    try {
      const ok = await instantiate(toBytes(bytes));
      setState(name, ok ? 'ready' : 'failed', ok ? null : 'export shape mismatch');
      return ok;
    } catch (error) {
      CLEARERS[name](null);
      setState(name, 'failed', error instanceof Error ? error.message : 'instantiate threw');
      return false;
    }
  })();
  inFlightLoad[name] = runBytes;
  try {
    return await runBytes;
  } finally {
    if (inFlightLoad[name] === runBytes) inFlightLoad[name] = null;
  }
}

async function fetchBytes(path: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

function hexBytes(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify fetched bytes against the served manifest digest. Returns true
 * when verification passes OR cannot run (no SubtleCrypto in this
 * context — documented, only affects non-secure contexts); false on an
 * actual digest mismatch (stale/mismatched artifact → module fails).
 */
async function verifyDigest(name: MncsModuleName, bytes: ArrayBuffer): Promise<boolean> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}mncs/manifest.json`, { cache: 'no-store' });
    if (!response.ok) return true;
    const manifest = (await response.json()) as {
      artifacts?: Array<{ artifact?: string; artifact_sha256?: string }>;
    };
    const entry = manifest.artifacts?.find((a) => a.artifact === `public/mncs/${name}.wasm`);
    if (!entry?.artifact_sha256) return true;
    if (typeof crypto === 'undefined' || !crypto.subtle) return true;
    const digest = hexBytes(await crypto.subtle.digest('SHA-256', bytes));
    return digest === entry.artifact_sha256;
  } catch {
    return true;
  }
}

const INSTANTIATORS: Record<MncsModuleName, (raw: ArrayBuffer) => Promise<boolean>> = {
  meter: instantiateMeter,
  arrange: instantiateArrange,
  migrate: instantiateMigrate,
  geometry: instantiateGeometry,
  wav: instantiateWav,
  pack: instantiatePack,
  text: instantiateText,
  crc: instantiateCrc,
};

/**
 * Load one module over HTTP. Never throws. A failed module stays failed
 * (with reason in `mncsModuleError`) until retried explicitly with
 * `{ retry: true }`; ready modules are never re-fetched.
 */
export async function initMncsModule(name: MncsModuleName, opts?: { retry?: boolean }): Promise<boolean> {
  const state = moduleState[name];
  if (state === 'ready') return true;
  if (state === 'failed' && !opts?.retry) return false;
  const ongoing = inFlightLoad[name];
  if (ongoing) return ongoing;
  const run = (async () => {
    setState(name, 'loading');
    const bytes = await fetchBytes(MODULE_FILES[name]);
    if (!bytes) {
      setState(name, 'failed', 'fetch failed');
      return false;
    }
    if (!(await verifyDigest(name, bytes))) {
      setState(name, 'failed', 'digest mismatch vs manifest (stale artifact?)');
      return false;
    }
    try {
      const ok = await INSTANTIATORS[name](bytes);
      setState(name, ok ? 'ready' : 'failed', ok ? null : 'export shape mismatch');
      return ok;
    } catch (error) {
      CLEARERS[name](null);
      setState(name, 'failed', error instanceof Error ? error.message : 'instantiate threw');
      return false;
    }
  })();
  inFlightLoad[name] = run;
  try {
    return await run;
  } finally {
    if (inFlightLoad[name] === run) inFlightLoad[name] = null;
  }
}

/**
 * Load all modules over HTTP (browser production path). Never throws.
 * Failure is isolated per module; returns true when at least the meter
 * module (the original authority path) is ready.
 */
export async function initMncsWasm(): Promise<boolean> {
  const names: MncsModuleName[] = ['meter', 'arrange', 'migrate', 'geometry', 'wav', 'pack', 'text', 'crc'];
  const results = await Promise.all(names.map((name) => initMncsModule(name)));
  return results[0] === true;
}

/**
 * Unload every module (tests only): clears instances, states, and errors
 * without touching path counters. Guarantees projection tests exercise
 * the pure fallback path even if a runner ever shares module registries
 * across test files.
 */
export function unloadMncsModules(): void {
  meter = null; arrange = null; migrate = null; geometry = null;
  wav = null; pack = null; text = null; crc = null;
  const names: MncsModuleName[] = ['meter', 'arrange', 'migrate', 'geometry', 'wav', 'pack', 'text', 'crc'];
  for (const name of names) setState(name, 'unloaded');
}
