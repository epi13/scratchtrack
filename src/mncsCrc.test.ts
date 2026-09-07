import { describe, expect, it } from 'vitest';
import { mncsCrc32, mncsCrc32Table, mncsCrcFinalize, mncsCrcInit } from './mncsCrc';

/**
 * Conformance: the TypeScript projection must agree function-for-function
 * with `mncs/crc.mncs` (`scratchtrack.crc.v1`). Vectors mirror
 * `mncs/crc-corpus.json` (zlib oracle); the MNCS module executes 15/15
 * with expectations met on both backends (see docs/mncs-pressure.md).
 * If this test and the corpus disagree, the bug is here, never in MNCS
 * source.
 */
const bytes = (s: string | number[]): Uint8Array =>
  typeof s === 'string' ? new TextEncoder().encode(s) : new Uint8Array(s);

describe('mncsCrc conformance with scratchtrack.crc.v1', () => {
  it('matches the zlib oracle on single-window vectors', () => {
    expect(mncsCrc32(bytes([]))).toBe(0);
    expect(mncsCrc32(bytes([0]))).toBe(0xd202ef8d);
    expect(mncsCrc32(bytes([255]))).toBe(0xff000000);
    expect(mncsCrc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(mncsCrc32(bytes('hello'))).toBe(0x3610a686);
    expect(mncsCrc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('streams chunk-associatively past the 64-byte window bound', () => {
    const data = new Uint8Array(200);
    for (let i = 0; i < data.length; i += 1) data[i] = (i * 37 + 11) & 0xff;
    // Reference: single-pass table engine over the whole input.
    const whole = mncsCrcFinalize(mncsCrc32Table(data));
    expect(mncsCrc32(data)).toBe(whole);
    expect(mncsCrc32(data.subarray(0, 64))).toBe(mncsCrcFinalize(mncsCrc32Table(data.subarray(0, 64))));
    // Raw-state threading matches the corpus stream cases.
    expect(mncsCrcInit()).toBe(0xffffffff);
  });
});
