export type TrackKind = 'drum' | 'synth' | 'bass' | 'audio';
export type DrumCell = 0 | 1 | 2;
export type Waveform = 'sine' | 'triangle' | 'square' | 'sawtooth';

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
  drumPattern?: DrumCell[][];
  drumKit?: string;
  drumSettings?: DrumSettings;
  synthPatch?: SynthPatch;
  synthNotes?: SynthNote[];
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
}

export interface ScratchtrackProject {
  format: 'scratchtrack-project';
  version: 3;
  id: string;
  title: string;
  bpm: number;
  beatsPerBar: number;
  createdAt: string;
  updatedAt: string;
  tracks: Track[];
  clips: Clip[];
  loop: LoopState;
  drive?: DriveState;
}
