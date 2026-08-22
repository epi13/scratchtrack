import type { ChannelSettings, DrumCell, DrumSettings, LoopState, ScratchtrackProject, SynthPatch, Track } from './types';

const PROJECT_KEY = 'scratchtrack.project.v1';
const DB_NAME = 'scratchtrack-audio';
const STORE_NAME = 'blobs';

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

function blankPattern(): DrumCell[][] {
  return Array.from({ length: 4 }, () => Array.from({ length: 16 }, () => 0 as DrumCell));
}

function starterPattern(): DrumCell[][] {
  const pattern = blankPattern();
  [0, 8].forEach((step) => { pattern[0][step] = 2; });
  [4, 12].forEach((step) => { pattern[1][step] = 2; });
  [0, 2, 4, 6, 8, 10, 12, 14].forEach((step) => { pattern[2][step] = step % 4 === 0 ? 2 : 1; });
  pattern[3][15] = 1;
  return pattern;
}

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
        drumPattern: starterPattern(),
        drumKit: 'Pocket',
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
      }],
    },
    makeTrack('Bass', 'bass'),
    ...Array.from({ length: 5 }, (_, i) => makeTrack(`Audio ${i + 1}`, 'audio')),
  ];

  return {
    format: 'scratchtrack-project',
    version: 3,
    id: uid(),
    title: 'Untitled idea',
    bpm: 104,
    beatsPerBar: 4,
    createdAt: now,
    updatedAt: now,
    tracks,
    clips: [{ id: uid(), trackId: drumTrackId, scratchId: drumScratchId, startBeat: 0, lengthBeats: 16, sourceOffsetBeats: 0 }],
    loop: { ...defaultLoopState },
  };
}

export function normalizeProject(input: unknown): ScratchtrackProject {
  if (!input || typeof input !== 'object') return createInitialProject();
  const raw = input as Record<string, unknown>;
  if (raw.format !== 'scratchtrack-project') return createInitialProject();

  const rawVersion = typeof raw.version === 'number' ? raw.version : 1;
  const source = raw as unknown as {
    id?: string;
    title?: string;
    bpm?: number;
    beatsPerBar?: number;
    createdAt?: string;
    updatedAt?: string;
    tracks?: Track[];
    clips?: ScratchtrackProject['clips'];
    loop?: Partial<LoopState> & { captureEachPass?: boolean };
    drive?: ScratchtrackProject['drive'];
  };

  const tracks = (source.tracks ?? []).map((track) => ({
    ...track,
    muted: Boolean(track.muted),
    solo: Boolean(track.solo),
    settings: { ...defaultChannelSettings, ...(track.settings ?? {}) },
    scratches: (track.scratches ?? []).map((scratch) => ({
      ...scratch,
      drumSettings: scratch.drumPattern ? { ...defaultDrumSettings, ...(scratch.drumSettings ?? {}) } : scratch.drumSettings,
      synthPatch: scratch.synthPatch ? { ...defaultPatch, ...scratch.synthPatch } : scratch.synthPatch,
    })),
  }));
  if (!tracks.length) return createInitialProject();

  const sourceLoop = source.loop ?? {};
  const loop: LoopState = {
    enabled: Boolean(sourceLoop.enabled),
    startBeat: typeof sourceLoop.startBeat === 'number' ? sourceLoop.startBeat : defaultLoopState.startBeat,
    endBeat: typeof sourceLoop.endBeat === 'number' ? sourceLoop.endBeat : defaultLoopState.endBeat,
    // v3 intentionally starts Auto Scratch ON. Older prototype projects are upgraded to the new simpler behavior.
    autoScratch: rawVersion >= 3 ? sourceLoop.autoScratch !== false : true,
  };

  return {
    format: 'scratchtrack-project',
    version: 3,
    id: source.id ?? uid(),
    title: source.title ?? 'Untitled idea',
    bpm: source.bpm ?? 104,
    beatsPerBar: source.beatsPerBar ?? 4,
    createdAt: source.createdAt ?? new Date().toISOString(),
    updatedAt: source.updatedAt ?? new Date().toISOString(),
    tracks,
    clips: (source.clips ?? []).map((clip) => ({ ...clip, sourceOffsetBeats: clip.sourceOffsetBeats ?? 0 })),
    loop,
    drive: source.drive,
  };
}

export function loadProject(): ScratchtrackProject {
  const raw = localStorage.getItem(PROJECT_KEY);
  if (!raw) return createInitialProject();
  try {
    return normalizeProject(JSON.parse(raw));
  } catch {
    return createInitialProject();
  }
}

export function saveProject(project: ScratchtrackProject) {
  localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAudioBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadAudioBlob(id: string): Promise<Blob | undefined> {
  const db = await openDb();
  const result = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

export async function deleteAudioBlob(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function makeBlankPattern(): DrumCell[][] {
  return blankPattern();
}
