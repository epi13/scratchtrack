import { describe, expect, it } from 'vitest';
import { mncsParsePositionText, mncsPositionTicks } from './mncsText';
import { TICKS_PER_BEAT, parsePosition } from './music';
import type { TimeSignature } from './types';

/**
 * Conformance: the TypeScript projection must agree function-for-function
 * with `mncs/text.mncs` (`scratchtrack.text.v1`). Every vector below is
 * also a case in `mncs/text-corpus.json`, executed through the MNCS
 * toolchain on the portable-WASM and research-bytecode backends (23/23
 * returned with expectations met on both; see docs/mncs-pressure.md). If
 * this test and the corpus disagree, the bug is here, never in MNCS
 * source.
 */
const ts = (numerator: number, denominator: 2 | 4 | 8 | 16): TimeSignature => ({ numerator, denominator });

describe('mncsText conformance with scratchtrack.text.v1', () => {
  it('parses strict positions (corpus: full, bar-only, bar-beat, zeros, leading-zeros)', () => {
    expect(mncsParsePositionText('7.3.2')).toEqual({ bar: 7, beat: 3, sixth: 2 });
    expect(mncsParsePositionText('7')).toEqual({ bar: 7, beat: 1, sixth: 0 });
    expect(mncsParsePositionText('11.8')).toEqual({ bar: 11, beat: 8, sixth: 0 });
    expect(mncsParsePositionText('')).toEqual({ bar: 0, beat: 1, sixth: 0 });
    expect(mncsParsePositionText('7..2')).toEqual({ bar: 7, beat: 0, sixth: 2 });
    expect(mncsParsePositionText('1.1.0')).toEqual({ bar: 1, beat: 1, sixth: 0 });
    expect(mncsParsePositionText('04.02.01')).toEqual({ bar: 4, beat: 2, sixth: 1 });
  });

  it('rejects non-grammar input (corpus: letter-*, four-parts, space, negative)', () => {
    expect(mncsParsePositionText('a')).toBeNull();
    expect(mncsParsePositionText('7.3x')).toBeNull();
    expect(mncsParsePositionText('1.2.3.4')).toBeNull();
    expect(mncsParsePositionText('7 ')).toBeNull();
    expect(mncsParsePositionText('-1')).toBeNull();
    expect(mncsParsePositionText('0x10')).toBeNull();
    expect(mncsParsePositionText('1e3')).toBeNull();
    expect(mncsParsePositionText('7 3')).toBeNull();
    expect(mncsParsePositionText('x'.repeat(65))).toBeNull();
  });

  it('computes tick positions with range policy (corpus: ticks-*)', () => {
    expect(mncsPositionTicks(7, 3, 2, 96)).toBe(636);
    expect(mncsPositionTicks(1, 1, 0, 96)).toBe(0);
    expect(mncsPositionTicks(5, 3, 0, 96)).toBe(432);
    expect(mncsPositionTicks(2, 1, 0, 84)).toBe(84);
    expect(mncsPositionTicks(1, 2, 3, 96)).toBe(42);
    expect(mncsPositionTicks(0, 0, 9, 96)).toBe(18);
    expect(mncsPositionTicks(2, 99, 0, 96)).toBe(-1);
    expect(mncsPositionTicks(999, 1, 0, 96)).toBe(-1);
    expect(mncsPositionTicks(17, 1, 0, 96)).toBe(1536);
  });

  it('drives parsePosition end to end on strict inputs', () => {
    expect(parsePosition('1.1', ts(4, 4))).toBe(0);
    expect(parsePosition('5.3', ts(4, 4))).toBe(18);
    expect(parsePosition('7.3', ts(4, 4))).toBe(26);
    expect(parsePosition('2.1', ts(7, 8))).toBe(3.5);
    expect(parsePosition('1.2.3', ts(4, 4))).toBeCloseTo(1.75, 10);
    expect(parsePosition('bogus', ts(4, 4))).toBeNull();
    expect(parsePosition('', ts(4, 4))).toBeNull();
    expect(parsePosition('999.1', ts(4, 4))).toBeNull();
  });

  it('matches exact rational positions across meters and grids', () => {
    // Independent oracle: exact tick math, no floats. Beats sweep only the
    // in-range domain (wholeBeat <= ceil(barTicks / 24)); out-of-range
    // inputs are covered by the range-policy vectors above.
    for (const [numerator, denominator, barTicks] of [[4, 4, 96], [7, 8, 84], [5, 4, 120], [13, 16, 78]] as const) {
      const meter = ts(numerator, denominator as 2 | 4 | 8 | 16);
      const maxBeat = Math.ceil(barTicks / 24);
      for (let bar = 1; bar <= 8; bar += 1) {
        for (let beat = 1; beat <= maxBeat; beat += 1) {
          for (let sixth = 0; sixth <= 3; sixth += 1) {
            const expected = ((bar - 1) * barTicks + (beat - 1) * 24 + sixth * 6) / TICKS_PER_BEAT;
            expect(parsePosition(`${bar}.${beat}.${sixth}`, meter)).toBe(expected);
          }
        }
      }
      // One past the range is null in every meter.
      expect(parsePosition(`1.${maxBeat + 1}.0`, meter)).toBeNull();
    }
  });
});
