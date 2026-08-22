export type TrackKind = 'drum' | 'synth' | 'bass' | 'audio';
export type DrumCell = 0 | 1 | 2;
export type Waveform = 'sine' | 'triangle' | 'square' | 'sawtooth';

export interface SynthPatch {
  oscA: Waveform;
  oscB: Waveform;
  oscMix: number;
  cutoff: number;
  attack: number;
  release: number;
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
}

export interface Clip {
  id: string;
  trackId: string;
  scratchId: string;
  startBeat: number;
  lengthBeats: number;
}

export interface DriveState {
  rootFolderId?: string;
  projectFolderId?: string;
  lastSyncedAt?: string;
}

export interface ScratchtrackProject {
  format: 'scratchtrack-project';
  version: 1;
  id: string;
  title: string;
  bpm: number;
  beatsPerBar: number;
  createdAt: string;
  updatedAt: string;
  tracks: Track[];
  clips: Clip[];
  drive?: DriveState;
}
