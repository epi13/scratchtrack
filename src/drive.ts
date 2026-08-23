import { readZipStore, writeZipStore } from './pack';
import type { ScratchtrackProject } from './types';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const PACK_NAME = 'scratchtrack.pack';
const TOKEN_SKEW_MS = 60_000;

let accessToken: string | null = null;
let tokenExpiresAt = 0;
let gisPromise: Promise<void> | null = null;
let pickerPromise: Promise<void> | null = null;
let tokenClient: { requestAccessToken(options?: { prompt?: string }): void } | null = null;
let pendingToken: { resolve: (token: string) => void; reject: (error: Error) => void } | null = null;

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; expires_in?: number; error?: string }) => void;
          }): { requestAccessToken(options?: { prompt?: string }): void };
        };
      };
      picker?: {
        PickerBuilder: new () => GooglePickerBuilder;
        DocsView: new (viewId?: string) => GoogleDocsView;
        ViewId: { FOLDERS: string; DOCS: string };
        Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string };
        Action: { PICKED: string; CANCEL: string };
        DocsViewMode: { LIST: string };
      };
    };
    gapi?: { load(name: string, callback: () => void): void };
  }
}

interface GoogleDocsView {
  setIncludeFolders(value: boolean): GoogleDocsView;
  setSelectFolderEnabled(value: boolean): GoogleDocsView;
  setParent(id: string): GoogleDocsView;
  setMimeTypes(types: string): GoogleDocsView;
  setMode?(mode: string): GoogleDocsView;
}

interface GooglePickerBuilder {
  addView(view: GoogleDocsView): GooglePickerBuilder;
  setOAuthToken(token: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  setAppId(id: string): GooglePickerBuilder;
  setTitle(title: string): GooglePickerBuilder;
  setCallback(callback: (data: { action: string; docs?: Array<{ id: string; name: string; mimeType: string }> }) => void): GooglePickerBuilder;
  enableFeature(feature: string): GooglePickerBuilder;
  build(): { setVisible(value: boolean): void };
}

export class DriveAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriveAuthError';
  }
}

export function googleClientId() {
  const fromEnv = String(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
  if (fromEnv) return fromEnv;
  return localStorage.getItem('scratchtrack.googleClientId')?.trim() ?? '';
}

export function googlePickerKey() {
  return String(import.meta.env.VITE_GOOGLE_API_KEY ?? '').trim();
}

export function googleAppId() {
  return String(import.meta.env.VITE_GOOGLE_APP_ID ?? '').trim();
}

export function isDriveConfigured() {
  return Boolean(googleClientId());
}

export function isPickerConfigured() {
  return Boolean(googlePickerKey());
}

export function isDriveConnected() {
  return Boolean(accessToken) && Date.now() < tokenExpiresAt;
}

export function sharedProjectIdFromLocation() {
  try {
    return new URLSearchParams(window.location.search).get('project')?.trim() ?? '';
  } catch {
    return '';
  }
}

/**
 * Extract a Drive folder ID from anything a collaborator might paste:
 * standard share links (`https://drive.google.com/drive/folders/<id>?usp=sharing`),
 * multi-account/mobile variants of that URL, Scratchtrack's own `?project=<id>`
 * links, or a bare folder ID.
 */
export function parseDriveFolderLink(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const folderMatch = text.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?(?:mobile\/)?folders\/([A-Za-z0-9_-]{10,})/);
  if (folderMatch?.[1]) return folderMatch[1];
  try {
    const url = new URL(text);
    const project = url.searchParams.get('project')?.trim();
    if (project && /^[A-Za-z0-9_-]{10,}$/.test(project)) return project;
  } catch {
    /* Not an absolute URL — fall through to raw-ID detection. */
  }
  if (/^[A-Za-z0-9_-]{15,}$/.test(text)) return text;
  return null;
}

export function projectShareUrl(folderId: string) {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin);
  url.searchParams.set('project', folderId);
  return url.toString();
}

export function driveFolderWebUrl(folderId: string) {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') resolve();
      else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
      }
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = loadScript('https://accounts.google.com/gsi/client');
  return gisPromise;
}

