import type {
  ChannelSettings,
  Clip,
  DrumCell,
  DrumSettings,
  LoopState,
  Scratch,
  ScratchtrackProject,
  Subdivision,
  SynthPatch,
  SynthNote,
  TimeSignature,
  Track,
} from './types';
import { barBeats, normalizeSubdivision, normalizeTimeSignature, stepsPerBar } from './music';
import { mncsClampMotifBars, mncsNormalizeBpm } from './mncsArrange';
import {
  mncsAutoScratchUpgrade,
  mncsLegacyNumerator,
  mncsNormalizeOctave,
  mncsNormalizeRoot,
  mncsRemapCell,
  mncsRemapIndex,
} from './mncsMigrate';

export const uid = () => crypto.randomUUID();

export const defaultDrumSettings: DrumSettings = {
  swing: 0,
  humanize: 0,
  output: 0.88,
  punch: 0.55,
  brightness: 0.58,
};

export const defaultPatch: SynthPatch = {
  oscA: 'sawtooth',
  oscB: 'square',
  oscMix: 0.35,
  detune: 7,
  cutoff: 2200,
  resonance: 1.1,
  attack: 0.015,
  sustain: 0.72,
  release: 0.28,
  drive: 0.08,
  lfoRate: 2.2,
  lfoDepth: 0,
};

export const defaultChannelSettings: ChannelSettings = {
  inputGain: 0.72,
  tone: 0.54,
  compression: 0.38,
  multiStage: false,
  volume: 0.82,
  pan: 0,
  reverb: 0.08,
  monitor: false,
};

export const defaultLoopState: LoopState = {
  enabled: false,
  startBeat: 0,
  endBeat: 16,
  autoScratch: true,
};

export const DRUM_KITS = ['Pocket', 'Dust', 'Machine', 'Club', 'Modern'] as const;

/* ------------------------------------------------------------------ */
/* Pattern helpers — every returned structure is freshly allocated.    */
/* ------------------------------------------------------------------ */

export function blankPattern(steps: number): DrumCell[][] {
  return Array.from({ length: 4 }, () => Array.from({ length: steps }, () => 0 as DrumCell));
}

export function starterPattern(steps = 16): DrumCell[][] {
  const pattern = blankPattern(steps);
  const at = (fractionOfBar: number) => Math.min(steps - 1, Math.round(fractionOfBar * steps));
  [0, 0.5].forEach((beat) => { pattern[0][at(beat)] = 2; });
  [0.25, 0.75].forEach((beat) => { pattern[1][at(beat)] = 2; });
  for (let step = 0; step < steps; step += Math.max(1, Math.round(steps / 8))) {
    pattern[2][step] = step % Math.max(1, Math.round(steps / 4)) === 0 ? 2 : 1;
  }
  if (steps > 3) pattern[3][steps - 1] = 1;
  return pattern;
}

/** Deep, independent copy of a drum pattern (fresh row arrays, fresh outer array). */
export function clonePattern(pattern: DrumCell[][]): DrumCell[][] {
  return pattern.map((row) => Array.from(row) as DrumCell[]);
}

/**
 * The single authoritative deep-copy used everywhere a Scratch is duplicated.
 * Nested musical data (pattern rows, note lists, patch/settings objects, key
 * layout) always receives fresh containers so no two Scratches can share state.
 */
export function cloneScratch(scratch: Scratch): Scratch {
  const next: Scratch = {
    ...scratch,
    id: uid(),
    createdAt: new Date().toISOString(),
  };
  if (scratch.drumPattern) next.drumPattern = clonePattern(scratch.drumPattern);
  if (scratch.drumSettings) next.drumSettings = { ...scratch.drumSettings };
  if (scratch.synthPatch) next.synthPatch = { ...scratch.synthPatch };
  if (scratch.synthNotes) {
    next.synthNotes = scratch.synthNotes.map((note) => ({ ...note }));
  }
  if (scratch.keyLayout) next.keyLayout = [...scratch.keyLayout];
  return next;
}

export function activeScratch(track: Track): Scratch | undefined {
  return track.scratches.find((scratch) => scratch.id === track.activeScratchId) ?? track.scratches[0];
}

function scratchName(index: number): string {
  if (index < 26) return `Scratch ${String.fromCharCode(65 + index)}`;
  return `Scratch ${index + 1}`;
}

/* ------------------------------------------------------------------ */
/* Scratch creation semantics                                          */
/* ------------------------------------------------------------------ */

export interface NewScratchOptions {
  /** When true the new Scratch starts as an exact deep copy (deliberate duplication). */
  carryContent?: boolean;
}

