/**
 * Thin host ABI over compiled MNCS WASM modules.
 *
 * This is the production execution path for MNCS authority: `meter.wasm`,
 * `text.wasm`, and `crc.wasm` are built from the checked-in `mncs/*.mncs` by
 * `scripts/mncs-wasm-build.sh` (byte-deterministic; the manifest binds
 * each artifact to its source SHA-256 and compiler revision, and CI
 * rebuilds and fails on mismatch). Both modules have zero host imports.
 *
 * Boundary rules, all observed against the real artifacts:
 * - instantiation is async; every export call after that is synchronous.
 * - `i64` crosses as BigInt, `bool`/`byte` as 0/1 numbers.
 * - the MNCS `-1` sentinel maps to null (see `mncsMeter.ts`).
 * - byte views cross through the documented host-buffer ABI
 *   (`mncs-codegen`: `mncs_host_buffer(n)` reserves `n` bytes and returns
 *   packed capacity/offset; the host writes UTF-8 bytes at the offset and
 *   passes `offset | len << 32` as the view descriptor; records return as
 *   pointers to 8-byte-slot canonical cells). Each call resets the
 *   allocator past the host region first, so one call's composite cells
 *   never alias the next call's input bytes; linear memory grows by one
 *   small region per call at most.
 * - init never throws: without an artifact (offline first run, missing
 *   toolchain at build time) every entry degrades to "not ready" and
 *   callers use the conformance-pinned TypeScript projection instead.
 *   Both paths agree by corpus; the projection is the fallback, never a
 *   second authority.
 */

interface MeterExports {
  bar_ticks: (numerator: bigint, denominator: bigint) => bigint;
}

interface TextExports {
  memory: WebAssembly.Memory;
  mncs_host_buffer: (bytes: number) => bigint;
  mncs_host_buffer_reset: () => void;
  is_digit: (value: number) => number;
  parse_position: (view: bigint) => bigint;
  position_ticks: (bar: bigint, beat: bigint, sixth: bigint, barTicks: bigint) => bigint;
}

interface CrcExports {
  memory: WebAssembly.Memory;
  mncs_host_buffer: (bytes: number) => bigint;
  mncs_host_buffer_reset: () => void;
  crc_init: () => bigint;
  crc_update: (crc: bigint, window: bigint) => bigint;
  crc_finalize: (crc: bigint) => bigint;
  crc_of: (window: bigint) => bigint;
}

let meter: MeterExports | null = null;
let text: TextExports | null = null;
let crc: CrcExports | null = null;
let initAttempted = false;

/** Stage raw bytes into the module's host region; returns the view descriptor. */
function stageView(module: CrcExports | TextExports, bytes: Uint8Array): bigint | null {
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

async function instantiateMeter(bytes: ArrayBuffer): Promise<boolean> {
  // No imports: the module is fully self-contained (verified: zero
  // import entries in the compiled artifact).
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as Record<string, unknown>;
  if (typeof exports['bar_ticks'] !== 'function') return false;
  meter = exports as unknown as MeterExports;
  return true;
}

async function instantiateText(bytes: ArrayBuffer): Promise<boolean> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as Record<string, unknown>;
  if (
    typeof exports['parse_position'] !== 'function' ||
    typeof exports['position_ticks'] !== 'function' ||
    typeof exports['mncs_host_buffer'] !== 'function' ||
    typeof exports['mncs_host_buffer_reset'] !== 'function' ||
    !(exports['memory'] instanceof WebAssembly.Memory)
  ) {
    return false;
  }
  text = exports as unknown as TextExports;
  return true;
}

/** Load and instantiate the meter module from raw bytes (tests, embedding). */
export async function initMncsWasmFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  initAttempted = true;
  try {
    const view = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
    return await instantiateMeter(view as ArrayBuffer);
  } catch {
    meter = null;
    return false;
  }
}

/** Load and instantiate the text module from raw bytes (tests, embedding). */
export async function initMncsTextWasmFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  try {
    const view = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
    return await instantiateText(view as ArrayBuffer);
  } catch {
    text = null;
    return false;
  }
}

async function instantiateCrc(bytes: ArrayBuffer): Promise<boolean> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports as Record<string, unknown>;
  if (
    typeof exports['crc_update'] !== 'function' ||
    typeof exports['crc_finalize'] !== 'function' ||
    typeof exports['crc_init'] !== 'function' ||
    typeof exports['mncs_host_buffer'] !== 'function' ||
    typeof exports['mncs_host_buffer_reset'] !== 'function' ||
    !(exports['memory'] instanceof WebAssembly.Memory)
  ) {
    return false;
  }
  crc = exports as unknown as CrcExports;
  return true;
}

/** Load and instantiate the CRC module from raw bytes (tests, embedding). */
export async function initMncsCrcWasmFromBytes(bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  try {
    const view = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
    return await instantiateCrc(view as ArrayBuffer);
  } catch {
    crc = null;
    return false;
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

/** Load all modules over HTTP (browser production path). Never throws. */
export async function initMncsWasm(): Promise<boolean> {
  if (meter && text && crc) return true;
  if (initAttempted) return meter !== null;
  initAttempted = true;
  const [meterBytes, textBytes, crcBytes] = await Promise.all([
    fetchBytes('mncs/meter.wasm'),
    fetchBytes('mncs/text.wasm'),
    fetchBytes('mncs/crc.wasm'),
  ]);
  if (meterBytes) await initMncsWasmFromBytes(meterBytes);
  if (textBytes) await initMncsTextWasmFromBytes(textBytes);
  if (crcBytes) await initMncsCrcWasmFromBytes(crcBytes);
  return meter !== null;
}

/** True once the compiled meter module is instantiated and callable. */
export function wasmMeterReady(): boolean {
  return meter !== null;
}

/** True once the compiled text module is instantiated and callable. */
export function wasmTextReady(): boolean {
  return text !== null;
}

/**
 * Compiled `bar_ticks` (MNCS authority, WASM-executed). Returns null when
 * the module is not loaded or the combination is invalid (-1 sentinel).
 */
export function wasmMeterBarTicks(numerator: number, denominator: number): number | null {
  if (!meter) return null;
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) return null;
  try {
    const result = meter.bar_ticks(BigInt(numerator), BigInt(denominator));
    if (result < 0) return null;
    return Number(result);
  } catch {
    return null;
  }
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
    return { bar: Number(bar), beat: Number(beat), sixth: Number(sixth) };
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
  if (!text) return null;
  if (![bar, beat, sixth, barTicks].every(Number.isInteger)) return null;
  try {
    const result = text.position_ticks(BigInt(bar), BigInt(beat), BigInt(sixth), BigInt(barTicks));
    if (result < 0) return null;
    return Number(result);
  } catch {
    return null;
  }
}

/** True once the compiled CRC module is instantiated and callable. */
export function wasmCrcReady(): boolean {
  return crc !== null;
}

/** Compiled `crc_init` (raw streaming state). Null when not loaded. */
export function wasmCrcInit(): number | null {
  if (!crc) return null;
  try {
    return Number(crc.crc_init());
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
    return Number(crc.crc_update(BigInt(state), descriptor));
  } catch {
    return null;
  }
}

/** Compiled `crc_finalize`: raw state to checksum. Null when not loaded. */
export function wasmCrcFinalize(state: number): number | null {
  if (!crc) return null;
  if (!Number.isInteger(state) || state < 0) return null;
  try {
    return Number(crc.crc_finalize(BigInt(state))) >>> 0;
  } catch {
    return null;
  }
}
