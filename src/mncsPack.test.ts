import { describe, expect, it } from 'vitest';
import {
  ZIP_CENTRAL_HEADER_SIZE,
  ZIP_CENTRAL_SIGNATURE,
  ZIP_EOCD_SIGNATURE,
  ZIP_EOCD_SIZE,
  ZIP_LOCAL_HEADER_SIZE,
  ZIP_LOCAL_SIGNATURE,
  mncsCentralEntry,
  mncsCentralNext,
  mncsCentralRecordSize,
  mncsCentralSignatureOk,
  mncsEocdCentralOffset,
  mncsEocdCentralSize,
  mncsEocdCount,
  mncsEocdSignatureOk,
  mncsLocalDataSize,
  mncsLocalDataStart,
  mncsLocalExtraLen,
  mncsLocalNameLen,
  mncsLocalRecordSize,
  mncsLocalSignatureOk,
  mncsPackLe16,
  mncsPackLe32,
} from './mncsPack';
import { readZipStore, writeZipStore } from './pack';

/**
 * Conformance: the TypeScript projection must agree function-for-function
 * with `mncs/pack.mncs` (`scratchtrack.pack.v1`). Every vector below is
 * also a case in `mncs/pack-corpus.json`, executed through the MNCS
 * toolchain on the portable-WASM and research-bytecode backends (24/24
 * returned with expectations met on both; see docs/mncs-pressure.md). If
 * this test and the corpus disagree, the bug is here, never in MNCS
 * source.
 */
function localWindow(): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, ZIP_LOCAL_SIGNATURE, true);
  view.setUint16(26, 12, true);
  view.setUint16(28, 0, true);
  view.setUint32(22, 100, true);
  return { bytes, view };
}

function centralWindow(): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, ZIP_CENTRAL_SIGNATURE, true);
  view.setUint32(16, 0x12345678, true);
  view.setUint32(24, 100, true);
  view.setUint16(28, 12, true);
  view.setUint32(42, 0, true);
  return { bytes, view };
}

function eocdWindow(): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, ZIP_EOCD_SIGNATURE, true);
  view.setUint16(10, 2, true);
  view.setUint32(12, 116, true);
  view.setUint32(16, 284, true);
  return { bytes, view };
}

describe('mncsPack conformance with scratchtrack.pack.v1', () => {
  it('exposes the canonical signatures and sizes', () => {
    expect(ZIP_LOCAL_SIGNATURE).toBe(0x04034b50);
    expect(ZIP_CENTRAL_SIGNATURE).toBe(0x02014b50);
    expect(ZIP_EOCD_SIGNATURE).toBe(0x06054b50);
    expect(ZIP_LOCAL_HEADER_SIZE).toBe(30);
    expect(ZIP_CENTRAL_HEADER_SIZE).toBe(46);
    expect(ZIP_EOCD_SIZE).toBe(22);
  });

  it('parses local headers (corpus: local-*)', () => {
    const { view } = localWindow();
    expect(mncsLocalSignatureOk(view, 0)).toBe(true);
    expect(mncsLocalNameLen(view, 0)).toBe(12);
    expect(mncsLocalExtraLen(view, 0)).toBe(0);
    expect(mncsLocalDataSize(view, 0)).toBe(100);
    expect(mncsLocalDataStart(0, 12, 0)).toBe(42);
    expect(mncsLocalDataStart(100, 5, 7)).toBe(142);
    expect(mncsLocalRecordSize(12, 100)).toBe(142);
    expect(mncsPackLe16(view, 26)).toBe(12);
    expect(mncsPackLe32(view, 22)).toBe(100);
  });

  it('parses central entries (corpus: central-*)', () => {
    const { view } = centralWindow();
    expect(mncsCentralSignatureOk(view, 0)).toBe(true);
    expect(mncsCentralEntry(view, 0)).toEqual({
      nameLen: 12,
      extraLen: 0,
      commentLen: 0,
      localOffset: 0,
      dataSize: 100,
      crc: 0x12345678,
    });
    expect(mncsCentralNext(284, 12, 0, 0)).toBe(342);
    expect(mncsCentralNext(0, 12, 4, 6)).toBe(68);
    expect(mncsCentralRecordSize(12)).toBe(58);
  });

  it('parses end-of-central-directory (corpus: eocd-*)', () => {
    const { view } = eocdWindow();
    expect(mncsEocdSignatureOk(view, 0)).toBe(true);
    expect(mncsEocdCount(view, 0)).toBe(2);
    expect(mncsEocdCentralSize(view, 0)).toBe(116);
    expect(mncsEocdCentralOffset(view, 0)).toBe(284);
  });

  it('round-trips the app pack writer through MNCS-parsed layout', () => {
    const projectJson = new TextEncoder().encode('{"format":"scratchtrack-project"}');
    const packed = writeZipStore([
      { name: 'project.json', data: projectJson },
      { name: 'audio-loop-01.wav', data: new Uint8Array([1, 2, 3, 4]) },
    ]);
    const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    // First local record parsed with MNCS-owned offsets and size laws.
    expect(mncsLocalSignatureOk(view, 0)).toBe(true);
    expect(mncsLocalNameLen(view, 0)).toBe('project.json'.length);
    expect(mncsLocalDataSize(view, 0)).toBe(projectJson.length);
    expect(mncsLocalDataStart(0, mncsLocalNameLen(view, 0), mncsLocalExtraLen(view, 0))).toBe(
      ZIP_LOCAL_HEADER_SIZE + 'project.json'.length,
    );
    // The reader still recovers both files.
    const files = readZipStore(packed);
    expect(files.map((file) => file.name)).toEqual(['project.json', 'audio-loop-01.wav']);
  });
});
