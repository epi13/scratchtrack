import type { DrumCell, ScratchtrackProject, SynthPatch, Track } from './types';

const PROJECT_KEY = 'scratchtrack.project.v1';
const DB_NAME = 'scratchtrack-audio';
const STORE_NAME = 'blobs';

export const uid = () => crypto.randomUUID();

export const defaultPatch: SynthPatch = {
  oscA: 'sawtooth',
  oscB: 'square',
  oscMix: 0.35,
  cutoff: 2200,
  attack: 0.015,
  release: 0.28,
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
      activeScratchId: drumScratchId,
      scratches: [{
        id: drumScratchId,
        name: 'Scratch A',
        note: 'Starter groove',
        createdAt: now,
        drumPattern: starterPattern(),
        drumKit: 'Pocket',
      }],
    },
    {
      id: synthTrackId,
      name: 'Synth',
      kind: 'synth',
      muted: false,
      solo: false,
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
    { id: uid(), name: 'Bass', kind: 'bass', muted: false, solo: false, scratches: [] },
    ...Array.from({ length: 5 }, (_, i) => ({
      id: uid(),
      name: `Audio ${i + 1}`,
      kind: 'audio' as const,
      muted: false,
      solo: false,
      scratches: [],
    })),
  ];

  return {
    format: 'scratchtrack-project',
    version: 1,
    id: uid(),
    title: 'Untitled idea',
    bpm: 104,
    beatsPerBar: 4,
    createdAt: now,
    updatedAt: now,
    tracks,
    clips: [{ id: uid(), trackId: drumTrackId, scratchId: drumScratchId, startBeat: 0, lengthBeats: 16 }],
  };
}

export function loadProject(): ScratchtrackProject {
  const raw = localStorage.getItem(PROJECT_KEY);
  if (!raw) return createInitialProject();
  try {
    const parsed = JSON.parse(raw) as ScratchtrackProject;
    if (parsed.format !== 'scratchtrack-project' || parsed.version !== 1) return createInitialProject();
    return parsed;
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
