import { describe, expect, it } from 'vitest';
import {
  mncsAdvanceStep,
  mncsBucketBounds,
  mncsBucketStride,
  mncsClampMotifMidi,
  mncsCycleCell,
  mncsDragStarted,
  mncsFloorDiv,
  mncsHalfBeatlineCount,
  mncsIsBeatStep,
  mncsPickRowMidi,
  mncsRowDelta,
  mncsShiftMotifMidi,
  mncsStepsPerBeat,
  mncsSwingApplies,
  mncsTapCancelled,
} from './mncsGeometry';

/**
 * Conformance: the TypeScript projection must agree function-for-function
 * with `mncs/geometry.mncs` (`scratchtrack.geometry.v1`). Every vector
 * below is also a case in `mncs/geometry-corpus.json`, executed through
 * the MNCS toolchain on the portable-WASM and research-bytecode backends
 * (52/52 returned with expectations met on both; see
 * docs/mncs-pressure.md). If this test and the corpus disagree, the bug is
 * here, never in MNCS source.
 */
describe('mncsGeometry conformance with scratchtrack.geometry.v1', () => {
  it('classifies beat steps (corpus: beat-*)', () => {
    expect(mncsIsBeatStep(8, 4)).toBe(true);
    expect(mncsIsBeatStep(6, 4)).toBe(false);
    expect(mncsIsBeatStep(0, 4)).toBe(true);
    expect(mncsIsBeatStep(3, 0)).toBe(false);
  });

  it('phases swing steps (corpus: swing-*)', () => {
    expect(mncsSwingApplies(false, 1)).toBe(true);
    expect(mncsSwingApplies(false, 2)).toBe(false);
    expect(mncsSwingApplies(true, 2)).toBe(true);
    expect(mncsSwingApplies(true, 1)).toBe(false);
  });

  it('spaces beat markers (corpus: spb-*)', () => {
    expect(mncsStepsPerBeat(16, 4)).toBe(4);
    expect(mncsStepsPerBeat(14, 7)).toBe(2);
    expect(mncsStepsPerBeat(12, 5)).toBe(2);
    expect(mncsStepsPerBeat(0, 4)).toBe(1);
  });

  it('cycles cells and advances previews (corpus: cycle-*, advance-*)', () => {
    expect(mncsCycleCell(0)).toBe(1);
    expect(mncsCycleCell(1)).toBe(2);
    expect(mncsCycleCell(2)).toBe(0);
    expect(mncsAdvanceStep(15, 16)).toBe(0);
    expect(mncsAdvanceStep(3, 16)).toBe(4);
    expect(mncsAdvanceStep(3, 0)).toBe(0);
  });

  it('divides with floor rounding (corpus: fdiv-*)', () => {
    expect(mncsFloorDiv(7, 2)).toBe(3);
    expect(mncsFloorDiv(-7, 2)).toBe(-4);
    expect(mncsFloorDiv(-1, 52)).toBe(-1);
    expect(mncsFloorDiv(-52, 52)).toBe(-1);
    expect(mncsFloorDiv(0, 52)).toBe(0);
  });

  it('matches Math.round for row deltas across drag distances (corpus: row-*)', () => {
    expect(mncsRowDelta(0, 26)).toBe(0);
    expect(mncsRowDelta(12, 26)).toBe(0);
    expect(mncsRowDelta(13, 26)).toBe(1);
    expect(mncsRowDelta(-13, 26)).toBe(0);
    expect(mncsRowDelta(-14, 26)).toBe(-1);
    expect(mncsRowDelta(-39, 26)).toBe(-1);
    // Exhaustive cross-check against the inlined expression (===: +0 and
    // the oracle's -0 at exact negative ties are the same value).
    for (let dy = -260; dy <= 260; dy += 1) {
      expect(mncsRowDelta(dy, 26) === Math.round(dy / 26)).toBe(true);
    }
  });

  it('interprets drag and tap thresholds (corpus: drag-*, tap-*)', () => {
    expect(mncsDragStarted(5, 0)).toBe(true);
    expect(mncsDragStarted(0, 1)).toBe(true);
    expect(mncsDragStarted(-5, 0)).toBe(true);
    expect(mncsDragStarted(4, 0)).toBe(false);
    expect(mncsTapCancelled(7, 0)).toBe(true);
    expect(mncsTapCancelled(0, -7)).toBe(true);
    expect(mncsTapCancelled(6, 6)).toBe(false);
  });

  it('clamps and shifts motif MIDI (corpus: midi-*, shift-*)', () => {
    expect(mncsClampMotifMidi(11)).toBe(12);
    expect(mncsClampMotifMidi(109)).toBe(108);
    expect(mncsClampMotifMidi(60)).toBe(60);
    expect(mncsShiftMotifMidi(60, 12)).toBe(72);
    expect(mncsShiftMotifMidi(100, 12)).toBe(108);
    expect(mncsShiftMotifMidi(60, -12)).toBe(48);
  });

  it('picks piano-roll rows (corpus: row-midi-*)', () => {
    expect(mncsPickRowMidi(72, 0, 25)).toBe(72);
    expect(mncsPickRowMidi(72, 24, 25)).toBe(48);
    expect(mncsPickRowMidi(72, 99, 25)).toBe(48);
  });

  it('counts half-beat grid lines (corpus: beatlines-*)', () => {
    expect(mncsHalfBeatlineCount(96)).toBe(8);
    expect(mncsHalfBeatlineCount(84)).toBe(7);
    expect(mncsHalfBeatlineCount(0)).toBe(0);
  });

  it('partitions waveform buckets (corpus: bucket-*)', () => {
    expect(mncsBucketBounds(1000, 0, 120)).toEqual({ start: 0, end: 8 });
    expect(mncsBucketBounds(1000, 5, 120)).toEqual({ start: 40, end: 48 });
    expect(mncsBucketStride(40, 48)).toBe(1);
    expect(mncsBucketStride(0, 441)).toBe(4);
    // Partition tiles the buffer without gaps for the first buckets.
    const first = mncsBucketBounds(44100, 0, 120);
    expect(first).toEqual({ start: 0, end: 367 });
    expect(mncsBucketStride(first.start, first.end)).toBe(4);
  });
});
