import { describe, expect, it } from 'vitest';
import {
  mncsAutoScratchUpgrade,
  mncsContentBars,
  mncsLegacyNumerator,
  mncsNormalizeOctave,
  mncsNormalizeRoot,
  mncsRemapCell,
  mncsRemapIndex,
} from './mncsMigrate';
import { remapPattern } from './music';

/**
 * Conformance: the TypeScript projection must agree function-for-function
 * with `mncs/migrate.mncs` (`scratchtrack.migrate.v1`). Every vector below
 * is also a case in `mncs/migrate-corpus.json`, executed through the MNCS
 * toolchain on the portable-WASM and research-bytecode backends (37/37
 * returned with expectations met on both; see docs/mncs-pressure.md). If
 * this test and the corpus disagree, the bug is here, never in MNCS source.
 */
describe('mncsMigrate conformance with scratchtrack.migrate.v1', () => {
  it('maps legacy beatsPerBar onto v4 numerators (corpus: legacy-*)', () => {
    expect(mncsLegacyNumerator(4)).toBe(4);
    expect(mncsLegacyNumerator(3)).toBe(3);
    expect(mncsLegacyNumerator(32)).toBe(32);
    expect(mncsLegacyNumerator(1)).toBe(1);
    expect(mncsLegacyNumerator(0)).toBe(-1);
    expect(mncsLegacyNumerator(33)).toBe(-1);
    expect(mncsLegacyNumerator(-2)).toBe(-1);
  });

  it('remaps steps to nearest musical positions (corpus: remap-*)', () => {
    expect(mncsRemapIndex(0, 16, 12)).toBe(0);
    expect(mncsRemapIndex(8, 16, 12)).toBe(6);
    expect(mncsRemapIndex(2, 16, 12)).toBe(2);
    expect(mncsRemapIndex(15, 16, 12)).toBe(11);
    expect(mncsRemapIndex(7, 16, 14)).toBe(6);
    expect(mncsRemapIndex(5, 4, 2)).toBe(1);
    expect(mncsRemapIndex(-1, 16, 12)).toBe(0);
    expect(mncsRemapIndex(3, 0, 8)).toBe(7);
    // Exact tie (15*11/22 = 7.5): deterministic round-up (corpus: remap-tie).
    expect(mncsRemapIndex(15, 22, 11)).toBe(8);
  });

  it('matches the legacy float remap except exact ties, which now round up', () => {
    // Exhaustive cross-check over the product grid range: the exact form
    // agrees with the old float formula everywhere except exact .5 ties
    // (160/1048385 combos), where float dust fell down and MNCS rounds up
    // deterministically. Evidence: docs/mncs-pressure.md D-003.
    const legacy = (step: number, from: number, to: number) => {
      const beat = (step / Math.max(1, from)) * to;
      return Math.min(to - 1, Math.max(0, Math.floor(beat + 0.5)));
    };
    let ties = 0;
    for (let from = 2; from <= 128; from += 1) {
      for (let to = 2; to <= 128; to += 1) {
        for (let step = 0; step < from; step += 1) {
          const mine = mncsRemapIndex(step, from, to);
          const old = legacy(step, from, to);
          if (mine === old) continue;
          // Tie condition: 2*step*to/from is an odd integer.
          expect((2 * step * to) % (2 * from)).toBe(from);
          expect(mine).toBe(old + 1);
          ties += 1;
        }
      }
    }
    expect(ties).toBe(160);
  });

  it('keeps stronger hits on collisions (corpus: cell-*)', () => {
    expect(mncsRemapCell(1, 2)).toBe(2);
    expect(mncsRemapCell(2, 1)).toBe(2);
    expect(mncsRemapCell(1, 1)).toBe(1);
    expect(mncsRemapCell(0, 0)).toBe(0);
  });

  it('spans content bars with ceiling division (corpus: bars-*)', () => {
    expect(mncsContentBars(192, 96)).toBe(2);
    expect(mncsContentBars(84, 84)).toBe(1);
    expect(mncsContentBars(97, 96)).toBe(2);
    expect(mncsContentBars(0, 96)).toBe(0);
    expect(mncsContentBars(50, 0)).toBe(1);
  });

  it('normalizes key roots and octaves (corpus: root-*, octave-*)', () => {
    expect(mncsNormalizeRoot(0)).toBe(0);
    expect(mncsNormalizeRoot(14)).toBe(2);
    expect(mncsNormalizeRoot(-1)).toBe(11);
    expect(mncsNormalizeRoot(-13)).toBe(11);
    expect(mncsNormalizeRoot(25)).toBe(1);
    expect(mncsNormalizeOctave(0)).toBe(1);
    expect(mncsNormalizeOctave(3)).toBe(3);
    expect(mncsNormalizeOctave(7)).toBe(6);
    expect(mncsNormalizeOctave(-2)).toBe(1);
  });

  it('upgrades Auto Scratch for pre-v3 documents (corpus: auto-*)', () => {
    expect(mncsAutoScratchUpgrade(true, true)).toBe(true);
    expect(mncsAutoScratchUpgrade(true, false)).toBe(false);
    expect(mncsAutoScratchUpgrade(false, false)).toBe(true);
    expect(mncsAutoScratchUpgrade(false, true)).toBe(true);
  });

  it('drives remapPattern through the MNCS rule', () => {
    const rows: number[][] = [[2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0]];
    const remapped = remapPattern(rows, 16, 12);
    expect(remapped[0]).toHaveLength(12);
    expect(remapped[0]![0]).toBe(2);
    expect(remapped[0]![6]).toBe(2);
  });
});
