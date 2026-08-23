import { describe, expect, it } from 'vitest';
import {
  activeScratch,
  clonePattern,
  cloneScratch,
  createInitialProject,
  duplicateScratch,
  makeScratch,
  normalizeProject,
  starterPattern,
} from './project';
import type { DrumCell, ScratchtrackProject, Track } from './types';

const json = (value: unknown) => JSON.stringify(value);

function drumTrackOf(project: ScratchtrackProject): Track {
  const track = project.tracks.find((item) => item.kind === 'drum');
  if (!track) throw new Error('no drum track');
  return track;
}

function synthTrackOf(project: ScratchtrackProject): Track {
  const track = project.tracks.find((item) => item.kind === 'synth');
  if (!track) throw new Error('no synth track');
  return track;
}

describe('scratch isolation (regression)', () => {
  it('editing a duplicated drum scratch never mutates the original', () => {
    const project = createInitialProject();
    const track = drumTrackOf(project);
    const original = activeScratch(track)!;
    const originalSnapshot = json(original);

    // Duplicate → produces an independent copy that becomes active.
    const copy = duplicateScratch(original);
    expect(copy.id).not.toBe(original.id);
    expect(json(copy.drumPattern)).toBe(json(original.drumPattern));

    // Edit every nested structure of the copy through fresh containers.
    const edited: typeof copy = {
      ...copy,
      drumPattern: copy.drumPattern!.map((row, rowIndex) =>
        row.map((_cell, step) => ((rowIndex + step) % 3) as DrumCell)),
      drumSettings: { ...copy.drumSettings!, swing: 0.9, output: 0.2 },
      drumKit: 'Modern',
      name: 'Edited B',
    };

    // The original must remain byte-for-byte identical.
    expect(json(original)).toBe(originalSnapshot);
    expect(edited.drumKit).toBe('Modern');
    expect(original.drumKit).toBe('Pocket');
  });

  it('mutating the duplicate’s arrays directly cannot reach back into the original', () => {
    const project = createInitialProject();
    const track = drumTrackOf(project);
    const original = activeScratch(track)!;
    const snapshot = json(original);

    const copy = cloneScratch(original);
    copy.drumPattern![0][0] = 1;
    copy.drumPattern!.push([1, 2, 3] as DrumCell[]);
    copy.drumSettings!.swing = 1;
    copy.synthNotes = [{ id: 'x', midi: 60, startBeat: 0, lengthBeats: 1 }];

    expect(json(original)).toBe(snapshot);
    expect(original.drumPattern![0][0]).toBe(2); // starter kick untouched
    expect(original.drumPattern!.length).toBe(4);
    expect(original.synthNotes).toBeUndefined();
  });

  it('makeScratch starts clean but keeps kit/settings; carryContent deep-copies', () => {
    const project = createInitialProject();
    const track = drumTrackOf(project);
    const original = activeScratch(track)!;
    const snapshot = json(original);

    const fresh = makeScratch(track);
    expect(fresh.id).not.toBe(original.id);
    expect(fresh.drumKit).toBe(original.drumKit ?? 'Pocket');
    expect(fresh.drumSubdivision).toBe('1/16');
    expect(fresh.drumSettings).toEqual(original.drumSettings!);
    expect(fresh.drumSettings).not.toBe(original.drumSettings);
    expect(fresh.drumPattern).toBeUndefined(); // no pattern until the user writes one
    // A scratch without a pattern plays as silence — editing helpers must treat it as a blank grid.
    expect(fresh.note).toBe('');

    const carried = makeScratch(track, { carryContent: true });
    expect(json(carried.drumPattern)).toBe(json(original.drumPattern));
    expect(carried.drumPattern).not.toBe(original.drumPattern);
    carried.drumPattern![1][4] = 2;
    expect(json(original)).toBe(snapshot);
  });

  it('synth scratches are independent: motif, patch and layout', () => {
    const project = createInitialProject();
    const track = synthTrackOf(project);
    const original = activeScratch(track)!;
    const withNotes: typeof original = {
      ...original,
      id: 'synth-b',
      synthPatch: { ...original.synthPatch!, cutoff: 1200 },
      synthNotes: [
        { id: 'n1', midi: 60, startBeat: 0, lengthBeats: 1 },
        { id: 'n2', midi: 64, startBeat: 1.5, lengthBeats: 0.5 },
      ],
      keyLayout: [36, null, 67],
    };
    const snapshot = json(withNotes);

    const copy = makeScratch({ ...track, scratches: [...track.scratches, withNotes], activeScratchId: withNotes.id }, { carryContent: true });
    copy.synthNotes![0].midi = 72;
    copy.synthNotes![1].startBeat = 9;
    copy.synthPatch!.cutoff = 8000;
    copy.keyLayout![0] = 24;

    expect(json(withNotes)).toBe(snapshot);
    expect(withNotes.synthNotes![0].midi).toBe(60);
    expect(withNotes.keyLayout![0]).toBe(36);
  });

  it('clonePattern always allocates fresh rows', () => {
    const pattern = starterPattern(8);
    const copy = clonePattern(pattern);
    expect(copy).toEqual(pattern);
    expect(copy).not.toBe(pattern);
    copy[0]![0] = 1 as DrumCell;
    expect(pattern[0]![0]).toBe(2);
  });
});

