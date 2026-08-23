const CRC_TABLE = new Uint32Array(256);
for (let byte = 0; byte < 256; byte += 1) {
  let crc = byte;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (0xedb88320 ^ (crc >>> 1)) : crc >>> 1;
  CRC_TABLE[byte] = crc >>> 0;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) crc = CRC_TABLE[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
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
    const local = new Uint8Array(30 + nameBytes.length + file.data.length);
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

    const central = new Uint8Array(46 + nameBytes.length);
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
  const end = new Uint8Array(22);
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
  let end = bytes.length - 22;
  while (end >= 0) {
    if (view.getUint32(end, true) === 0x06054b50) break;
    end -= 1;
  }
  if (end < 0) throw new Error('Not a Scratchtrack project pack.');
  const count = view.getUint16(end + 10, true);
  let central = view.getUint32(end + 16, true);
  const files: PackFile[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(central, true) !== 0x02014b50) throw new Error('Project pack is damaged.');
    const nameLength = view.getUint16(central + 28, true);
    const extra = view.getUint16(central + 30, true);
    const comment = view.getUint16(central + 32, true);
    const localOffset = view.getUint32(central + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(central + 46, central + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtra = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtra;
    const dataSize = view.getUint32(localOffset + 22, true);
    files.push({ name, data: bytes.subarray(dataStart, dataStart + dataSize) });
    central += 46 + nameLength + extra + comment;
  }
  return files;
}
