import { mncsCrc32 } from './mncsCrc';
import {
  ZIP_CENTRAL_HEADER_SIZE,
  ZIP_EOCD_SIZE,
  mncsCentralEntry,
  mncsCentralNext,
  mncsCentralRecordSize,
  mncsCentralSignatureOk,
  mncsEocdCentralOffset,
  mncsEocdCount,
  mncsEocdSignatureOk,
  mncsLocalDataSize,
  mncsLocalDataStart,
  mncsLocalExtraLen,
  mncsLocalNameLen,
  mncsLocalRecordSize,
} from './mncsPack';

function crc32(data: Uint8Array) {
  // IEEE 802.3 owned by the MNCS CRC model (`scratchtrack.crc.v1` /
  // `mncsCrc.ts`): WASM-chunked streaming first, table engine fallback.
  return mncsCrc32(data);
}

function putAscii(target: Uint8Array, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) target[offset + index] = text.charCodeAt(index);
}

export interface PackFile {
  name: string;
  data: Uint8Array;
}

/** Uncompressed ZIP so a Drive collaborator can pick one independently readable project file. */
export function writeZipStore(files: PackFile[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const checksum = crc32(file.data);
    // Record sizes owned by the MNCS pack model; checksums by the MNCS
    // CRC model (streamed 64-byte windows — see mncsCrc.ts).
    const local = new Uint8Array(mncsLocalRecordSize(nameBytes.length, file.data.length));
    const localView = new DataView(local.buffer);
    putAscii(local, 0, 'PK\u0003\u0004');
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(file.data, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(mncsCentralRecordSize(nameBytes.length));
    const centralView = new DataView(central.buffer);
    putAscii(central, 0, 'PK\u0001\u0002');
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(ZIP_EOCD_SIZE);
  const endView = new DataView(end.buffer);
  putAscii(end, 0, 'PK\u0005\u0006');
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of localParts) { out.set(part, cursor); cursor += part.length; }
  for (const part of centralParts) { out.set(part, cursor); cursor += part.length; }
  out.set(end, cursor);
  return out;
}

export function readZipStore(bytes: Uint8Array): PackFile[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Backward EOCD scan stays host-side (dynamic search loop); signature
  // and field layout are MNCS-owned.
  let end = bytes.length - ZIP_EOCD_SIZE;
  while (end >= 0) {
    if (mncsEocdSignatureOk(view, end)) break;
    end -= 1;
  }
  if (end < 0) throw new Error('Not a Scratchtrack project pack.');
  const count = mncsEocdCount(view, end);
  let central = mncsEocdCentralOffset(view, end);
  const files: PackFile[] = [];
  for (let index = 0; index < count; index += 1) {
    if (!mncsCentralSignatureOk(view, central)) throw new Error('Project pack is damaged.');
    const entry = mncsCentralEntry(view, central);
    const name = new TextDecoder().decode(
      bytes.subarray(central + ZIP_CENTRAL_HEADER_SIZE, central + ZIP_CENTRAL_HEADER_SIZE + entry.nameLen),
    );
    const localNameLength = mncsLocalNameLen(view, entry.localOffset);
    const localExtra = mncsLocalExtraLen(view, entry.localOffset);
    const dataStart = mncsLocalDataStart(entry.localOffset, localNameLength, localExtra);
    const dataSize = mncsLocalDataSize(view, entry.localOffset);
    files.push({ name, data: bytes.subarray(dataStart, dataStart + dataSize) });
    central = mncsCentralNext(central, entry.nameLen, entry.extraLen, entry.commentLen);
  }
  return files;
}