/**
 * Create a brand-new Scratch for a track.
 *
 * Drums keep kit + settings + subdivision (sound configuration) but start with a
 * clean pattern unless `carryContent`. Synths keep patch + scale/key/octave/layout
 * metadata but start with an empty motif unless `carryContent`. Bass/Audio get a
 * clean recording slot. Every nested value is freshly allocated.
 */
export function makeScratch(track: Track, options: NewScratchOptions = {}): Scratch {
  const source = activeScratch(track);
  const carry = Boolean(options.carryContent);
  const now = new Date().toISOString();
  const base: Scratch = {
    id: uid(),
    name: scratchName(track.scratches.length),
    note: '',
    createdAt: now,
  };
  if (track.kind === 'drum') {
    base.drumKit = source?.drumKit ?? 'Pocket';
    base.drumSubdivision = source?.drumSubdivision ?? '1/16';
    base.drumSettings = { ...(source?.drumSettings ?? defaultDrumSettings) };
    if (carry && source?.drumPattern) base.drumPattern = clonePattern(source.drumPattern);
  }
  if (track.kind === 'synth') {
    base.synthPatch = { ...(source?.synthPatch ?? defaultPatch) };
    base.scaleRoot = source?.scaleRoot ?? 0;
    base.scaleName = source?.scaleName ?? 'Major (Ionian)';
    base.keyOctave = source?.keyOctave ?? 3;
    base.motifBars = source?.motifBars ?? 1;
    base.noteLengthBeats = source?.noteLengthBeats ?? 0.5;
    if (source?.keyLayout) base.keyLayout = [...source.keyLayout];
    if (carry && source?.synthNotes) {
      base.synthNotes = source.synthNotes.map((note) => ({ ...note }));
    } else {
      base.synthNotes = [];
    }
  }
  return base;
}

export function duplicateScratch(scratch: Scratch): Scratch {
  const next = cloneScratch(scratch);
  next.name = `${scratch.name} copy`;
  return next;
}

/* ------------------------------------------------------------------ */
/* Project construction                                                */
/* ------------------------------------------------------------------ */

function makeTrack(name: string, kind: Track['kind']): Track {
  return {
    id: uid(),
    name,
    kind,
    muted: false,
    solo: false,
    scratches: [],
    settings: { ...defaultChannelSettings },
  };
}

export function createInitialProject(): ScratchtrackProject {
  const now = new Date().toISOString();
  const drumTrackId = uid();
  const drumScratchId = uid();
  const synthTrackId = uid();
  const synthScratchId = uid();
  const timeSignature = normalizeTimeSignature({ numerator: 4, denominator: 4 });
  const steps = stepsPerBar(timeSignature, '1/16') ?? 16;
  const tracks: Track[] = [
    {
      id: drumTrackId,
      name: 'Drums',
      kind: 'drum',
      muted: false,
      solo: false,
      settings: { ...defaultChannelSettings },
      activeScratchId: drumScratchId,
      scratches: [{
        id: drumScratchId,
        name: 'Scratch A',
        note: 'Starter groove',
        createdAt: now,
        drumPattern: starterPattern(steps),
        drumKit: 'Pocket',
        drumSubdivision: '1/16',
        drumSettings: { ...defaultDrumSettings },
      }],
    },
    {
      id: synthTrackId,
      name: 'Synth',
      kind: 'synth',
      muted: false,
      solo: false,
      settings: { ...defaultChannelSettings },
      activeScratchId: synthScratchId,
      scratches: [{
        id: synthScratchId,
        name: 'Scratch A',
        note: 'Tap the keys or write a motif',
        createdAt: now,
        synthPatch: { ...defaultPatch },
        synthNotes: [],
        scaleRoot: 0,
        scaleName: 'Major (Ionian)',
        keyOctave: 3,
        motifBars: 1,
        noteLengthBeats: 0.5,
      }],
    },
    makeTrack('Bass', 'bass'),
    ...Array.from({ length: 5 }, (_, index) => makeTrack(`Audio ${index + 1}`, 'audio')),
  ];

  return {
    format: 'scratchtrack-project',
    version: 4,
    id: uid(),
    title: 'Untitled idea',
    bpm: 104,
    timeSignature,
    createdAt: now,
    updatedAt: now,
    tracks,
    clips: [{ id: uid(), trackId: drumTrackId, scratchId: drumScratchId, startBeat: 0, lengthBeats: barBeats(timeSignature), sourceOffsetBeats: 0 }],
    loop: { ...defaultLoopState },
  };
}

/* ------------------------------------------------------------------ */
/* Migration                                                           */
/* ------------------------------------------------------------------ */

