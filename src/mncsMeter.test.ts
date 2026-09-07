import { describe, expect, it } from 'vitest';
import {
  SUBDIVISION_CODES,
  codeToSubdivision,
  mncsBarTicks,
  mncsClampMidi,
  mncsOctaveOf,
  mncsPadMidi,
  mncsPitchClass,
  mncsQuantizeTick,
  mncsStepTicks,
  mncsStepsPerBar,
  subdivisionToCode,
} from './mncsMeter';

/**
 * Conformance: the TypeScript projection must agree function-for-function
 * with `mncs/meter.mncs` (`scratchtrack.meter.v1`). Every vector below is
 * also a case in `mncs/meter-corpus.json`, executed through the MNCS
 * toolchain on the portable-WASM and research-bytecode backends (33/33
 * agree; see docs/mncs-pressure.md). If this test and the corpus disagree,
 * the bug is here, never in the MNCS source.
 */
describe('mncsMeter conformance with scratchtrack.meter.v1', () => {
  it('maps subdivision codes 0..5 to labels and back', () => {
    expect(SUBDIVISION_CODES).toEqual(['1/4', '1/8', '1/8t', '1/16', '1/16t', '1/32']);
    expect(subdivisionToCode('1/8t')).toBe(2);
    expect(codeToSubdivision(5)).toBe('1/32');
    expect(codeToSubdivision(6)).toBeNull();
    expect(codeToSubdivision(-1)).toBeNull();
  });

  it('computes exact bar ticks (corpus: bar-*)', () => {
    expect(mncsBarTicks(4, 4)).toBe(96);
    expect(mncsBarTicks(5, 4)).toBe(120);
    expect(mncsBarTicks(7, 8)).toBe(84);
    expect(mncsBarTicks(11, 8)).toBe(132);
    expect(mncsBarTicks(13, 16)).toBe(78);
    expect(mncsBarTicks(3, 2)).toBe(144);
    expect(mncsBarTicks(4, 3)).toBeNull();
    expect(mncsBarTicks(0, 4)).toBeNull();
    expect(mncsBarTicks(33, 4)).toBeNull();
  });

  it('maps step codes to ticks (corpus: step-*)', () => {
    expect(mncsStepTicks(0)).toBe(24);
    expect(mncsStepTicks(2)).toBe(8);
    expect(mncsStepTicks(4)).toBe(4);
    expect(mncsStepTicks(5)).toBe(3);
    expect(mncsStepTicks(6)).toBeNull();
  });

  it('computes steps per bar and rejects unalignable grids (corpus: steps-*)', () => {
    expect(mncsStepsPerBar(4, 4, '1/16')).toBe(16);
    expect(mncsStepsPerBar(7, 8, '1/16')).toBe(14);
    expect(mncsStepsPerBar(4, 4, '1/8t')).toBe(12);
    expect(mncsStepsPerBar(5, 8, '1/16t')).toBe(15);
    expect(mncsStepsPerBar(7, 8, '1/8t')).toBeNull();
    expect(mncsStepsPerBar(13, 16, '1/8t')).toBeNull();
  });

  it('quantizes ticks with half-up rounding (corpus: quantize-*)', () => {
    expect(mncsQuantizeTick(79, 6)).toBe(78);
    expect(mncsQuantizeTick(81, 6)).toBe(84);
    expect(mncsQuantizeTick(3, 0)).toBe(3);
    expect(mncsQuantizeTick(-7, 6)).toBe(-6);
    expect(mncsQuantizeTick(-9, 6)).toBe(-12);
  });

  it('clamps and derives MIDI notes (corpus: clamp-*, pad-*, pitch-*, octave-*)', () => {
    expect(mncsClampMidi(-5)).toBe(0);
    expect(mncsClampMidi(200)).toBe(127);
    expect(mncsPadMidi(48, 0, 0)).toBe(48);
    expect(mncsPadMidi(48, 0, 1)).toBe(60);
    expect(mncsPadMidi(120, 0, 1)).toBe(127);
    expect(mncsPitchClass(60)).toBe(0);
    expect(mncsPitchClass(59)).toBe(11);
    expect(mncsOctaveOf(60)).toBe(4);
  });

  it('keeps every bar length on the 24-tick grid across the product range', () => {
    for (let numerator = 1; numerator <= 32; numerator += 1) {
      for (const denominator of [2, 4, 8, 16]) {
        const ticks = mncsBarTicks(numerator, denominator);
        expect(ticks).not.toBeNull();
        expect(Number.isInteger(ticks)).toBe(true);
      }
    }
  });
});
