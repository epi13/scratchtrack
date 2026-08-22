import type { ScratchtrackProject } from './types';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
let token: string | null = null;
let gisPromise: Promise<void> | null = null;

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }): { requestAccessToken(options?: { prompt?: string }): void };
        };
      };
    };
  }
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google Identity Services.'));
    document.head.appendChild(script);
  });
  return gisPromise;
}

export async function connectDrive(clientId: string): Promise<void> {
  await loadGis();
  if (!window.google) throw new Error('Google Identity Services did not initialize.');
  token = await new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => response.access_token ? resolve(response.access_token) : reject(new Error(response.error || 'Drive authorization failed.')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  if (!token) throw new Error('Connect Google Drive first.');
  return { Authorization: `Bearer ${token}`, ...extra };
}

async function driveJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: authHeaders(init?.headers) });
  if (!response.ok) throw new Error(`Drive request failed (${response.status}).`);
  return response.json();
}

async function findNamed(name: string, parentId?: string): Promise<string | undefined> {
  const clauses = [`name='${name.replaceAll("'", "\\'")}'`, 'trashed=false'];
  if (parentId) clauses.push(`'${parentId}' in parents`);
  const query = encodeURIComponent(clauses.join(' and '));
  const data = await driveJson(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=10`);
  return data.files?.[0]?.id as string | undefined;
}

async function createFolder(name: string, parentId?: string): Promise<string> {
  const metadata: Record<string, unknown> = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) metadata.parents = [parentId];
  const data = await driveJson('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  return data.id as string;
}

async function ensureFolder(name: string, parentId?: string) {
  return (await findNamed(name, parentId)) ?? createFolder(name, parentId);
}

async function uploadBlob(name: string, mimeType: string, blob: Blob, parentId: string): Promise<string> {
  const existingId = await findNamed(name, parentId);
  const boundary = `scratchtrack_${crypto.randomUUID()}`;
  const metadata = { name, mimeType, parents: existingId ? undefined : [parentId] };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` });
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';
  const response = await fetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: authHeaders({ 'Content-Type': `multipart/related; boundary=${boundary}` }),
    body,
  });
  if (!response.ok) throw new Error(`Drive upload failed (${response.status}).`);
  const data = await response.json();
  return data.id as string;
}

function extensionFor(mimeType?: string) {
  if (!mimeType) return 'webm';
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

export async function syncProjectToDrive(
  project: ScratchtrackProject,
  getAudioBlob: (id: string) => Promise<Blob | undefined>,
): Promise<{ rootFolderId: string; projectFolderId: string; uploadedAudio: number }> {
  const rootFolderId = await ensureFolder('Scratchtrack');
  const projectFolderId = await ensureFolder(`${project.title} — ${project.id.slice(0, 8)}`, rootFolderId);
  const projectBlob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  await uploadBlob('project.json', 'application/json', projectBlob, projectFolderId);

  let uploadedAudio = 0;
  for (const track of project.tracks) {
    for (const scratch of track.scratches) {
      if (!scratch.audioBlobId) continue;
      const blob = await getAudioBlob(scratch.audioBlobId);
      if (!blob) continue;
      const ext = extensionFor(scratch.audioMimeType || blob.type);
      await uploadBlob(`audio-${scratch.id}.${ext}`, scratch.audioMimeType || blob.type || 'audio/webm', blob, projectFolderId);
      uploadedAudio += 1;
    }
  }
  return { rootFolderId, projectFolderId, uploadedAudio };
}

export function isDriveConnected() {
  return Boolean(token);
}