describe('project migration', () => {
  it('migrates a v3 4/4 project exactly as users expect', () => {
    const v3 = {
      format: 'scratchtrack-project',
      version: 3,
      id: 'legacy-id',
      title: 'Old idea',
      bpm: 96,
      beatsPerBar: 4,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      tracks: [
        {
          id: 't-drum',
          name: 'Drums',
          kind: 'drum',
          muted: false,
          solo: false,
          activeScratchId: 's-a',
          settings: { inputGain: 0.5, tone: 0.5, compression: 0.6, volume: 0.9, pan: 0, reverb: 0, monitor: false },
          scratches: [
            {
              id: 's-a',
              name: 'Scratch A',
              note: '',
              createdAt: '2024-01-01T00:00:00.000Z',
              drumPattern: starterPattern(16),
              drumKit: 'Dust',
              drumSettings: { swing: 0.2, humanize: 0, output: 1, punch: 0.4, brightness: 0.7 },
            },
            { id: 's-b', name: 'Scratch B', note: '', createdAt: '2024-01-01T00:00:00.000Z', drumPattern: starterPattern(16), drumKit: 'Machine' },
          ],
        },
        {
          id: 't-synth',
          name: 'Synth',
          kind: 'synth',
          muted: true,
          solo: false,
          activeScratchId: 's-c',
          scratches: [{
            id: 's-c',
            name: 'Scratch A',
            note: '',
            createdAt: '2024-01-01T00:00:00.000Z',
            synthPatch: { oscA: 'square', oscB: 'sawtooth', oscMix: 0.5, detune: 12, cutoff: 3000, resonance: 2, attack: 0.01, sustain: 0.5, release: 0.2, drive: 0, lfoRate: 5, lfoDepth: 0.5 },
            synthNotes: [
              { id: 'n1', midi: 48, startBeat: 0, lengthBeats: 2 },
              { id: 'n2', midi: 55, startBeat: 2, lengthBeats: 1.5 },
            ],
          }],
        },
        {
          id: 't-audio',
          name: 'Audio 1',
          kind: 'audio',
          muted: false,
          solo: false,
          activeScratchId: 's-rec',
          scratches: [{ id: 's-rec', name: 'Loop 01', note: '', createdAt: '2024-01-01T00:00:00.000Z', audioBlobId: 'blob-123', audioMimeType: 'audio/wav', audioDuration: 2.31 }],
        },
      ],
      clips: [
        { id: 'c1', trackId: 't-drum', scratchId: 's-a', startBeat: 0, lengthBeats: 16, sourceOffsetBeats: 0 },
        { id: 'c2', trackId: 't-audio', scratchId: 's-rec', startBeat: 4, lengthBeats: 4, sourceOffsetBeats: 0 },
      ],
      loop: { enabled: true, startBeat: 0, endBeat: 16, autoScratch: true },
      drive: { rootFolderId: 'root-1', projectFolderId: 'proj-1' },
    };

    const migrated = normalizeProject(v3);
    expect(migrated.version).toBe(4);
    expect(migrated.id).toBe('legacy-id');
    expect(migrated.title).toBe('Old idea');
    expect(migrated.bpm).toBe(96);
    expect(migrated.timeSignature).toEqual({ numerator: 4, denominator: 4 });

    const drums = migrated.tracks[0]!;
    expect(drums.scratches[0]!.drumPattern).toEqual(starterPattern(16));
    expect(drums.scratches[0]!.drumSubdivision).toBe('1/16');
    expect(drums.scratches[0]!.drumSettings!.swing).toBeCloseTo(0.2, 10);
    expect(drums.scratches[1]!.drumSettings!.output).toBeCloseTo(0.88, 10); // default applied
    expect(drums.settings.compression).toBeCloseTo(0.6, 10);
    expect(drums.settings.multiStage).toBe(false);

    const synth = migrated.tracks[1]!;
    expect(synth.muted).toBe(true);
    expect(synth.scratches[0]!.synthNotes).toHaveLength(2);
    expect(synth.scratches[0]!.synthNotes![0].midi).toBe(48);
    expect(synth.scratches[0]!.motifBars).toBe(1); // content fits one 4-beat bar
    expect(synth.scratches[0]!.scaleName).toBe('Major (Ionian)');

    const audio = migrated.tracks[2]!;
    expect(audio.scratches[0]!.audioBlobId).toBe('blob-123');
    expect(audio.scratches[0]!.audioDuration).toBeCloseTo(2.31, 10);

    expect(migrated.clips).toHaveLength(2);
    expect(migrated.clips[0]!.scratchId).toBe('s-a');
    expect(migrated.loop).toMatchObject({ enabled: true, startBeat: 0, endBeat: 16, autoScratch: true });
    expect(migrated.drive?.projectFolderId).toBe('proj-1');

    // Migrating again is stable.
    expect(normalizeProject(JSON.parse(json(migrated)))).toEqual(migrated);
  });

  it('maps legacy beatsPerBar onto an explicit time signature and resizes drum rows', () => {
    const v3 = {
      format: 'scratchtrack-project',
      version: 3,
      title: 'Waltz sketch',
      bpm: 120,
      beatsPerBar: 3,
      tracks: [{
        id: 't1',
        name: 'Drums',
        kind: 'drum',
        muted: false,
        solo: false,
        scratches: [{
          id: 's1',
          name: 'Scratch A',
          note: '',
          createdAt: 'x',
          drumPattern: starterPattern(16),
        }],
      }],
      clips: [],
      loop: { enabled: false, startBeat: 0, endBeat: 12 },
    };
    const migrated = normalizeProject(v3);
    expect(migrated.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    const row = migrated.tracks[0]!.scratches[0]!.drumPattern![0]!;
    expect(row).toHaveLength(12); // 3 beats × 4 sixteenths
    // Kicks at beat 0 and beat 2 (steps 0 and 8 of 16) keep their musical time.
    expect(row[0]).toBe(2);
    expect(row[6]).toBe(2);
  });

  it('falls back to a fresh project for malformed documents instead of throwing', () => {
    expect(normalizeProject(null)).toBeTruthy();
    expect(normalizeProject('nonsense')).toBeTruthy();
    expect(normalizeProject({}).format).toBe('scratchtrack-project');
    expect(normalizeProject({ format: 'other' }).version).toBe(4);
    const broken = { format: 'scratchtrack-project', version: 3, tracks: 'oops' };
    expect(() => normalizeProject(broken)).not.toThrow();
    expect(normalizeProject(broken).tracks.length).toBeGreaterThan(0);
  });

  it('keeps v4 projects intact through normalize (Drive round-trip safety)', () => {
    const project = createInitialProject();
    const round = normalizeProject(JSON.parse(json(project)));
    expect(round).toEqual(project);
  });
});
