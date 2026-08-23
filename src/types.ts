export type TrackKind = 'drum' | 'synth' | 'bass' | 'audio';
export type DrumCell = 0 | 1 | 2;
export type Waveform = 'sine' | 'triangle' | 'square' | 'sawtooth';

/** Musical meter as written (e.g. 7/8). The timeline itself stays in quarter-note beats. */
export interface TimeSignature {
  numerator: number;
  denominator: 2 | 4 | 8 | 16;
}

/** Note value that one drum sequencer step represents. */
export type Subdivision = '1/4' | '1/8' | '1/8t' | '1/16' | '1/16t' | '1/32';

export interface DrumSettings {
  swing: number;
  humanize: number;
  output: number;
  punch: number;
  brightness: number;
}

export interface SynthPatch {
  oscA: Waveform;
  oscB: Waveform;
  oscMix: number;
  detune: number;
  cutoff: number;
  resonance: number;
  attack: number;
  sustain: number;
  release: number;
  drive: number;
  lfoRate: number;
  lfoDepth: number;
}

export interface ChannelSettings {
  inputGain: number;
  tone: number;
  compression: number;
  /** Serial two-stage (+ safety limiter) compression instead of a single compressor. */
  multiStage: boolean;
  volume: number;
  pan: number;
  reverb: number;
  monitor: boolean;
}

export interface SynthNote {
  id: string;
  midi: number;
  startBeat: number;
  lengthBeats: number;
}

export interface Scratch {
  id: string;
  name: string;
  note: string;
  createdAt: string;
  author?: string;
  /* Drums — pattern rows are exactly `stepsPerBar(timeSignature, subdivision)` long. */
  drumPattern?: DrumCell[][];
  drumKit?: string;
  drumSubdivision?: Subdivision;
  drumSettings?: DrumSettings;
  /* Synth */
  synthPatch?: SynthPatch;
  synthNotes?: SynthNote[];
  /** Scale/key/octave presets plus per-pad MIDI overrides, stored so Scratches stay predictable. */
  scaleRoot?: number;
  scaleName?: string;
  /** Interval list for the Custom scale, e.g. "0-2-3-5-7-8-10". */
  customIntervals?: string;
  keyOctave?: number;
  /** Explicit MIDI note per keyboard pad; null/undefined pads derive from the scale layout. */
  keyLayout?: Array<number | null>;
  motifBars?: number;
  noteLengthBeats?: number;
  /* Recorded audio */
  audioBlobId?: string;
  audioMimeType?: string;
  audioDuration?: number;
}

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  muted: boolean;
  solo: boolean;
  activeScratchId?: string;
  scratches: Scratch[];
  settings: ChannelSettings;
}

export interface Clip {
  id: string;
  trackId: string;
  scratchId: string;
  startBeat: number;
  lengthBeats: number;
  sourceOffsetBeats?: number;
}

export interface LoopState {
  enabled: boolean;
  startBeat: number;
  endBeat: number;
  /** Automatically make a new Scratch for each completed pass after the warm-up lap. */
  autoScratch: boolean;
}

export interface DriveState {
  rootFolderId?: string;
  projectFolderId?: string;
  lastSyncedAt?: string;
  packFileId?: string;
}

export interface ScratchtrackProject {
  format: 'scratchtrack-project';
  version: 4;
  id: string;
  title: string;
  bpm: number;
  timeSignature: TimeSignature;
  createdAt: string;
  updatedAt: string;
  tracks: Track[];
  clips: Clip[];
  loop: LoopState;
  drive?: DriveState;
}
