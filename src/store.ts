import type { ScratchtrackProject } from './types';
import { createInitialProject, normalizeProject } from './project';

const PROJECT_KEY = 'scratchtrack.project.v1';
const DB_NAME = 'scratchtrack-audio';
const STORE_NAME = 'blobs';

export { createInitialProject, normalizeProject, uid } from './project';
export { defaultChannelSettings, defaultDrumSettings, defaultPatch, defaultLoopState } from './project';

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

/** Load the locally persisted project (migrating older formats transparently). */
export function loadProject(): ScratchtrackProject {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return createInitialProject();
    return normalizeProject(JSON.parse(raw));
  } catch {
    return createInitialProject();
  }
}

export function saveProject(project: ScratchtrackProject) {
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
  } catch {
    /* Storage full or blocked — local autosave is best-effort. */
  }
}
