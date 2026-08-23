import { describe, expect, it } from 'vitest';
import { inspectMediaBytes, encodeWavPcm16, decodeWavPcm16, isStandaloneMediaHeader } from './media';
import { readZipStore, writeZipStore } from './pack';

describe('standalone media files', () => {
  it('encodes a WAV that is independently inspectable and round-trips samples', () => {
    const samples = new Float32Array(480);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.sin((2 * Math.PI * 440 * index) / 48000) * 0.5;
    }
    const blob = encodeWavPcm16(samples, 48000);
    expect(blob.type).toBe('audio/wav');
    return blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      expect(inspectMediaBytes(bytes)).toBe('wav');
      expect(isStandaloneMediaHeader(bytes, blob.type)).toBe(true);
      const decoded = decodeWavPcm16(bytes);
      expect(decoded.sampleRate).toBe(48000);
      expect(decoded.samples.length).toBe(samples.length);
      let error = 0;
      for (let index = 0; index < samples.length; index += 1) {
        error = Math.max(error, Math.abs((decoded.samples[index] ?? 0) - (samples[index] ?? 0)));
      }
      expect(error).toBeLessThan(0.0001);
    });
  });

  it('treats MediaRecorder-style WebM clusters without an EBML header as fragments', () => {
    const cluster = new Uint8Array([0x1f, 0x43, 0xb6, 0x75, 0x01, 0x02, 0x03, 0x04]);
    expect(inspectMediaBytes(cluster, 'audio/webm;codecs=opus')).toBe('fragment');
    expect(isStandaloneMediaHeader(cluster, 'audio/webm')).toBe(false);
  });

  it('treats MP4/AAC fragments without ftyp as unplayable leftovers', () => {
    const mdat = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x6d, 0x64, 0x61, 0x74, 0x00, 0x01]);
    expect(inspectMediaBytes(mdat, 'audio/mp4')).toBe('fragment');
  });

  it('accepts a real WebM/EBML header as standalone', () => {
    const ebml = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
    expect(inspectMediaBytes(ebml, 'audio/webm')).toBe('webm');
    expect(isStandaloneMediaHeader(ebml)).toBe(true);
  });

  it('encodes contiguous loop slices as independently playable WAV takes', async () => {
    const sampleRate = 8000;
    const pcm = new Float32Array(sampleRate * 3);
    for (let index = 0; index < pcm.length; index += 1) pcm[index] = (index % sampleRate) / sampleRate;
    const slices = [pcm.subarray(0, sampleRate), pcm.subarray(sampleRate, sampleRate * 2), pcm.subarray(sampleRate * 2)];
    for (const slice of slices) {
      const bytes = new Uint8Array(await encodeWavPcm16(slice, sampleRate).arrayBuffer());
      expect(isStandaloneMediaHeader(bytes, 'audio/wav')).toBe(true);
      expect(decodeWavPcm16(bytes).samples.length).toBe(slice.length);
    }
  });
});

describe('project pack', () => {
  it('round-trips project JSON and an independent WAV take', async () => {
    const wav = encodeWavPcm16(new Float32Array([0, 0.25, -0.5, 0.9]), 22050);
    const wavBytes = new Uint8Array(await wav.arrayBuffer());
    const packed = writeZipStore([
      { name: 'project.json', data: new TextEncoder().encode('{"format":"scratchtrack-project"}') },
      { name: 'audio-loop-01.wav', data: wavBytes },
    ]);
    const files = readZipStore(packed);
    expect(files.map((file) => file.name)).toEqual(['project.json', 'audio-loop-01.wav']);
    expect(inspectMediaBytes(files[1]!.data)).toBe('wav');
    expect(new TextDecoder().decode(files[0]!.data)).toContain('scratchtrack-project');
  });
});
