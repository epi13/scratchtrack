import type { Subdivision, TimeSignature } from './types';
import { STEP_TICKS, mncsStepsPerBar } from './mncsMeter';

/** Re-exported from the MNCS projection so grid code shares one table. */
export { STEP_TICKS } from './mncsMeter';

/** Timeline resolution: every musical position used by the transport lands on a whole tick. */
export const TICKS_PER_BEAT = 24;
export const TOTAL_BEATS = 64;

export const VALID_DENOMINATORS: Array<TimeSignature['denominator']> = [2, 4, 8, 16];

export const SUBDIVISIONS: Array<{ value: Subdivision; label: string }> = [
  { value: '1/4', label: '1/4' },
  { value: '1/8', label: '1/8' },
  { value: '1/8t', label: '1/8 triplet' },
  { value: '1/16', label: '1/16' },
  { value: '1/16t', label: '1/16 triplet' },
  { value: '1/32', label: '1/32' },
];

/** One step of each subdivision expressed in quarter-note beats. */
const STEP_BEATS: Record<Subdivision, number> = {
  '1/4': 1,
  '1/8': 0.5,
  '1/8t': 1 / 3,
  '1/16': 0.25,
  '1/16t': 1 / 6,
  '1/32': 0.125,
};

/** Ticks per step now live in the MNCS projection (`mncsMeter.ts`); see above. */

export function normalizeTimeSignature(value: Partial<TimeSignature> | undefined): TimeSignature {
  const numerator = Math.round(Number(value?.numerator));
  const denominator = Math.round(Number(value?.denominator)) as TimeSignature['denominator'];
  return {
    numerator: Number.isFinite(numerator) && numerator >= 1 && numerator <= 32 ? numerator : 4,
    denominator: (VALID_DENOMINATORS as number[]).includes(denominator) ? denominator : 4,
  };
}

/** Bar length in quarter-note beats: 4/4 → 4, 5/4 → 5, 7/8 → 3.5, 11/8 → 5.5, 13/16 → 3.25. */
export function barBeats(timeSignature: TimeSignature): number {
  const { numerator, denominator } = normalizeTimeSignature(timeSignature);
  return (numerator * 4) / denominator;
}

export function barTicks(timeSignature: TimeSignature): number {
  // Exact integer path owned by the MNCS model (`scratchtrack.meter.v1` /
  // `mncsMeter.ts`); the float fallback below is unreachable for normalized
  // meters and exists only to keep this total for hand-built inputs.
  const { numerator, denominator } = normalizeTimeSignature(timeSignature);
  const exact =
    denominator === 2 ? numerator * 48
    : denominator === 4 ? numerator * 24
    : denominator === 8 ? numerator * 12
    : numerator * 6;
  return Number.isInteger(exact) ? exact : Math.round(barBeats(timeSignature) * TICKS_PER_BEAT);
}

/** Steps in one bar for a subdivision, or null when the combination cannot align to ticks. */
export function stepsPerBar(timeSignature: TimeSignature, subdivision: Subdivision): number | null {
  // Exact divisibility replaces the old float-division-plus-epsilon check;
  // semantics are unchanged (proven by music.test.ts + mncsMeter.test.ts).
  const { numerator, denominator } = normalizeTimeSignature(timeSignature);
  return mncsStepsPerBar(numerator, denominator, subdivision);
}

export function stepBeats(subdivision: Subdivision): number {
  return STEP_BEATS[subdivision];
}

export function stepTicks(subdivision: Subdivision): number {
  return STEP_TICKS[subdivision];
}

export function normalizeSubdivision(value: unknown): Subdivision {
  return typeof value === 'string' && value in STEP_BEATS ? (value as Subdivision) : '1/16';
}

/**
 * Re-map hits from one step grid onto another, keeping their position in the bar.
 * Stronger hits win when two hits collapse onto the same new step.
 */
export function remapPattern(
  rows: number[][],
  fromSteps: number,
  toSteps: number,
): number[][] {
  const nextRows = rows.map(() => Array.from({ length: toSteps }, () => 0));
  rows.forEach((row, rowIndex) => {
    const target = nextRows[rowIndex] ?? [];
    row.forEach((cell, step) => {
      if (!cell) return;
      const beat = (step / Math.max(1, fromSteps)) * toSteps;
      const index = Math.min(toSteps - 1, Math.max(0, Math.floor(beat + 0.5)));
      target[index] = Math.max(target[index] ?? 0, cell) as never;
    });
  });
  return nextRows as never;
}

/* ------------------------------------------------------------------ */
/* Positions                                                           */
/* ------------------------------------------------------------------ */

