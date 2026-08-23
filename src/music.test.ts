import { describe, expect, it } from 'vitest';
import {
  TICKS_PER_BEAT,
  barBeats,
  barTicks,
  formatPosition,
  noteName,
  padMidi,
  parsePosition,
  quantizeBeat,
  scaleIntervals,
  stepsPerBar,
  stepTicks,
} from './music';

const ts = (numerator: number, denominator: 2 | 4 | 8 | 16) => ({ numerator, denominator });

describe('time signature mathematics', () => {
  it('expresses bar length in quarter-note beats', () => {
    expect(barBeats(ts(4, 4))).toBe(4);
    expect(barBeats(ts(5, 4))).toBe(5);
    expect(barBeats(ts(7, 8))).toBe(3.5);
    expect(barBeats(ts(11, 8))).toBe(5.5);
    expect(barBeats(ts(13, 16))).toBe(3.25);
    expect(barBeats(ts(3, 2))).toBe(6);
  });

  it('keeps bar length aligned to the transport tick grid', () => {
    for (const [n, d] of [[2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [3, 8], [5, 8], [6, 8], [7, 8], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [15, 8], [13, 16]] as const) {
      const ticks = barTicks(ts(n, d as 2 | 4 | 8 | 16));
      expect(Number.isInteger(ticks)).toBe(true);
      expect(ticks).toBeGreaterThan(0);
    }
    expect(barTicks(ts(7, 8))).toBe(Math.round(3.5 * TICKS_PER_BEAT));
  });

  it('computes drum steps per bar for binary subdivisions', () => {
    expect(stepsPerBar(ts(4, 4), '1/16')).toBe(16);
    expect(stepsPerBar(ts(7, 8), '1/16')).toBe(14);
    expect(stepsPerBar(ts(5, 4), '1/8')).toBe(10);
    expect(stepsPerBar(ts(5, 4), '1/32')).toBe(40);
    expect(stepsPerBar(ts(4, 4), '1/4')).toBe(4);
    expect(stepsPerBar(ts(13, 16), '1/16')).toBe(13);
  });

  it('computes triplet steps and rejects combinations that cannot align', () => {
    expect(stepsPerBar(ts(4, 4), '1/8t')).toBe(12);
    expect(stepsPerBar(ts(4, 4), '1/16t')).toBe(24);
    expect(stepsPerBar(ts(5, 4), '1/8t')).toBe(15);
    // 2.5 beats of 1/6-beat triplets = exactly 15 steps.
    expect(stepsPerBar(ts(5, 8), '1/16t')).toBe(15);
    // 7/8 with eighth-triplets would need 10.5 steps — not a valid grid.
    expect(stepsPerBar(ts(7, 8), '1/8t')).toBeNull();
    expect(stepsPerBar(ts(13, 16), '1/8t')).toBeNull();
  });

  it('maps every valid subdivision to whole transport ticks', () => {
    (['1/4', '1/8', '1/8t', '1/16', '1/16t', '1/32'] as const).forEach((subdivision) => {
      expect(stepTicks(subdivision) * (stepsPerBar(ts(4, 4), subdivision) ?? NaN) % TICKS_PER_BEAT === 0 || stepTicks(subdivision) <= TICKS_PER_BEAT).toBe(true);
      expect(Number.isInteger(stepTicks(subdivision))).toBe(true);
    });
    expect(stepTicks('1/8t')).toBe(8);
    expect(stepTicks('1/16t')).toBe(4);
    expect(stepTicks('1/32')).toBe(3);
  });
});

describe('position formatting and parsing', () => {
  it('formats bar.beat positions including odd meters', () => {
    expect(formatPosition(0, ts(4, 4))).toBe('1.1');
    expect(formatPosition(16, ts(4, 4))).toBe('5.1');
    expect(formatPosition(18, ts(4, 4))).toBe('5.3');
    // 7/8 bars are 3.5 beats: beat 3.5 lands on bar 2 "beat 1" boundary.
    expect(formatPosition(3.5, ts(7, 8))).toBe('2.1');
    expect(formatPosition(6.5, ts(7, 8))).toBe('2.4');
    expect(formatPosition(5.5, ts(11, 8))).toBe('2.1');
  });

  it('shows sixteenth-level detail only when needed', () => {
    expect(formatPosition(0.25, ts(4, 4))).toBe('1.1.1');
    expect(formatPosition(1.75, ts(4, 4))).toBe('1.2.3');
  });

  it('round-trips parsed positions', () => {
    expect(parsePosition('1.1', ts(4, 4))).toBe(0);
    expect(parsePosition('5.3', ts(4, 4))).toBe(18);
    expect(parsePosition('7.3', ts(4, 4))).toBe(26);
    expect(parsePosition('2.1', ts(7, 8))).toBe(3.5);
    expect(parsePosition('1.2.3', ts(4, 4))).toBeCloseTo(1.75, 10);
    expect(formatPosition(parsePosition('2.3.2', ts(7, 8))!, ts(7, 8))).toBe('2.3.2');
    expect(parsePosition('bogus', ts(4, 4))).toBeNull();
    expect(parsePosition('', ts(4, 4))).toBeNull();
  });

  it('handles out-of-range loop points gracefully', () => {
    expect(parsePosition('999.1', ts(4, 4))).toBeNull();
    // One bar past the timeline clamps to the very end rather than wrapping.
    expect(parsePosition('17.1', ts(4, 4))).toBe(64);
  });
});

describe('snap stepping', () => {
  it('quantizes to the chosen snap grid', () => {
    expect(quantizeBeat(3.31, 0.25)).toBeCloseTo(3.25, 10);
    expect(quantizeBeat(3.4, 0.5)).toBeCloseTo(3.5, 10);
    expect(quantizeBeat(3.456, null)).toBe(3.46);
  });
});

describe('scale layouts', () => {
  it('exposes the required scale library', () => {
    expect(scaleIntervals('Major (Ionian)')).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scaleIntervals('Mixolydian')).toEqual([0, 2, 4, 5, 7, 9, 10]);
    expect(scaleIntervals('Blues')).toEqual([0, 3, 5, 6, 7, 10]);
    expect(scaleIntervals('Hirajoshi')).toEqual([0, 2, 3, 7, 8]);
    expect(scaleIntervals('Missing Scale')).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('parses custom interval lists defensively', () => {
    expect(scaleIntervals('Custom', '0, 1, 4, 5, 7, 8, 10')).toEqual([0, 1, 4, 5, 7, 8, 10]);
    expect(scaleIntervals('Custom', 'junk')).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(scaleIntervals('Custom', '3,7')).toEqual([0, 2, 4, 5, 7, 9, 11]); // must start at 0 and have ≥2 notes
  });

  it('derives ascending pads from root + octave + scale', () => {
    const base = { scaleRoot: 0, scaleName: 'Major (Ionian)', keyOctave: 3 };
    expect(padMidi({ index: 0, ...base })).toBe(48); // C3
    expect(padMidi({ index: 7, ...base })).toBe(60); // C4
    expect(padMidi({ index: 14, ...base })).toBe(72); // C5
    const mix = { ...base, scaleName: 'Mixolydian' };
    expect(padMidi({ index: 3, ...mix })).toBe(53); // F
    const rooted = { ...base, scaleRoot: 2 }; // D
    expect(noteName(padMidi({ index: 0, ...rooted }))).toBe('D3');
  });

  it('lets any individual pad override its exact MIDI note', () => {
    const layout = [36, null, null];
    const base = { scaleRoot: 0, scaleName: 'Major (Ionian)', keyOctave: 3, keyLayout: layout };
    expect(padMidi({ index: 0, ...base })).toBe(36); // C1 override
    expect(padMidi({ index: 1, ...base })).toBe(50); // derived D3
    expect(padMidi({ index: 14, ...base })).toBe(72);
  });
});
