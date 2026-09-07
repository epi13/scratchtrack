import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  initArrangeWasmFromBytes,
  initCrcWasmFromBytes,
  initGeometryWasmFromBytes,
  initMeterWasmFromBytes,
  initMigrateWasmFromBytes,
  initMncsModule,
  initPackWasmFromBytes,
  initTextWasmFromBytes,
  initWavWasmFromBytes,
  mncsModuleError,
  mncsModuleState,
  mncsPathStats,
  resetMncsPathStats,
  wasmArrangeClipActive,
  wasmArrangeClipEnd,
  wasmArrangeSanitizeClip,
  wasmArrangeStepIndex,
  wasmArrangeWrapTick,
  wasmCrcReady,
  wasmGeometryBucketBounds,
  wasmGeometryFloorDiv,
  wasmGeometryIsBeatStep,
  wasmGeometrySwingApplies,
  wasmMeterBarTicks,
  wasmMeterReady,
  wasmMigrateAutoScratchUpgrade,
  wasmMigrateRemapIndex,
  wasmPackCentralEntry,
  wasmPackEocdCount,
  wasmPackLocalDataStart,
  wasmTextParsePosition,
  wasmTextPositionTicks,
  wasmTextReady,
  wasmWavMagicCode,
  wasmWavSampleCount,
} from './mncsWasm';
import { mncsCrc32 } from './mncsCrc';
import { barTicks, parsePosition } from './music';

const ART = (name: string) => new URL(`../public/mncs/${name}.wasm`, import.meta.url);

async function initAllReal(): Promise<boolean> {
  const pairs: Array<[string, (b: Uint8Array) => Promise<boolean>]> = [
    ['meter', initMeterWasmFromBytes],
    ['arrange', initArrangeWasmFromBytes],
    ['migrate', initMigrateWasmFromBytes],
    ['geometry', initGeometryWasmFromBytes],
    ['wav', initWavWasmFromBytes],
    ['pack', initPackWasmFromBytes],
    ['text', initTextWasmFromBytes],
    ['crc', initCrcWasmFromBytes],
  ];
  const results = await Promise.all(
    pairs.map(([name, init]) => init(new Uint8Array(readFileSync(ART(name))))),
  );
  return results.every(Boolean);
}

/**
 * Production-WASM boundary: every checked-in artifact (built from
 * `mncs/*.mncs` by `scripts/mncs-wasm-build.sh`) instantiates with zero
 * imports and answers through the thin host ABI. Skips when artifacts
 * are absent; the verifier's freshness check, not this test, guards
 * staleness.
 */