function migrateChannelSettings(raw: unknown): ChannelSettings {
  const source = (raw ?? {}) as Partial<ChannelSettings>;
  return {
    inputGain: typeof source.inputGain === 'number' ? source.inputGain : defaultChannelSettings.inputGain,
    tone: typeof source.tone === 'number' ? source.tone : defaultChannelSettings.tone,
    compression: typeof source.compression === 'number' ? source.compression : defaultChannelSettings.compression,
    multiStage: Boolean(source.multiStage),
    volume: typeof source.volume === 'number' ? source.volume : defaultChannelSettings.volume,
    pan: typeof source.pan === 'number' ? source.pan : defaultChannelSettings.pan,
    reverb: typeof source.reverb === 'number' ? source.reverb : defaultChannelSettings.reverb,
    monitor: Boolean(source.monitor),
  };
}

function resizeRows(rows: number[] | undefined, steps: number): number[] {
  if (!rows || !rows.length) return Array.from({ length: steps }, () => 0);
  if (rows.length === steps) return [...rows];
  if (rows.length > steps) return rows.slice(0, steps).map((cell) => cell ?? 0);
  return [...rows.map((cell) => cell ?? 0), ...Array.from({ length: steps - rows.length }, () => 0)];
}

function migrateDrumScratch(scratch: Scratch, meter: TimeSignature): Scratch {
  if (!('drumPattern' in scratch) && !scratch.drumPattern && !scratch.drumKit) return scratch;
  const subdivision = normalizeSubdivision(scratch.drumSubdivision);
  const steps = stepsPerBar(meter, subdivision) ?? 16;
  // v≤3 patterns were 4 × 16 at 4/4; remap keeps timing when the meter differs.
  const fromSteps = scratch.drumPattern?.[0]?.length ?? 16;
  let pattern: DrumCell[][];
  if (scratch.drumPattern && fromSteps !== steps) {
    pattern = remapRows(scratch.drumPattern, fromSteps, steps);
  } else if (scratch.drumPattern) {
    pattern = scratch.drumPattern.map((row) => resizeRows(Array.from(row ?? []), steps)) as DrumCell[][];
  } else {
    pattern = blankPattern(steps);
  }
  return {
    ...scratch,
    drumPattern: pattern,
    drumSubdivision: subdivision,
    drumSettings: { ...defaultDrumSettings, ...(scratch.drumSettings ?? {}) },
  };
}

function remapRows(rows: DrumCell[][], fromSteps: number, toSteps: number): DrumCell[][] {
  // Same MNCS-owned rule as music.ts remapPattern (`remap_index` /
  // `remap_cell`); the two copies now share one proven definition.
  return rows.map((row) => {
    const target = Array.from({ length: toSteps }, () => 0 as DrumCell);
    (row ?? []).forEach((cell, step) => {
      if (!cell) return;
      const index = mncsRemapIndex(step, fromSteps, toSteps);
      target[index] = mncsRemapCell(target[index], cell) as DrumCell;
    });
    return target;
  });
}

function migrateSynthScratch(scratch: Scratch, meterBeats: number): Scratch {
  if (!scratch.synthPatch && !scratch.synthNotes) return scratch;
  const contentEnd = Math.max(0, ...(scratch.synthNotes ?? []).map((note) => note.startBeat + note.lengthBeats));
  const barsFromContent = meterBeats > 0 ? Math.ceil(contentEnd / meterBeats) : 1;
  const requestedBars = scratch.motifBars ?? barsFromContent;
  // Bar-count clamp owned by the MNCS arrangement model (`clamp_motif_bars`).
  const motifBars = mncsClampMotifBars(Math.floor(requestedBars > 0 ? requestedBars : 1));
  const next: Scratch = {
    ...scratch,
    synthNotes: (scratch.synthNotes ?? []).map((note) => ({ ...note })),
    // Key normalization owned by the MNCS migration model; rounding stays
    // host-side at the float edge.
    scaleRoot: mncsNormalizeRoot(Math.round(scratch.scaleRoot ?? 0)),
    scaleName: typeof scratch.scaleName === 'string' ? scratch.scaleName : 'Major (Ionian)',
    keyOctave: mncsNormalizeOctave(Math.round(scratch.keyOctave ?? 3)),
    motifBars,
    noteLengthBeats: typeof scratch.noteLengthBeats === 'number' ? scratch.noteLengthBeats : 0.5,
  };
  if (Array.isArray(scratch.keyLayout)) next.keyLayout = [...scratch.keyLayout];
  return next;
}

/**
 * Normalize any supported project document into the current in-memory format.
 * v1/v2/v3 documents are migrated (v3's fixed 4/4 + 16-step assumptions become
 * explicit time-signature + subdivision data); malformed documents fall back to
 * a fresh project rather than throwing.
 */
