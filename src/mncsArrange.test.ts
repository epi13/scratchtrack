import { describe, expect, it } from 'vitest';
import {
  MNCS_MAX_LOOP_TAKES,
  MNCS_MAX_SCRATCHES,
  mncsClampMotifBars,
  mncsClipActive,
  mncsClipEnd,
  mncsClipLengthTicks,
  mncsLoopEndTick,
  mncsLoopStartTick,
  mncsLoopTakeAllowed,
  mncsMotifTicks,
  mncsMoveStart,
  mncsNormalizeBpm,
  mncsResizeLength,
  mncsSanitizeClip,
  mncsScratchAllowed,
  mncsSnipHalves,
  mncsSnipValid,
  mncsStepIndex,
  mncsWrapTick,
} from './mncsArrange';

/**
 * Conformance: the TypeScript projection must agree function-for-function
 * with `mncs/arrange.mncs` (`scratchtrack.arrange.v1`). Every vector below
 * is also a case in `mncs/arrange-corpus.json`, executed through the MNCS
 * toolchain on the portable-WASM and research-bytecode backends (53/53
 * returned with expectations met on both; see docs/mncs-pressure.md). If
 * this test and the corpus disagree, the bug is here, never in MNCS source.
 */
describe('mncsArrange conformance with scratchtrack.arrange.v1', () => {
  it('owns the session policy caps', () => {
    expect(MNCS_MAX_LOOP_TAKES).toBe(12);
    expect(MNCS_MAX_SCRATCHES).toBe(36);
    expect(mncsLoopTakeAllowed(0)).toBe(true);
    expect(mncsLoopTakeAllowed(11)).toBe(true);
    expect(mncsLoopTakeAllowed(12)).toBe(false);
    expect(mncsScratchAllowed(35)).toBe(true);
    expect(mncsScratchAllowed(36)).toBe(false);
  });

  it('normalizes project tempo (corpus: bpm-*)', () => {
    expect(mncsNormalizeBpm(104)).toBe(104);
    expect(mncsNormalizeBpm(20)).toBe(20);
    expect(mncsNormalizeBpm(300)).toBe(300);
    expect(mncsNormalizeBpm(19)).toBe(104);
    expect(mncsNormalizeBpm(301)).toBe(104);
  });

  it('sanitizes clips non-destructively (corpus: sanitize-*)', () => {
    expect(mncsSanitizeClip(48, 96, 0, 24)).toEqual({ start: 48, length: 96, offset: 0 });
    expect(mncsSanitizeClip(-5, 96, 12, 24)).toEqual({ start: 0, length: 96, offset: 12 });
    expect(mncsSanitizeClip(48, 0, 12, 24)).toEqual({ start: 48, length: 24, offset: 12 });
    expect(mncsSanitizeClip(48, -3, 0, 24)).toEqual({ start: 48, length: 24, offset: 0 });
  });

  it('tests clip activation and length exactly like the transport (corpus: active-*, cliplen*)', () => {
    expect(mncsClipActive(5, 96)).toBe(true);
    expect(mncsClipActive(0, 96)).toBe(true);
    expect(mncsClipActive(96, 96)).toBe(false);
    expect(mncsClipActive(-1, 96)).toBe(false);
    expect(mncsClipLengthTicks(96)).toBe(96);
    expect(mncsClipLengthTicks(0)).toBe(1);
    expect(mncsClipLengthTicks(-5)).toBe(1);
    expect(mncsClipEnd({ start: 48, length: 96, offset: 12 })).toBe(144);
  });

  it('moves and resizes within clamped ranges (corpus: move-*, resize-*)', () => {
    expect(mncsMoveStart(100, 24, 1000)).toBe(124);
    expect(mncsMoveStart(100, -200, 1000)).toBe(0);
    expect(mncsMoveStart(990, 24, 1000)).toBe(1000);
    expect(mncsResizeLength(96, 24, 24, 1000)).toBe(120);
    expect(mncsResizeLength(96, -200, 24, 1000)).toBe(24);
    expect(mncsResizeLength(990, 48, 24, 1000)).toBe(1000);
  });

  it('snips non-destructively with source-offset preservation (corpus: snip-*)', () => {
    expect(mncsSnipValid(48, 96, 72)).toBe(true);
    expect(mncsSnipValid(48, 96, 48)).toBe(false);
    expect(mncsSnipValid(48, 96, 144)).toBe(false);
    const [left, right] = mncsSnipHalves(48, 96, 12, 72);
    expect(left).toEqual({ start: 48, length: 24, offset: 12 });
    expect(right).toEqual({ start: 72, length: 72, offset: 36 });
    // Halves tile the original without gaps or overlaps.
    expect(mncsClipEnd(left)).toBe(right.start);
    expect(left.length + right.length).toBe(96);
  });

  it('wraps positions exactly like the transport formula (corpus: wrap-*)', () => {
    // Cross-check against the JS expression the transport used to inline.
    const jsWrap = (tick: number, modulus: number) => ((tick % modulus) + modulus) % modulus;
    for (const [tick, modulus] of [[100, 96], [-1, 96], [96, 96], [0, 96], [-97, 96], [1000, 84]] as const) {
      expect(mncsWrapTick(tick, modulus)).toBe(jsWrap(tick, modulus));
    }
    expect(mncsWrapTick(5, 0)).toBe(5);
  });

  it('indexes grid steps and skips off-grid positions (corpus: stepidx-*)', () => {
    expect(mncsStepIndex(48, 6)).toBe(8);
    expect(mncsStepIndex(0, 6)).toBe(0);
    expect(mncsStepIndex(50, 6)).toBe(-1);
    expect(mncsStepIndex(48, 0)).toBe(-1);
  });

  it('clamps motif bars and sizes motif patterns (corpus: motifbars-*, motif-*)', () => {
    expect(mncsClampMotifBars(0)).toBe(1);
    expect(mncsClampMotifBars(3)).toBe(3);
    expect(mncsClampMotifBars(9)).toBe(8);
    expect(mncsMotifTicks(96, 2)).toBe(192);
    expect(mncsMotifTicks(84, 3)).toBe(252);
    expect(mncsMotifTicks(96, 0)).toBe(1);
  });

  it('normalizes loop bounds (corpus: loopstart-*, loopend-*)', () => {
    expect(mncsLoopStartTick(-5)).toBe(0);
    expect(mncsLoopStartTick(48)).toBe(48);
    expect(mncsLoopEndTick(48, 200)).toBe(200);
    expect(mncsLoopEndTick(48, 10)).toBe(48);
  });
});
