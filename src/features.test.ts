// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { compressionRouteStages, drumKitNames } from './audio';
import { parseDriveFolderLink } from './drive';

describe('compression routes', () => {
  it('keeps the single-stage route when multiStage is off', () => {
    const plan = compressionRouteStages({ compression: 0.5, multiStage: false } as never);
    expect(plan.stages).toHaveLength(1);
    expect(plan.stages[0]!.threshold).toBeCloseTo(-24, 10);
    expect(plan.makeupGain).toBe(1);
  });

  it('builds a serial peak → glue → safety chain when multiStage is on', () => {
    const plan = compressionRouteStages({ compression: 0.4, multiStage: true } as never);
    expect(plan.stages).toHaveLength(3);
    const [peak, glue, safety] = plan.stages;
    // Peak stage is faster than glue; limiter is fastest of all.
    expect(peak!.attack).toBeLessThan(glue!.attack);
    expect(safety!.attack).toBeLessThan(peak!.attack);
    // Safety limiter barely compresses until close to full scale.
    expect(safety!.ratio).toBeGreaterThan(8);
    expect(safety!.threshold).toBeGreaterThan(-3.2);
    expect(plan.makeupGain).toBeGreaterThan(1);
  });

  it('scales every threshold with the single user-facing amount control', () => {
    const low = compressionRouteStages({ compression: 0.1, multiStage: true } as never);
    const high = compressionRouteStages({ compression: 0.9, multiStage: true } as never);
    expect(high.stages[0]!.threshold).toBeLessThan(low.stages[0]!.threshold);
    expect(high.stages[1]!.ratio).toBeGreaterThan(low.stages[1]!.ratio);
  });
});

describe('drum kits', () => {
  it('offers the five kits including Club and Modern everywhere', () => {
    expect(drumKitNames()).toEqual(['Pocket', 'Dust', 'Machine', 'Club', 'Modern']);
  });
});

describe('Google Drive link parsing', () => {
  it('parses standard shared folder links', () => {
    expect(parseDriveFolderLink('https://drive.google.com/drive/folders/1AbC_deFG-123456789?usp=sharing')).toBe('1AbC_deFG-123456789');
    expect(parseDriveFolderLink('https://drive.google.com/drive/u/0/folders/1AbC_deFG-123456789')).toBe('1AbC_deFG-123456789');
    expect(parseDriveFolderLink('https://drive.google.com/drive/mobile/folders/1AbC_deFG-123456789?resourcekey=abc')).toBe('1AbC_deFG-123456789');
  });

  it('accepts Scratchtrack share links and bare folder IDs', () => {
    expect(parseDriveFolderLink('https://epi13.github.io/scratchtrack/?project=projFolderId12345')).toBe('projFolderId12345');
    expect(parseDriveFolderLink('1AbC_deFG-123456789')).toBe('1AbC_deFG-123456789');
    expect(parseDriveFolderLink('  1AbC_deFG-123456789  ')).toBe('1AbC_deFG-123456789');
  });

  it('rejects unrelated text and empty input', () => {
    expect(parseDriveFolderLink('')).toBeNull();
    expect(parseDriveFolderLink('   ')).toBeNull();
    expect(parseDriveFolderLink('check out this song')).toBeNull();
    expect(parseDriveFolderLink('https://example.com/folders/short')).toBeNull();
  });
});