export function formatPosition(beat: number, meter: TimeSignature): string {
  const barLength = barBeats(meter);
  const safe = Number.isFinite(beat) ? Math.max(0, beat) : 0;
  const bar = Math.floor(safe / barLength) + 1;
  let within = safe - (bar - 1) * barLength;
  // Guard against floating point pushing `within` up to exactly barLength.
  if (within >= barLength - 1e-6) within = 0;
  const wholeBeat = Math.floor(within) + 1;
  const fraction = within - Math.floor(wholeBeat - 1);
  const sixteenth = Math.round(fraction * 4);
  if (fraction > 0.001 && sixteenth > 0 && sixteenth < 4) return `${bar}.${wholeBeat}.${sixteenth}`;
  return `${bar}.${wholeBeat}`;
}

/** Parses "7", "7.3" or "7.3.2" (bar.beat.sixteenth-of-beat). Returns quarter-note beats. */
export function parsePosition(input: string, meter: TimeSignature): number | null {
  const text = input.trim();
  if (!text) return null;
  const parts = text.split(/[.\s]/).map((part) => Number(part));
  if (!parts.length || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const barLength = barBeats(meter);
  const [barRaw, beatRaw = 1, sixteenthRaw = 0] = parts;
  const bar = Math.max(1, Math.floor(barRaw));
  const wholeBeat = Math.max(1, Math.floor(beatRaw));
  if (wholeBeat > Math.ceil(barLength) + 1e-6) return null;
  const sixteenth = Math.min(3, Math.max(0, Math.floor(sixteenthRaw)));
  const beat = (bar - 1) * barLength + (wholeBeat - 1) + sixteenth * 0.25;
  if (!Number.isFinite(beat) || beat < 0 || beat > TOTAL_BEATS + barLength) return null;
  return Math.min(TOTAL_BEATS, beat);
}

export function clampBeat(value: number, max = TOTAL_BEATS): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, value));
}

export function quantizeBeat(value: number, step: number | null): number {
  if (!step) return Math.round(value * 100) / 100;
  return Math.round(value / step) * step;
}

/* ------------------------------------------------------------------ */
/* Scales and keyboard layouts                                         */
/* ------------------------------------------------------------------ */

export interface ScaleDefinition {
  name: string;
  intervals: number[];
}

export const SCALES: ScaleDefinition[] = [
  { name: 'Major (Ionian)', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'Natural Minor (Aeolian)', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  { name: 'Melodic Minor', intervals: [0, 2, 3, 5, 7, 9, 11] },
  { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  { name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  { name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { name: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10] },
  { name: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9] },
  { name: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10] },
  { name: 'Blues', intervals: [0, 3, 5, 6, 7, 10] },
  { name: 'Chromatic', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { name: 'Whole Tone', intervals: [0, 2, 4, 6, 8, 10] },
  { name: 'Diminished W–H', intervals: [0, 2, 3, 5, 6, 8, 9, 11] },
  { name: 'Diminished H–W', intervals: [0, 1, 3, 4, 6, 7, 9, 10] },
  { name: 'Phrygian Dominant', intervals: [0, 1, 4, 5, 7, 8, 10] },
  { name: 'Double Harmonic', intervals: [0, 1, 4, 5, 7, 8, 11] },
  { name: 'Hungarian Minor', intervals: [0, 2, 3, 6, 7, 8, 11] },
  { name: 'Persian', intervals: [0, 1, 4, 5, 6, 8, 11] },
  { name: 'Hirajoshi', intervals: [0, 2, 3, 7, 8] },
  { name: 'Insen', intervals: [0, 1, 5, 7, 10] },
  { name: 'Iwato', intervals: [0, 1, 5, 6, 10] },
  { name: 'Yo', intervals: [0, 2, 5, 7, 9] },
  { name: 'Egyptian', intervals: [0, 2, 3, 6, 7, 8] },
];

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export function noteName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function scaleIntervals(scaleName: string, custom?: string): number[] {
  if (scaleName === 'Custom') {
    const parsed = (custom ?? '')
      .split(/[^0-9]+/)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 11);
    const unique = [...new Set(parsed)].sort((a, b) => a - b);
    if (unique.length >= 2 && unique[0] === 0) return unique;
    return SCALES[0].intervals;
  }
  return SCALES.find((scale) => scale.name === scaleName)?.intervals ?? SCALES[0].intervals;
}

/**
 * MIDI note for keyboard pad `index`, honouring per-pad overrides.
 * Derived pads walk the chosen scale upward from root C at `keyOctave`.
 */
export function padMidi(options: {
  index: number;
  scaleRoot: number;
  scaleName: string;
  keyOctave: number;
  keyLayout?: Array<number | null>;
  customIntervals?: string;
}): number {
  const override = options.keyLayout?.[options.index];
  if (typeof override === 'number') return override;
  const intervals = scaleIntervals(options.scaleName, options.customIntervals);
  const rootMidi = 12 * (options.keyOctave + 1) + (options.scaleRoot % 12);
  const degree = options.index % intervals.length;
  const octaveShift = Math.floor(options.index / intervals.length);
  return Math.max(0, Math.min(127, rootMidi + intervals[degree] + 12 * octaveShift));
}
