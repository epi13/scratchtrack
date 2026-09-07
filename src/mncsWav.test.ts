import { describe, expect, it } from 'vitest';
import {
  WAV_BITS_OFFSET,
  WAV_CHANNELS_OFFSET,
  WAV_DATA_SIZE_OFFSET,
  WAV_FORMAT_OFFSET,
  WAV_HEADER_SIZE,
  WAV_SAMPLE_RATE_OFFSET,
  WavMagic,
  mncsLeU16,
  mncsLeU32,
  mncsMagicCode,
  mncsWavBitsPerSample,
  mncsWavBitsSupported,
  mncsWavByteRate,
  mncsWavChannels,
  mncsWavDataSize,
  mncsWavDataSizeForSamples,
  mncsWavDecodable,
  mncsWavFormatTag,
  mncsWavMagicOk,
  mncsWavRiffChunkSize,
  mncsWavSampleCount,
  mncsWavSampleRate,
} from './mncsWav';
import { decodeWavPcm16, encodeWavPcm16, inspectMediaBytes } from './media';

/**
 * Conformance: the TypeScript projection must agree function-for-function
 * with `mncs/wav.mncs` (`scratchtrack.wav.v1`). Every vector below is also
 * a case in `mncs/wav-corpus.json`, executed through the MNCS toolchain
 * on the portable-WASM and research-bytecode backends (28/28 returned
 * with expectations met on both; see docs/mncs-pressure.md). If this test
 * and the corpus disagree, the bug is here, never in MNCS source.
 */
function wavBytes(sampleRate = 44100, bits = 16, channels = 1, dataSize = 960): Uint8Array {
  const header = new Uint8Array(WAV_HEADER_SIZE);
  const view = new DataView(header.buffer);
  header.set([0x52, 0x49, 0x46, 0x46], 0);
  header.set([0x57, 0x41, 0x56, 0x45], 8);
  view.setUint16(WAV_FORMAT_OFFSET, 1, true);
  view.setUint16(WAV_CHANNELS_OFFSET, channels, true);
  view.setUint32(WAV_SAMPLE_RATE_OFFSET, sampleRate, true);
  view.setUint16(WAV_BITS_OFFSET, bits, true);
  view.setUint32(WAV_DATA_SIZE_OFFSET, dataSize, true);
  return header;
}

describe('mncsWav conformance with scratchtrack.wav.v1', () => {
  it('exposes the canonical field offsets', () => {
    expect(WAV_FORMAT_OFFSET).toBe(20);
    expect(WAV_CHANNELS_OFFSET).toBe(22);
    expect(WAV_SAMPLE_RATE_OFFSET).toBe(24);
    expect(WAV_BITS_OFFSET).toBe(34);
    expect(WAV_DATA_SIZE_OFFSET).toBe(40);
    expect(WAV_HEADER_SIZE).toBe(44);
  });

  it('decodes little-endian fields (corpus: le-*, rate-*, bits-*, channels-*, format-*, data-size)', () => {
    const bytes = wavBytes();
    const view = new DataView(bytes.buffer);
    expect(mncsLeU16(view, 34)).toBe(16);
    expect(mncsLeU32(view, 24)).toBe(44100);
    expect(mncsWavSampleRate(view)).toBe(44100);
    expect(mncsWavBitsPerSample(view)).toBe(16);
    expect(mncsWavChannels(view)).toBe(1);
    expect(mncsWavFormatTag(view)).toBe(1);
    expect(mncsWavDataSize(view)).toBe(960);
    expect(mncsWavSampleRate(new DataView(wavBytes(48000).buffer))).toBe(48000);
    expect(mncsWavBitsPerSample(new DataView(wavBytes(44100, 8).buffer))).toBe(8);
  });

  it('judges decodability exactly like the decoder (corpus: magic-*, decodable-*, bits-*)', () => {
    const good = wavBytes();
    expect(mncsWavMagicOk(good)).toBe(true);
    expect(mncsWavDecodable(new DataView(good.buffer), good)).toBe(true);
    expect(mncsWavDecodable(new DataView(wavBytes(44100, 8).buffer), wavBytes(44100, 8))).toBe(false);
    expect(mncsWavDecodable(new DataView(wavBytes(44100, 16, 2).buffer), wavBytes(44100, 16, 2))).toBe(false);
    const riffx = wavBytes();
    riffx[3] = 0x58;
    expect(mncsWavMagicOk(riffx)).toBe(false);
    expect(mncsWavBitsSupported(16)).toBe(true);
    expect(mncsWavBitsSupported(8)).toBe(false);
  });

  it('computes container size laws (corpus: sample-count-*, riff-size, data-for-samples, byte-rate)', () => {
    expect(mncsWavSampleCount(960)).toBe(480);
    expect(mncsWavSampleCount(961)).toBe(480);
    expect(mncsWavRiffChunkSize(960)).toBe(996);
    expect(mncsWavDataSizeForSamples(480)).toBe(960);
    expect(mncsWavByteRate(44100)).toBe(88200);
  });

  it('classifies leading magics (corpus: magic-*)', () => {
    expect(mncsMagicCode(wavBytes().subarray(0, 12))).toBe(WavMagic.Wav);
    expect(mncsMagicCode(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 0, 0, 0, 0, 0, 0, 0]))).toBe(WavMagic.Webm);
    expect(mncsMagicCode(new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112, 0, 0, 0, 0]))).toBe(WavMagic.Mp4);
    expect(mncsMagicCode(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(WavMagic.Ogg);
    expect(mncsMagicCode(new Uint8Array(12))).toBe(WavMagic.Unknown);
  });

  it('agrees with the app encoder/decoder round-trip', async () => {
    const samples = new Float32Array([0, 0.25, -0.5, 0.9]);
    const bytes = new Uint8Array(await encodeWavPcm16(samples, 22050).arrayBuffer());
    expect(inspectMediaBytes(bytes)).toBe('wav');
    const view = new DataView(bytes.buffer);
    expect(mncsWavSampleRate(view)).toBe(22050);
    expect(mncsWavDataSize(view)).toBe(samples.length * 2);
    expect(mncsWavSampleCount(mncsWavDataSize(view))).toBe(samples.length);
    expect(mncsWavRiffChunkSize(mncsWavDataSize(view))).toBe(bytes.length - 8);
    const decoded = decodeWavPcm16(bytes);
    expect(decoded.sampleRate).toBe(22050);
    expect(decoded.samples.length).toBe(samples.length);
  });
});