function loadPickerApi(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  if (pickerPromise) return pickerPromise;
  pickerPromise = loadScript('https://apis.google.com/js/api.js').then(() => new Promise<void>((resolve, reject) => {
    if (!window.gapi) {
      reject(new Error('Google Picker did not initialize.'));
      return;
    }
    window.gapi.load('picker', () => resolve());
  }));
  return pickerPromise;
}

function rememberToken(token: string, expiresIn?: number) {
  accessToken = token;
  const seconds = Number(expiresIn);
  tokenExpiresAt = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3600_000) - TOKEN_SKEW_MS;
}

async function ensureTokenClient() {
  const clientId = googleClientId();
  if (!clientId) throw new DriveAuthError('Scratchtrack is missing its Google client ID. The site owner needs to add that once in Google Cloud and GitHub Pages.');
  await loadGis();
  if (!window.google) throw new DriveAuthError('Google sign-in did not initialize.');
  if (tokenClient) return;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_SCOPE,
    callback: (response) => {
      const waiter = pendingToken;
      pendingToken = null;
      if (response.access_token) {
        rememberToken(response.access_token, response.expires_in);
        waiter?.resolve(response.access_token);
        return;
      }
      waiter?.reject(new DriveAuthError(response.error === 'popup_closed_by_user'
        ? 'Google sign-in was closed before finishing.'
        : 'Google Drive authorization failed.'));
    },
  });
}

function requestAccessToken(prompt: '' | 'consent' | 'select_account') {
  return new Promise<string>((resolve, reject) => {
    if (!tokenClient) {
      reject(new DriveAuthError('Connect Google Drive first.'));
      return;
    }
    pendingToken = { resolve, reject };
    tokenClient.requestAccessToken({ prompt });
  });
}

export async function connectDrive(interactive = true): Promise<void> {
  await ensureTokenClient();
  if (!interactive && isDriveConnected()) return;
  await requestAccessToken(interactive ? 'select_account' : '');
}

export async function refreshDriveIfNeeded(): Promise<void> {
  if (isDriveConnected()) return;
  await ensureTokenClient();
  try {
    await requestAccessToken('');
  } catch {
    throw new DriveAuthError('Google Drive needs you to reconnect.');
  }
}

export function disconnectDrive() {
  accessToken = null;
  tokenExpiresAt = 0;
}

function authHeaders(extra?: HeadersInit): Headers {
  if (!accessToken) throw new DriveAuthError('Connect Google Drive first.');
  const headers = new Headers(extra);
  headers.set('Authorization', `Bearer ${accessToken}`);
  return headers;
}

async function driveFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: authHeaders(init?.headers) });
  if (response.status === 401 || response.status === 403) {
    accessToken = null;
    throw new DriveAuthError('Google Drive needs you to reconnect.');
  }
  return response;
}

async function driveJson(url: string, init?: RequestInit) {
  const response = await driveFetch(url, init);
  if (!response.ok) throw new Error(`Drive request failed (${response.status}).`);
  return response.json();
}

async function findNamed(name: string, parentId?: string): Promise<string | undefined> {
  const clauses = [`name='${name.replaceAll("'", "\\'")}'`, 'trashed=false'];
  if (parentId) clauses.push(`'${parentId}' in parents`);
  const query = encodeURIComponent(clauses.join(' and '));
  const data = await driveJson(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`);
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
  const response = await driveFetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!response.ok) throw new Error(`Drive upload failed (${response.status}).`);
  const data = await response.json();
  return data.id as string;
}

function bytesForBlob(data: Uint8Array) {
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  return copy;
}

function extensionFor(mimeType?: string) {
  if (!mimeType) return 'wav';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  return 'webm';
}

async function listChildren(folderId: string): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const data = await driveJson(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  return (data.files ?? []) as Array<{ id: string; name: string; mimeType: string }>;
}

async function downloadFile(fileId: string): Promise<Blob> {
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`);
  if (response.status === 404) throw new Error('Scratchtrack cannot see that Drive file yet. Open it with the file picker so this app is allowed to read it.');
  if (!response.ok) throw new Error(`Drive download failed (${response.status}).`);
  return response.blob();
}

