/**
 * TypeScript projection of `mncs/arrange.mncs` (`scratchtrack.arrange.v1`).
 *
 * Machine-native arrangement model in whole transport ticks (24 per
 * quarter-note beat). Beats cross into this module only after the host
 * rounds them to ticks — the same rounding the transport already performs
 * before scheduling (`Math.round(beats * TICKS_PER_BEAT)`) — so the kernels
 * below are exact integer mirrors of the MNCS functions.
 *
 * Every kernel runs its compiled MNCS function WASM-first (via
 * `wasmFirst`) with the pure body below as the conformance-pinned
 * fallback. In test files the WASM modules are never loaded, so the
 * pure bodies run and stay corpus-pinned; in production the compiled
 * module answers. MNCS is the semantic authority: `mncs/arrange.mncs`
 * plus `mncs/arrange-corpus.json` define the contract,
 * `src/mncsArrange.test.ts` pins every corpus vector in this suite, and
 * `scripts/mncs-evidence.sh` replays the proof through the MNCS
 * toolchain. Any intentional divergence is a bug in this file, never in
 * MNCS source.
 *
 * What this module deliberately does NOT own yet: clip move/resize/snip
 * and loop-range editing in *beats* space (`App.tsx`, `project.ts`).
 * Arrangement snap grids (e.g. 1/32 beat = 0.75 ticks) are finer than the
 * transport tick grid, so beat-space edits are not whole-tick-exact and
 * cannot delegate without changing stored values. See
 * docs/mncs-pressure.md item P-007. The tick kernels for those operations
 * (`mncsSnipValid`, `mncsSnipHalves`, `mncsMoveStart`, ...) are specified,
 * proven, and tested here so the transport and any tick-space caller can
 * use them today.
 */

import {
  wasmArrangeClipActive,
  wasmArrangeClipEnd,
  wasmArrangeClipLengthTicks,
  wasmArrangeClampMotifBars,
  wasmArrangeLoopEndTick,
  wasmArrangeLoopStartTick,
  wasmArrangeLoopTakeAllowed,
  wasmArrangeMotifTicks,
  wasmArrangeMoveStart,
  wasmArrangeNormalizeBpm,
  wasmArrangeResizeLength,
  wasmArrangeSanitizeClip,
  wasmArrangeScratchAllowed,
  wasmArrangeSnipHalves,
  wasmArrangeSnipValid,
  wasmArrangeStepIndex,
  wasmArrangeWrapTick,
  wasmFirst,
  type WasmClipTicks,
} from './mncsWasm';

/** Whole-tick clip reference: mirrors MNCS record `Clip`. */
export interface ClipTicks {
  start: number;
  length: number;
  offset: number;
}

/* ------------------------------------------------------------------ */
/* Session policy (product caps owned by MNCS)                          */
/* ------------------------------------------------------------------ */

/** MNCS `max_loop_takes`. */
export const MNCS_MAX_LOOP_TAKES = 12;

/** MNCS `loop_take_allowed`. Precondition: integer count (callers pass take counts). */
export function mncsLoopTakeAllowed(saved: number): boolean {
  return wasmFirst('loop_take_allowed', wasmArrangeLoopTakeAllowed(saved), () => saved < MNCS_MAX_LOOP_TAKES);
}

/** MNCS `max_scratches`. */
export const MNCS_MAX_SCRATCHES = 36;

/** MNCS `scratch_allowed`. Precondition: integer count (callers pass array lengths). */
export function mncsScratchAllowed(count: number): boolean {
  return wasmFirst('scratch_allowed', wasmArrangeScratchAllowed(count), () => count < MNCS_MAX_SCRATCHES);
}

/* ------------------------------------------------------------------ */
/* Project header                                                       */
/* ------------------------------------------------------------------ */

/**
 * MNCS `normalize_bpm`. The integer rule is MNCS-owned and corpus-proven;
 * fractional tempi cannot cross the WASM boundary yet (no float type), so
 * non-integers take the same rule on the float path (see P-001).
 */
export function mncsNormalizeBpm(bpm: number): number {
  return wasmFirst('normalize_bpm', Number.isInteger(bpm) ? wasmArrangeNormalizeBpm(bpm) : null, () => {
    if (!Number.isFinite(bpm)) return 104;
    if (Number.isInteger(bpm)) return bpm >= 20 && bpm <= 300 ? bpm : 104;
    return bpm >= 20 && bpm <= 300 ? bpm : 104;
  });
}

/* ------------------------------------------------------------------ */
/* Clip kernels (ticks)                                                 */
/* ------------------------------------------------------------------ */

/** MNCS `sanitize_clip`. */
export function mncsSanitizeClip(start: number, length: number, offset: number, minLength: number): ClipTicks {
  const wasm = wasmArrangeSanitizeClip(start, length, offset, minLength);
  return wasmFirst<WasmClipTicks>('sanitize_clip', wasm, () => ({
    start: start < 0 ? 0 : start,
    length: length <= 0 ? minLength : length,
    offset,
  }));
}