describe('production MNCS WASM execution (all modules)', () => {
  it('loads all eight modules and reports ready states', async () => {
    expect(await initAllReal()).toBe(true);
    for (const name of ['meter', 'arrange', 'migrate', 'geometry', 'wav', 'pack', 'text', 'crc'] as const) {
      expect(mncsModuleState(name)).toBe('ready');
      expect(mncsModuleError(name)).toBeNull();
    }
    expect(wasmMeterReady()).toBe(true);
    expect(wasmTextReady()).toBe(true);
    expect(wasmCrcReady()).toBe(true);
  });

  it('calls compiled bar_ticks through the loader', async () => {
    await initAllReal();
    expect(wasmMeterBarTicks(4, 4)).toBe(96);
    expect(wasmMeterBarTicks(7, 8)).toBe(84);
    expect(wasmMeterBarTicks(4, 3)).toBeNull();
    expect(barTicks({ numerator: 4, denominator: 4 })).toBe(96);
    expect(barTicks({ numerator: 7, denominator: 8 })).toBe(84);
  });

  it('calls arrange record and scalar kernels', async () => {
    await initAllReal();
    expect(wasmArrangeSanitizeClip(10, 20, 5, 1)).toEqual({ start: 10, length: 20, offset: 5 });
    expect(wasmArrangeClipEnd({ start: 10, length: 20, offset: 5 })).toBe(30);
    expect(wasmArrangeClipActive(5, 96)).toBe(true);
    expect(wasmArrangeWrapTick(-1, 96)).toBe(95);
    expect(wasmArrangeStepIndex(48, 6)).toBe(8);
    expect(wasmArrangeStepIndex(50, 6)).toBeNull();
  });

  it('calls migrate and geometry kernels', async () => {
    await initAllReal();
    expect(wasmMigrateRemapIndex(8, 16, 12)).toBe(6);
    expect(wasmMigrateAutoScratchUpgrade(true, false)).toBe(false);
    expect(wasmGeometryIsBeatStep(8, 4)).toBe(true);
    expect(wasmGeometrySwingApplies(false, 1)).toBe(true);
    expect(wasmGeometryFloorDiv(-7, 2)).toBe(-4);
    expect(wasmGeometryBucketBounds(1000, 3, 10)).toEqual({ start: 300, end: 400 });
  });

  it('calls wav/pack cell kernels and pack record returns', async () => {
    await initAllReal();
    const riff = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    expect(wasmWavMagicCode(riff)).toBe(1);
    expect(wasmWavMagicCode(new Uint8Array(12))).toBe(0);
    expect(wasmWavMagicCode(new Uint8Array(11))).toBeNull();
    expect(wasmWavSampleCount(960)).toBe(480);
    const win46 = new Uint8Array(46);
    new DataView(win46.buffer).setUint32(0, 0x04034b50, true);
    expect(wasmPackLocalDataStart(0, 12, 0)).toBe(42);
    const central = new Uint8Array(46);
    const cv = new DataView(central.buffer);
    cv.setUint16(28, 5, true);
    cv.setUint32(42, 100, true);
    cv.setUint32(24, 1000, true);
    cv.setUint32(16, 0x12345678, true);
    expect(wasmPackCentralEntry(central)).toEqual({
      nameLen: 5, extraLen: 0, commentLen: 0, localOffset: 100, dataSize: 1000, crc: 0x12345678,
    });
    const eocd = new Uint8Array(22);
    new DataView(eocd.buffer).setUint16(10, 3, true);
    expect(wasmPackEocdCount(eocd)).toBe(3);
  });

  it('calls compiled parse_position through the host-buffer ABI', async () => {
    await initAllReal();
    expect(wasmTextParsePosition('7.3.2')).toEqual({ bar: 7, beat: 3, sixth: 2 });
    expect(wasmTextParsePosition('7')).toEqual({ bar: 7, beat: 1, sixth: 0 });
    expect(wasmTextParsePosition('')).toEqual({ bar: 0, beat: 1, sixth: 0 });
    expect(wasmTextParsePosition('a')).toBeNull();
    expect(wasmTextParsePosition('1.2.3.4')).toBeNull();
    expect(wasmTextParsePosition('x'.repeat(65))).toBeNull();
    expect(wasmTextPositionTicks(7, 3, 2, 96)).toBe(636);
    expect(wasmTextPositionTicks(2, 99, 0, 96)).toBeNull();
    expect(parsePosition('7.3.2', { numerator: 4, denominator: 4 })).toBe(636 / 24);
    expect(parsePosition('bogus', { numerator: 4, denominator: 4 })).toBeNull();
  });

  it('streams compiled crc_update through chunked windows', async () => {
    await initAllReal();
    expect(mncsCrc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const big = new Uint8Array(200);
    for (let i = 0; i < big.length; i += 1) big[i] = (i * 37 + 11) & 0xff;
    expect(mncsCrc32(big)).toBe(0xfe79c9f4);
  });

  it('attributes execution paths per function', async () => {
    await initAllReal();
    resetMncsPathStats();
    wasmMeterBarTicks(4, 4);
    expect(mncsPathStats()['bar_ticks']).toEqual({ wasm: 1, fallback: 0 });
    // A failed module records fallback hits on the projection path.
    await initMeterWasmFromBytes(new Uint8Array([0, 1, 2, 3]));
    expect(wasmMeterBarTicks(4, 4)).toBeNull();
    expect(barTicks({ numerator: 4, denominator: 4 })).toBe(96);
    expect(mncsPathStats()['bar_ticks']).toEqual({ wasm: 1, fallback: 1 });
    await initAllReal();
  });

  it('isolates failure per module and allows retry', async () => {
    // Bad bytes fail one module without touching the others.
    expect(await initMeterWasmFromBytes(new Uint8Array([0, 1, 2, 3]))).toBe(false);
    expect(mncsModuleState('meter')).toBe('failed');
    expect(mncsModuleError('meter')).not.toBeNull();
    // initMncsModule without retry refuses to refetch a failed module…
    expect(await initMncsModule('meter')).toBe(false);
    // …while explicit retry reloads it fine.
    await initAllReal();
    expect(mncsModuleState('meter')).toBe('ready');
    expect(wasmMeterBarTicks(4, 4)).toBe(96);
  });

  it('degrades to the projection when a module is absent', async () => {
    expect(await initMeterWasmFromBytes(new Uint8Array([0, 1, 2, 3]))).toBe(false);
    expect(await initTextWasmFromBytes(new Uint8Array([0, 1, 2, 3]))).toBe(false);
    expect(await initCrcWasmFromBytes(new Uint8Array([0, 1, 2, 3]))).toBe(false);
    // Production call sites still answer via projection fallback.
    expect(barTicks({ numerator: 4, denominator: 4 })).toBe(96);
    expect(parsePosition('7.3', { numerator: 4, denominator: 4 })).toBe(26);
  });
});