export interface PickedDriveItem {
  id: string;
  name: string;
  mimeType: string;
}

export async function pickDriveItem(options: {
  title: string;
  folderId?: string;
  foldersOnly?: boolean;
}): Promise<PickedDriveItem | null> {
  if (!isPickerConfigured()) {
    throw new Error('This copy of Scratchtrack is missing the Google Picker API key. The site owner needs to add that once in Google Cloud and GitHub Pages.');
  }
  await refreshDriveIfNeeded();
  await loadPickerApi();
  const pickerApi = window.google?.picker;
  if (!pickerApi || !accessToken) throw new Error('Google Picker did not initialize.');

  return new Promise((resolve, reject) => {
    try {
      const view = options.foldersOnly
        ? new pickerApi.DocsView(pickerApi.ViewId.FOLDERS).setSelectFolderEnabled(true).setIncludeFolders(true)
        : new pickerApi.DocsView().setIncludeFolders(true).setSelectFolderEnabled(true);
      if (options.folderId) view.setParent(options.folderId);
      if (pickerApi.DocsViewMode?.LIST) view.setMode?.(pickerApi.DocsViewMode.LIST);
      const builder = new pickerApi.PickerBuilder()
        .addView(view)
        .setOAuthToken(accessToken!)
        .setDeveloperKey(googlePickerKey())
        .setTitle(options.title)
        .enableFeature(pickerApi.Feature.SUPPORT_DRIVES)
        .setCallback((data) => {
          if (data.action === pickerApi.Action.CANCEL) {
            resolve(null);
            return;
          }
          if (data.action === pickerApi.Action.PICKED && data.docs?.[0]) {
            const doc = data.docs[0];
            resolve({ id: doc.id, name: doc.name, mimeType: doc.mimeType });
          }
        });
      const appId = googleAppId();
      if (appId) builder.setAppId(appId);
      builder.build().setVisible(true);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Could not open Google Picker.'));
    }
  });
}

export async function syncProjectToDrive(
  project: ScratchtrackProject,
  getAudioBlob: (id: string) => Promise<Blob | undefined>,
): Promise<{ rootFolderId: string; projectFolderId: string; uploadedAudio: number }> {
  await refreshDriveIfNeeded();
  const rootFolderId = await ensureFolder('Scratchtrack');
  const projectFolderId = project.drive?.projectFolderId
    ?? await ensureFolder(`${project.title} — ${project.id.slice(0, 8)}`, rootFolderId);
  const projectBlob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  await uploadBlob('project.json', 'application/json', projectBlob, projectFolderId);

  const packFiles: Array<{ name: string; data: Uint8Array }> = [
    { name: 'project.json', data: new Uint8Array(await projectBlob.arrayBuffer()) },
  ];
  let uploadedAudio = 0;
  for (const track of project.tracks) {
    for (const scratch of track.scratches) {
      if (!scratch.audioBlobId) continue;
      const blob = await getAudioBlob(scratch.audioBlobId);
      if (!blob) continue;
      const ext = extensionFor(scratch.audioMimeType || blob.type);
      const fileName = `audio-${scratch.id}.${ext}`;
      await uploadBlob(fileName, scratch.audioMimeType || blob.type || 'audio/wav', blob, projectFolderId);
      packFiles.push({ name: fileName, data: new Uint8Array(await blob.arrayBuffer()) });
      uploadedAudio += 1;
    }
  }
  const pack = writeZipStore(packFiles);
  await uploadBlob(PACK_NAME, 'application/zip', new Blob([bytesForBlob(pack)], { type: 'application/zip' }), projectFolderId);
  return { rootFolderId, projectFolderId, uploadedAudio };
}