export function normalizeProject(input: unknown): ScratchtrackProject {
  if (!input || typeof input !== 'object') return createInitialProject();
  const raw = input as Record<string, unknown>;
  if (raw.format !== 'scratchtrack-project') return createInitialProject();

  try {
    const rawVersion = typeof raw.version === 'number' ? raw.version : 1;
    const source = raw as unknown as {
      id?: string;
      title?: string;
      bpm?: number;
      beatsPerBar?: number;
      timeSignature?: Partial<TimeSignature>;
      createdAt?: string;
      updatedAt?: string;
      tracks?: Track[];
      clips?: ScratchtrackProject['clips'];
      loop?: Partial<LoopState> & { captureEachPass?: boolean };
      drive?: ScratchtrackProject['drive'];
    };

    // Older projects only had beatsPerBar (quarter-note beats per bar).
    // Float edge (round) stays host-side; integer validation is MNCS-owned
    // (`legacy_numerator`).
    const legacyBeatsPerBar = Number(source.beatsPerBar);
    const legacyNumerator = Number.isFinite(legacyBeatsPerBar) && legacyBeatsPerBar >= 1 && legacyBeatsPerBar <= 32
      ? mncsLegacyNumerator(Math.round(legacyBeatsPerBar))
      : -1;
    const meter = source.timeSignature
      ? normalizeTimeSignature(source.timeSignature)
      : legacyNumerator >= 0
        ? normalizeTimeSignature({ numerator: legacyNumerator, denominator: 4 })
        : normalizeTimeSignature(undefined);
    const meterBeats = barBeats(meter);

    const rawTracks = Array.isArray(source.tracks) ? source.tracks : [];
    const tracks = rawTracks.map((track) => {
      const base: Track = {
        ...track,
        muted: Boolean(track.muted),
        solo: Boolean(track.solo),
        settings: migrateChannelSettings(track.settings),
        scratches: [],
      };
      base.scratches = (track.scratches ?? []).map((scratch) => ({
        ...scratch,
        ...(track.kind === 'drum' ? migrateDrumScratch(scratch, meter) : {}),
        ...(track.kind === 'synth' ? migrateSynthScratch(scratch, meterBeats) : {}),
      }));
      return base;
    });
    if (!tracks.length) return createInitialProject();

    const sourceLoop = source.loop ?? {};
    const fallbackEnd = Math.min(64, Math.max(meterBeats * 4, meterBeats));
    const loop: LoopState = {
      enabled: Boolean(sourceLoop.enabled),
      startBeat: typeof sourceLoop.startBeat === 'number' ? Math.max(0, sourceLoop.startBeat) : defaultLoopState.startBeat,
      endBeat: typeof sourceLoop.endBeat === 'number'
        ? Math.max(sourceLoop.startBeat ?? 0, sourceLoop.endBeat)
        : Math.min(defaultLoopState.endBeat, fallbackEnd),
      // v3 intentionally ships Auto Scratch ON; older prototype projects upgrade to it too.
      // Upgrade rule owned by the MNCS migration model (`auto_scratch_upgrade`).
      autoScratch: mncsAutoScratchUpgrade(rawVersion >= 3, sourceLoop.autoScratch !== false),
    };

    const clips = (Array.isArray(source.clips) ? source.clips : []).map((clip) => ({
      ...clip,
      sourceOffsetBeats: typeof clip.sourceOffsetBeats === 'number' ? clip.sourceOffsetBeats : 0,
    }));

    const normalized: ScratchtrackProject = {
      format: 'scratchtrack-project',
      version: 4,
      id: typeof source.id === 'string' && source.id ? source.id : uid(),
      title: typeof source.title === 'string' ? source.title : 'Untitled idea',
      // Tempo policy owned by the MNCS arrangement model (`normalize_bpm`).
      bpm: mncsNormalizeBpm(source.bpm as number),
      timeSignature: meter,
      createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date().toISOString(),
      tracks,
      clips,
      loop,
    };
    if (source.drive) normalized.drive = source.drive;
    return normalized;
  } catch {
    return createInitialProject();
  }
}

export function makeBlankPatternFor(meter: TimeSignature, subdivision: Subdivision): DrumCell[][] {
  return blankPattern(stepsPerBar(meter, subdivision) ?? 16);
}

export function emptySynthNote(id: string, midi: number, startBeat: number, lengthBeats: number): SynthNote {
  return { id, midi, startBeat, lengthBeats };
}

export function sanitizeClip(clip: Clip): Clip {
  return {
    ...clip,
    startBeat: Number.isFinite(clip.startBeat) ? Math.max(0, clip.startBeat) : 0,
    lengthBeats: Number.isFinite(clip.lengthBeats) && clip.lengthBeats > 0 ? clip.lengthBeats : 1,
  };
}
