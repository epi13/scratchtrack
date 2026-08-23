/** Inspect a media blob's leading bytes for a real container, not a recorder fragment. */
export type MediaKind = 'wav' | 'webm' | 'mp4' | 'ogg' | 'unknown' | 'empty' | 'fragment';

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const WEBM_CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
const WEBM_SEGMENT = [0x18, 0x53, 0x80, 0x67];
const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53];

function startsWith(bytes: Uint8Array, magic: number[], offset = 0) {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export function inspectMediaBytes(bytes: Uint8Array, mimeType = ''): MediaKind {
  if (!bytes.length) return 'empty';

  if (asciiAt(bytes, 0, 4) === 'RIFF' && bytes.length >= 12 && asciiAt(bytes, 8, 4) === 'WAVE') return 'wav';
  if (startsWith(bytes, EBML_MAGIC)) return 'webm';
  if (bytes.length >= 8 && asciiAt(bytes, 4, 4) === 'ftyp') return 'mp4';
  if (startsWith(bytes, OGG_MAGIC)) return 'ogg';

  const mime = mimeType.toLowerCase();
  const looksLikeChunk = startsWith(bytes, WEBM_CLUSTER) || startsWith(bytes, WEBM_SEGMENT);
  if (looksLikeChunk || mime.includes('webm') || mime.includes('mp4') || mime.includes('ogg')) {
    return 'fragment';
  }
  return 'unknown';
}

export function inspectMediaBlobSync(header: Uint8Array, mimeType?: string) {
  return inspectMediaBytes(header, mimeType);
}

export function playbackErrorMessage(kind: MediaKind, cause?: string) {
  if (kind === 'empty') return 'This Scratch has no audio data.';
  if (kind === 'fragment') {
    return 'This recording is not a complete audio file. Older Auto Scratch takes sometimes saved only a media fragment and cannot be played. Re-record that take.';
  }
  if (cause) return `This browser could not decode the recording (${cause}). The file may be an unsupported format.`;
  return 'This browser could not decode the recording. The file may be an unsupported format or a broken take.';
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

/** 16-bit mono PCM WAV — independently decodable on Chromium and Safari. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob {
  const rate = Math.max(8000, Math.round(sampleRate));
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(offset, clipped < 0 ? Math.round(clipped * 0x8000) : Math.round(clipped * 0x7fff), true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function decodeWavPcm16(bytes: Uint8Array): { sampleRate: number; samples: Float32Array } {
  if (inspectMediaBytes(bytes) !== 'wav') throw new Error('Not a WAV file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleRate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  if (bits !== 16) throw new Error('Only 16-bit PCM WAV is supported in this helper.');
  const dataSize = view.getUint32(40, true);
  const sampleCount = Math.floor(dataSize / 2);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = view.getInt16(44 + index * 2, true) / 0x8000;
  }
  return { sampleRate, samples };
}

export function isStandaloneMediaHeader(bytes: Uint8Array, mimeType?: string) {
  const kind = inspectMediaBytes(bytes, mimeType);
  return kind === 'wav' || kind === 'webm' || kind === 'mp4' || kind === 'ogg';
}
