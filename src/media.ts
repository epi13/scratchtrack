import {
  WavMagic,
  mncsMagicCode,
  mncsWavBitsPerSample,
  mncsWavBitsSupported,
  mncsWavByteRate,
  mncsWavDataSize,
  mncsWavDataSizeForSamples,
  mncsWavRiffChunkSize,
  mncsWavSampleCount,
  mncsWavSampleRate,
} from './mncsWav';

/** Inspect a media blob's leading bytes for a real container, not a recorder fragment. */
export type MediaKind = 'wav' | 'webm' | 'mp4' | 'ogg' | 'unknown' | 'empty' | 'fragment';

const WEBM_CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
const WEBM_SEGMENT = [0x18, 0x53, 0x80, 0x67];

function startsWith(bytes: Uint8Array, magic: number[], offset = 0) {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((value, index) => bytes[offset + index] === value);
}

export function inspectMediaBytes(bytes: Uint8Array, mimeType = ''): MediaKind {
  if (!bytes.length) return 'empty';

  // Leading-magic classification owned by the MNCS container model
  // (`magic_code`); length/mime fragment rules stay host-side.
  switch (mncsMagicCode(bytes)) {
    case WavMagic.Wav: return 'wav';
    case WavMagic.Webm: return 'webm';
    case WavMagic.Mp4: return 'mp4';
    case WavMagic.Ogg: return 'ogg';
    default: break;
  }

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
  // Container size laws owned by the MNCS container model; byte writes and
  // float sample scaling stay host-side at the boundary.
  const dataSize = mncsWavDataSizeForSamples(samples.length);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, mncsWavRiffChunkSize(dataSize), true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, mncsWavByteRate(rate), true);
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
  // Header field reads at MNCS-owned offsets; validity policy is MNCS-owned.
  const sampleRate = mncsWavSampleRate(view);
  const bits = mncsWavBitsPerSample(view);
  if (!mncsWavBitsSupported(bits)) throw new Error('Only 16-bit PCM WAV is supported in this helper.');
  const dataSize = mncsWavDataSize(view);
  const sampleCount = mncsWavSampleCount(dataSize);
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
