import { audioContext } from './audio';

type CaptureNode = AudioWorkletNode | ScriptProcessorNode;

export class PcmCapture {
  private source: MediaStreamAudioSourceNode;
  private node: CaptureNode;
  private mute: GainNode;
  private chunks: Float32Array[] = [];
  private buffered = 0;
  private dropped = 0;
  private mark = 0;
  readonly sampleRate: number;

  private constructor(
    source: MediaStreamAudioSourceNode,
    node: CaptureNode,
    mute: GainNode,
    sampleRate: number,
  ) {
    this.source = source;
    this.node = node;
    this.mute = mute;
    this.sampleRate = sampleRate;
  }

  static async start(stream: MediaStream): Promise<PcmCapture> {
    const ctx = audioContext();
    const source = ctx.createMediaStreamSource(stream);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    const capture = await PcmCapture.connect(ctx, source, mute);
    return capture;
  }

  private static async connect(ctx: AudioContext, source: MediaStreamAudioSourceNode, mute: GainNode) {
    try {
      const url = `${import.meta.env.BASE_URL}capture-processor.js`;
      try {
        await ctx.audioWorklet.addModule(url);
      } catch {
        // Already registered from an earlier recording session.
      }
      const node = new AudioWorkletNode(ctx, 'scratch-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      const capture = new PcmCapture(source, node, mute, ctx.sampleRate);
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (event.data?.length) capture.push(event.data);
      };
      source.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
      return capture;
    } catch {
      const node = ctx.createScriptProcessor(4096, 1, 1);
      const capture = new PcmCapture(source, node, mute, ctx.sampleRate);
      node.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        if (input.length) capture.push(new Float32Array(input));
      };
      source.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
      return capture;
    }
  }

  private push(chunk: Float32Array) {
    this.chunks.push(chunk);
    this.buffered += chunk.length;
  }

  get capturedSamples() {
    return this.dropped + this.buffered;
  }

  markBoundary() {
    this.mark = this.capturedSamples;
  }

  takeSinceMark() {
    const end = this.capturedSamples;
    const samples = this.extract(this.mark, end);
    this.discardBefore(end);
    this.mark = this.capturedSamples;
    return samples;
  }

  peekSinceMark() {
    return this.extract(this.mark, this.capturedSamples);
  }

  private extract(fromAbs: number, toAbs: number) {
    const length = Math.max(0, toAbs - fromAbs);
    const out = new Float32Array(length);
    if (!length) return out;
    let skip = Math.max(0, fromAbs - this.dropped);
    let offset = 0;
    for (const chunk of this.chunks) {
      if (offset >= length) break;
      if (skip >= chunk.length) {
        skip -= chunk.length;
        continue;
      }
      const start = skip;
      skip = 0;
      const take = Math.min(chunk.length - start, length - offset);
      out.set(chunk.subarray(start, start + take), offset);
      offset += take;
    }
    return out;
  }

  private discardBefore(abs: number) {
    let remaining = Math.max(0, abs - this.dropped);
    while (remaining > 0 && this.chunks.length) {
      const first = this.chunks[0]!;
      if (first.length <= remaining) {
        this.chunks.shift();
        this.dropped += first.length;
        this.buffered -= first.length;
        remaining -= first.length;
      } else {
        this.chunks[0] = first.subarray(remaining);
        this.dropped += remaining;
        this.buffered -= remaining;
        remaining = 0;
      }
    }
  }

  stop() {
    try { this.source.disconnect(); } catch { /* already disconnected */ }
    try { this.node.disconnect(); } catch { /* already disconnected */ }
    try { this.mute.disconnect(); } catch { /* already disconnected */ }
    this.chunks = [];
    this.buffered = 0;
  }
}