async function projectFromFiles(
  files: Array<{ name: string; blob: Blob }>,
  putAudio: (id: string, blob: Blob) => Promise<void>,
): Promise<ScratchtrackProject> {
  const pack = files.find((file) => file.name === PACK_NAME || file.name.endsWith('.pack') || file.name.endsWith('.zip'));
  let entries: Array<{ name: string; blob: Blob }> = files;
  if (pack) {
    const bytes = new Uint8Array(await pack.blob.arrayBuffer());
    entries = readZipStore(bytes).map((file) => ({
      name: file.name,
      blob: new Blob([bytesForBlob(file.data)], { type: file.name.endsWith('.json') ? 'application/json' : 'application/octet-stream' }),
    }));
  }
  const projectFile = entries.find((file) => file.name === 'project.json' || file.name.endsWith('project.json'));
  if (!projectFile) throw new Error('That Drive folder does not contain a Scratchtrack project.json.');
  const project = JSON.parse(await projectFile.blob.text()) as ScratchtrackProject;
  if (project.format !== 'scratchtrack-project') throw new Error('That file is not a Scratchtrack project.');

  const audioFiles = new Map(entries.filter((file) => file.name.startsWith('audio-')).map((file) => [file.name, file.blob]));
  for (const track of project.tracks ?? []) {
    for (const scratch of track.scratches ?? []) {
      if (!scratch.audioBlobId) continue;
      const match = [...audioFiles.entries()].find(([name]) => name.startsWith(`audio-${scratch.id}.`));
      if (!match) continue;
      const blob = match[1];
      const named = blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: scratch.audioMimeType || 'audio/wav' });
      await putAudio(scratch.audioBlobId, named);
    }
  }
  return project;
}

export async function loadProjectFromDriveFolder(
  folderId: string,
  putAudio: (id: string, blob: Blob) => Promise<void>,
): Promise<ScratchtrackProject> {
  await refreshDriveIfNeeded();
  let children: Array<{ id: string; name: string; mimeType: string }> = [];
  try {
    children = await listChildren(folderId);
  } catch (error) {
    if (error instanceof DriveAuthError) throw error;
    children = [];
  }

  if (!children.length) {
    const picked = await pickDriveItem({
      title: 'Open the shared Scratchtrack folder or scratchtrack.pack',
      folderId,
    });
    if (!picked) throw new Error('No shared project was selected.');
    if (picked.mimeType === 'application/vnd.google-apps.folder') {
      children = await listChildren(picked.id);
      if (!children.length) {
        throw new Error('Google has not granted Scratchtrack access to the files inside that folder yet. Pick scratchtrack.pack or project.json from the shared folder.');
      }
      return loadProjectFromListedFiles(picked.id, children, putAudio);
    }
    const blob = await downloadFile(picked.id);
    return projectFromFiles([{ name: picked.name, blob }], putAudio);
  }
  return loadProjectFromListedFiles(folderId, children, putAudio);
}

async function loadProjectFromListedFiles(
  folderId: string,
  children: Array<{ id: string; name: string; mimeType: string }>,
  putAudio: (id: string, blob: Blob) => Promise<void>,
) {
  const pack = children.find((file) => file.name === PACK_NAME);
  if (pack) {
    const blob = await downloadFile(pack.id);
    return projectFromFiles([{ name: pack.name, blob }], putAudio);
  }
  const files = [];
  for (const child of children) {
    if (child.mimeType === 'application/vnd.google-apps.folder') continue;
    files.push({ name: child.name, blob: await downloadFile(child.id) });
  }
  if (!files.length) throw new Error(`Nothing readable was found in Drive folder ${folderId}.`);
  return projectFromFiles(files, putAudio);
}

export async function openSharedProjectWithPicker(putAudio: (id: string, blob: Blob) => Promise<void>) {
  const picked = await pickDriveItem({
    title: 'Choose the shared Scratchtrack folder',
    foldersOnly: false,
  });
  if (!picked) throw new Error('No shared project was selected.');
  if (picked.mimeType === 'application/vnd.google-apps.folder') {
    return { folderId: picked.id, project: await loadProjectFromDriveFolder(picked.id, putAudio) };
  }
  const blob = await downloadFile(picked.id);
  const project = await projectFromFiles([{ name: picked.name, blob }], putAudio);
  return { folderId: undefined as string | undefined, project };
}
