/**
 * TypeScript projection of `mncs/crc.mncs` (`scratchtrack.crc.v1`).
 *
 * IEEE 802.3 CRC32 over arbitrary-length input. MNCS owns the algorithm
 * (`crc_init` / `crc_update` / `crc_finalize` over <=64-byte windows; the
 * 256-entry byte table does not fit the 64-element sequence bound, so the
 * module uses a 16-entry nibble table with per-bit-arithmetic XOR —
 * see mncs/crc.mncs). The host owns chunking: inputs longer than 64
 * bytes stream window by window, which is exact because CRC update is
 * chunk-associative (pinned by the `stream*` corpus cases).
 *
 * Execution order per call is WASM-first (compiled `crc_update` through
 * the host-buffer view ABI, instantiated at boot by `initMncsWasm`),
 * falling back to the table engine below. Both agree by
 * `mncs/crc-corpus.json`; any intentional divergence is a bug in this
 * file, never in MNCS source.
 */

import { wasmCrcFinalize, wasmCrcInit, wasmCrcReady, wasmCrcUpdate, wasmFirst } from './mncsWasm';

/** MNCS window bound: `crc_update` takes `[byte; up_to 64]`. */
export const MNCS_CRC_WINDOW = 64;

const CRC_TABLE = new Uint32Array(256);
for (let byte = 0; byte < 256; byte += 1) {
  let crc = byte;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (0xedb88320 ^ (crc >>> 1)) : crc >>> 1;
  CRC_TABLE[byte] = crc >>> 0;
}

/** Table engine: finalized CRC32 of `data` from raw state `state`. */
export function mncsCrc32Table(data: Uint8Array, state = 0xffffffff): number {
  let crc = state >>> 0;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return crc >>> 0;
}

/** MNCS `crc_init` (raw state, not yet finalized). */
export function mncsCrcInit(): number {
  return 0xffffffff;
}

/** MNCS `crc_finalize`: raw state to checksum. */
export function mncsCrcFinalize(state: number): number {
  return (state ^ 0xffffffff) >>> 0;
}

/**
 * MNCS CRC32 over arbitrary input: WASM-chunked streaming first,
 * table engine fallback. Returns the finalized checksum.
 */
export function mncsCrc32(data: Uint8Array): number {
  if (wasmCrcReady()) {
    let state = wasmCrcInit();
    if (state !== null) {
      for (let offset = 0; offset < data.length; offset += MNCS_CRC_WINDOW) {
        const next = wasmCrcUpdate(state, data.subarray(offset, offset + MNCS_CRC_WINDOW));
        if (next === null) {
          state = null;
          break;
        }
        state = next;
      }
      if (state !== null) {
        const final = wasmCrcFinalize(state);
        if (final !== null) return final;
      }
    }
  }
  return wasmFirst('crc32_table', null, () => mncsCrcFinalize(mncsCrc32Table(data)));
}
