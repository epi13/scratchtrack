/**
 * TypeScript projection of `mncs/meter.mncs` (`scratchtrack.meter.v1`).
 *
 * This module is the machine-native integer formulation of ScratchTrack's
 * rhythmic model: the timeline is a whole-tick grid (24 ticks per
 * quarter-note beat) and every supported subdivision lands exactly on
 * ticks. It replaces float division plus epsilon comparison with exact
 * integer arithmetic:
 *
 *   barTicks = numerator * 96 / denominator   (96 = 24 ticks x 4 quarters)
 *   steps    = barTicks / stepTicks           (valid iff divisible)
 *
 * 96 is divisible by every valid denominator (2/4/8/16), so bar ticks are
 * always exact. Combinations that cannot align (e.g. 7/8 at 1/8-triplets)
 * return null rather than silently rounding.
 *
 * MNCS is the semantic authority: `mncs/meter.mncs` plus
 * `mncs/meter-corpus.json` define the contract, `src/mncsMeter.test.ts`
 * pins every corpus vector in this suite, and `scripts/mncs-evidence.sh`
 * replays the proof through the MNCS toolchain (source-study + portable-WASM
 * and research-bytecode execution, plus live calls into the compiled WASM).
 * This file must agree with the MNCS module function-for-function; any
 * intentional divergence is a bug in this file, never in the MNCS source.
 */

import type { Subdivision } from './types';

/** One step of each subdivision expressed in transport ticks. */
export const STEP_TICKS: Record<Subdivision, number> = {
  '1/4': 24,
  '1/8': 12,
  '1/8t': 8,
  '1/16': 6,
  '1/16t': 4,
  '1/32': 3,
};

/** Subdivision label order = MNCS subdivision code (0..5). */
export const SUBDIVISION_CODES: Subdivision[] = ['1/4', '1/8', '1/8t', '1/16', '1/16t', '1/32'];

export function subdivisionToCode(subdivision: Subdivision): number {
  return SUBDIVISION_CODES.indexOf(subdivision);
}

export function codeToSubdivision(code: number): Subdivision | null {
  return Number.isInteger(code) && code >= 0 && code < SUBDIVISION_CODES.length
    ? (SUBDIVISION_CODES[code] as Subdivision)
    : null;
}

/** MNCS `ticks_per_beat`. */
export const MNCS_TICKS_PER_BEAT = 24;

/** MNCS `bar_ticks`: bar length in ticks, or null when out of range. */
export function mncsBarTicks(numerator: number, denominator: number): number | null {
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32) return null;
  if (denominator === 2) return numerator * 48;
  if (denominator === 4) return numerator * 24;
  if (denominator === 8) return numerator * 12;
  if (denominator === 16) return numerator * 6;
  return null;
}

/** MNCS `step_ticks`: ticks per step for a subdivision code, or null. */
export function mncsStepTicks(code: number): number | null {
  const subdivision = codeToSubdivision(code);
  return subdivision === null ? null : STEP_TICKS[subdivision];
}

/**
 * MNCS `steps_per_bar`: drum steps per bar, or null when the
 * meter/subdivision combination cannot align to whole ticks or falls
 * outside the 2..128 product range.
 */
export function mncsStepsPerBar(
  numerator: number,
  denominator: number,
  subdivision: Subdivision,
): number | null {
  const bar = mncsBarTicks(numerator, denominator);
  if (bar === null) return null;
  const step = STEP_TICKS[subdivision];
  if (step === undefined || bar % step !== 0) return null;
  const steps = bar / step;
  if (steps < 2 || steps > 128) return null;
  return steps;
}

/** MNCS `quantize_tick`: round a tick to the grid (half steps up); step <= 0 passes through. */
export function mncsQuantizeTick(tick: number, step: number): number {
  if (!Number.isFinite(tick) || !Number.isFinite(step) || step <= 0) return tick;
  const half = Math.floor(step / 2);
  if (tick >= 0) return Math.floor((tick + half) / step) * step;
  return Math.ceil((tick - half) / step) * step;
}

/** MNCS `clamp_midi`. */
export function mncsClampMidi(note: number): number {
  if (!Number.isFinite(note)) return 0;
  return Math.max(0, Math.min(127, Math.trunc(note)));
}

/** MNCS `pad_midi`: root + interval + 12 x octaveShift, clamped to 0..127. */
export function mncsPadMidi(rootMidi: number, interval: number, octaveShift: number): number {
  return mncsClampMidi(rootMidi + interval + octaveShift * 12);
}

/** MNCS `pitch_class`. Precondition: 0 <= note <= 127. */
export function mncsPitchClass(note: number): number {
  return note - Math.floor(note / 12) * 12;
}

/** MNCS `octave_of`. Precondition: 0 <= note <= 127. */
export function mncsOctaveOf(note: number): number {
  return Math.floor(note / 12) - 1;
}
