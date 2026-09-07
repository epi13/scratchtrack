import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  initMncsCrcWasmFromBytes,
  initMncsTextWasmFromBytes,
  initMncsWasmFromBytes,
  wasmCrcReady,
  wasmMeterBarTicks,
  wasmMeterReady,
  wasmTextParsePosition,
  wasmTextPositionTicks,
  wasmTextReady,
} from './mncsWasm';
import { mncsCrc32 } from './mncsCrc';
import { barTicks, parsePosition } from './music';

const ARTIFACT = new URL('../public/mncs/meter.wasm', import.meta.url);
const TEXT_ARTIFACT = new URL('../public/mncs/text.wasm', import.meta.url);
const CRC_ARTIFACT = new URL('../public/mncs/crc.wasm', import.meta.url);

/**
 * Production-WASM boundary: the checked-in artifact (built from
 * `mncs/meter.mncs` by `scripts/mncs-wasm-build.sh`) instantiates with
 * zero imports and answers `bar_ticks` through the thin host ABI. Skips
 * when the artifact is absent (build it with the script or in CI); the
 * verifier's freshness check, not this test, guards staleness.
 */
describe('production MNCS WASM execution', () => {
  it('calls compiled bar_ticks through the loader', async () => {
    if (!existsSync(ARTIFACT)) {
      console.warn('skipping: build public/mncs/meter.wasm first (scripts/mncs-wasm-build.sh)');
      return;
    }
    expect(await initMncsWasmFromBytes(readFileSync(ARTIFACT))).toBe(true);
    expect(wasmMeterReady()).toBe(true);
    expect(wasmMeterBarTicks(4, 4)).toBe(96);
    expect(wasmMeterBarTicks(7, 8)).toBe(84);
    expect(wasmMeterBarTicks(4, 3)).toBeNull();
    // The production call site agrees once loaded.
    expect(barTicks({ numerator: 4, denominator: 4 })).toBe(96);
    expect(barTicks({ numerator: 7, denominator: 8 })).toBe(84);
  });

  it('calls compiled parse_position through the host-buffer ABI', async () => {
    if (!existsSync(TEXT_ARTIFACT)) {
      console.warn('skipping: build public/mncs/text.wasm first (scripts/mncs-wasm-build.sh)');
      return;
    }
    expect(await initMncsTextWasmFromBytes(readFileSync(TEXT_ARTIFACT))).toBe(true);
    expect(wasmTextReady()).toBe(true);
    expect(wasmTextParsePosition('7.3.2')).toEqual({ bar: 7, beat: 3, sixth: 2 });
    expect(wasmTextParsePosition('7')).toEqual({ bar: 7, beat: 1, sixth: 0 });
    expect(wasmTextParsePosition('')).toEqual({ bar: 0, beat: 1, sixth: 0 });
    expect(wasmTextParsePosition('a')).toBeNull();
    expect(wasmTextParsePosition('1.2.3.4')).toBeNull();
    expect(wasmTextParsePosition('x'.repeat(65))).toBeNull();
    expect(wasmTextPositionTicks(7, 3, 2, 96)).toBe(636);
    expect(wasmTextPositionTicks(2, 99, 0, 96)).toBeNull();
    // The production call site agrees once loaded.
    expect(parsePosition('7.3.2', { numerator: 4, denominator: 4 })).toBe(636 / 24);
    expect(parsePosition('bogus', { numerator: 4, denominator: 4 })).toBeNull();
  });

  it('streams compiled crc_update through chunked windows', async () => {
    if (!existsSync(CRC_ARTIFACT)) {
      console.warn('skipping: build public/mncs/crc.wasm first (scripts/mncs-wasm-build.sh)');
      return;
    }
    expect(await initMncsCrcWasmFromBytes(readFileSync(CRC_ARTIFACT))).toBe(true);
    expect(wasmCrcReady()).toBe(true);
    // The production call site agrees once loaded (WASM-chunked path).
    expect(mncsCrc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const big = new Uint8Array(200);
    for (let i = 0; i < big.length; i += 1) big[i] = (i * 37 + 11) & 0xff;
    expect(mncsCrc32(big)).toBe(0xfe79c9f4);
  });

  it('degrades to the projection when the module is absent', async () => {
    expect(await initMncsWasmFromBytes(new Uint8Array([0, 1, 2, 3]))).toBe(false);
    expect(await initMncsTextWasmFromBytes(new Uint8Array([0, 1, 2, 3]))).toBe(false);
    expect(await initMncsCrcWasmFromBytes(new Uint8Array([0, 1, 2, 3]))).toBe(false);
  });
});