/** MNCS `clip_end`. */
export function mncsClipEnd(clip: ClipTicks): number {
  return wasmFirst('clip_end', wasmArrangeClipEnd(clip), () => clip.start + clip.length);
}

/** MNCS `clip_active`: transport activation test for a tick local to the clip. */
export function mncsClipActive(localTick: number, lengthTicks: number): boolean {
  return wasmFirst('clip_active', wasmArrangeClipActive(localTick, lengthTicks), () => (
    Number.isInteger(localTick) && localTick >= 0 && localTick < lengthTicks
  ));
}

/** MNCS `clip_length_ticks`: transport clip length, at least one tick. */
export function mncsClipLengthTicks(lengthTicks: number): number {
  return wasmFirst('clip_length_ticks', wasmArrangeClipLengthTicks(lengthTicks), () => (
    lengthTicks < 1 ? 1 : lengthTicks
  ));
}

/** MNCS `move_start`: moved start clamped to [0, upper]. */
export function mncsMoveStart(start: number, delta: number, upper: number): number {
  return wasmFirst('move_start', wasmArrangeMoveStart(start, delta, upper), () => {
    const moved = start + delta;
    if (moved < 0) return 0;
    if (moved > upper) return upper;
    return moved;
  });
}

/** MNCS `resize_length`: resized length clamped to [minLength, maxLength]. */
export function mncsResizeLength(length: number, delta: number, minLength: number, maxLength: number): number {
  return wasmFirst('resize_length', wasmArrangeResizeLength(length, delta, minLength, maxLength), () => {
    const sized = length + delta;
    if (sized < minLength) return minLength;
    if (sized > maxLength) return maxLength;
    return sized;
  });
}

/** MNCS `snip_valid`: split strictly inside the clip. */
export function mncsSnipValid(start: number, length: number, split: number): boolean {
  return wasmFirst('snip_valid', wasmArrangeSnipValid(start, length, split), () => (
    split > start && split < start + length
  ));
}

/** MNCS `snip_left` / `snip_right`. Precondition: `mncsSnipValid(...)`. */
export function mncsSnipHalves(start: number, length: number, offset: number, split: number): [ClipTicks, ClipTicks] {
  return wasmFirst<[WasmClipTicks, WasmClipTicks]>(
    'snip_left',
    wasmArrangeSnipHalves(start, length, offset, split),
    () => {
      const left = split - start;
      return [
        { start, length: left, offset },
        { start: split, length: length - left, offset: offset + left },
      ];
    },
  );
}

/* ------------------------------------------------------------------ */
/* Position kernels (ticks)                                             */
/* ------------------------------------------------------------------ */

/**
 * MNCS `wrap_tick`: positive-modulo wrap into [0, modulus).
 * Degenerate modulus (<= 0) passes the tick through.
 */
export function mncsWrapTick(tick: number, modulus: number): number {
  return wasmFirst('wrap_tick', wasmArrangeWrapTick(tick, modulus), () => {
    if (!Number.isInteger(modulus) || modulus <= 0) return tick;
    return ((tick % modulus) + modulus) % modulus;
  });
}

/** MNCS `step_index`: grid-aligned step index, or -1 between steps. */
export function mncsStepIndex(position: number, stepTicks: number): number {
  // WASM answers null on a miss; the fallback then yields the -1 the
  // projection owns, so both paths agree exactly.
  return wasmFirst('step_index', wasmArrangeStepIndex(position, stepTicks), () => {
    if (!Number.isInteger(stepTicks) || stepTicks <= 0) return -1;
    if (position % stepTicks !== 0) return -1;
    return position / stepTicks;
  });
}

/* ------------------------------------------------------------------ */
/* Motif kernels                                                        */
/* ------------------------------------------------------------------ */

/** MNCS `clamp_motif_bars`: motif length clamp to 1..8 bars. */
export function mncsClampMotifBars(bars: number): number {
  return wasmFirst('clamp_motif_bars', wasmArrangeClampMotifBars(bars), () => {
    if (bars < 1) return 1;
    if (bars > 8) return 8;
    return bars;
  });
}

/** MNCS `motif_ticks`: bars * barTicks, at least one tick. */
export function mncsMotifTicks(barTicks: number, bars: number): number {
  return wasmFirst('motif_ticks', wasmArrangeMotifTicks(barTicks, bars), () => {
    const ticks = bars * barTicks;
    return ticks < 1 ? 1 : ticks;
  });
}

/* ------------------------------------------------------------------ */
/* Loop kernels (ticks)                                                 */
/* ------------------------------------------------------------------ */

/** MNCS `loop_start_tick`. */
export function mncsLoopStartTick(start: number): number {
  return wasmFirst('loop_start_tick', wasmArrangeLoopStartTick(start), () => (start < 0 ? 0 : start));
}

/** MNCS `loop_end_tick`: end never before the raw start. */
export function mncsLoopEndTick(start: number, end: number): number {
  return wasmFirst('loop_end_tick', wasmArrangeLoopEndTick(start, end), () => (end < start ? start : end));
}
