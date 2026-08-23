import { inspectMediaBytes, playbackErrorMessage } from './media';
import type { ChannelSettings, DrumCell, DrumSettings, SynthPatch } from './types';

let context: AudioContext | null = null;

export function audioContext(): AudioContext {
  if (!context) context = new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

/* ------------------------------------------------------------------ */
/* Decoded-buffer cache — avoids re-decoding the same take repeatedly. */
/* ------------------------------------------------------------------ */

const decodedCache = new Map<string, AudioBuffer>();
const DECODE_CACHE_MAX = 32;

function cacheDecode(key: string | undefined, buffer: AudioBuffer) {
  if (!key) return;
  decodedCache.set(key, buffer);
  if (decodedCache.size > DECODE_CACHE_MAX) {
    const oldest = decodedCache.keys().next().value;
    if (oldest !== undefined) decodedCache.delete(oldest);
  }
}

function cachedDecode(key: string | undefined): AudioBuffer | undefined {
  if (!key) return undefined;
  const hit = decodedCache.get(key);
  if (hit) {
    // Refresh recency.
    decodedCache.delete(key);
    decodedCache.set(key, hit);
  }
  return hit;
}

export function dropDecodedAudio(key: string) {
  decodedCache.delete(key);
}

function noiseBuffer(ctx: AudioContext, seconds = 0.2) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function softClipCurve(amount: number, ctx: AudioContext) {
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  const k = 1 + amount * 18;
  for (let i = 0; i < curve.length; i += 1) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  shaper.curve = curve;
  shaper.oversample = '2x';
  return shaper;
}

/* ------------------------------------------------------------------ */
/* Drum kits                                                           */
/* ------------------------------------------------------------------ */

interface VoiceProfile {
  /** Oscillator shape and pitch sweep for kicked drums. */
  kickType: OscillatorType;
  kickStart: number;
  kickEnd: number;
  kickSweep: number;
  kickDecay: number;
  kickClick: number;
  drive?: number;
  snareBody: number;
  snareBodyGain: number;
  snareHighpass: number;
  snareDecay: number;
  snareGain: number;
  hatHighpass: number;
  hatClosedDecay: number;
  hatOpenDecay: number;
  hatGain: number;
}

const KIT_PROFILES: Record<string, VoiceProfile> = {
  Pocket: {
    kickType: 'triangle', kickStart: 150, kickEnd: 38, kickSweep: 0.12, kickDecay: 0.34, kickClick: 0,
    snareBody: 0, snareBodyGain: 0, snareHighpass: 1100, snareDecay: 0.2, snareGain: 0.65,
    hatHighpass: 5600, hatClosedDecay: 0.065, hatOpenDecay: 0.28, hatGain: 0.28,
  },
  Dust: {
    kickType: 'triangle', kickStart: 120, kickEnd: 36, kickSweep: 0.12, kickDecay: 0.24, kickClick: 0,
    snareBody: 0, snareBodyGain: 0, snareHighpass: 700, snareDecay: 0.2, snareGain: 0.65,
    hatHighpass: 4200, hatClosedDecay: 0.065, hatOpenDecay: 0.28, hatGain: 0.28,
  },
  Machine: {
    kickType: 'sine', kickStart: 150, kickEnd: 38, kickSweep: 0.12, kickDecay: 0.34, kickClick: 0,
    snareBody: 0, snareBodyGain: 0, snareHighpass: 1100, snareDecay: 0.12, snareGain: 0.65,
    hatHighpass: 5600, hatClosedDecay: 0.065, hatOpenDecay: 0.28, hatGain: 0.28,
  },
  Club: {
    // Rounded acoustic/electronic club set: controlled transient, real snare body.
    kickType: 'sine', kickStart: 105, kickEnd: 43, kickSweep: 0.09, kickDecay: 0.3, kickClick: 0.1,
    snareBody: 196, snareBodyGain: 0.32, snareHighpass: 1000, snareDecay: 0.19, snareGain: 0.55,
    hatHighpass: 7200, hatClosedDecay: 0.05, hatOpenDecay: 0.33, hatGain: 0.22,
  },
  Modern: {
    // Bass-heavy modern production: sub weight, hard transient, crisp hats.
    kickType: 'sine', kickStart: 82, kickEnd: 33, kickSweep: 0.13, kickDecay: 0.48, kickClick: 0.16, drive: 0.35,
    snareBody: 178, snareBodyGain: 0.38, snareHighpass: 1450, snareDecay: 0.14, snareGain: 0.72,
    hatHighpass: 8200, hatClosedDecay: 0.04, hatOpenDecay: 0.36, hatGain: 0.2,
  },
};

export function drumKitNames(): string[] {
  return Object.keys(KIT_PROFILES);
}

function kitProfile(kit: string): VoiceProfile {
  return KIT_PROFILES[kit] ?? KIT_PROFILES.Pocket!;
}

function drumFallback(): DrumSettings {
  return { swing: 0, humanize: 0, output: 0.88, punch: 0.55, brightness: 0.58 };
}

function kick(velocity: number, profile: VoiceProfile, settings: DrumSettings) {
  const ctx = audioContext();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = profile.kickType;
  const start = profile.kickStart + settings.punch * 45;
  osc.frequency.setValueAtTime(start, now);
  osc.frequency.exponentialRampToValueAtTime(profile.kickEnd + settings.punch * 8, now + profile.kickSweep);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.85 * velocity * settings.output, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + profile.kickDecay);

  let tail: AudioNode = gain;
  if (profile.drive) {
    tail = softClipCurve(profile.drive, ctx);
    gain.connect(tail);
  }
  tail.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + profile.kickDecay + 0.1);

  if (profile.kickClick > 0) {
    const clickSource = ctx.createBufferSource();
    clickSource.buffer = noiseBuffer(ctx, 0.02);
    const clickFilter = ctx.createBiquadFilter();
    clickFilter.type = 'highpass';
    clickFilter.frequency.value = 1800;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(profile.kickClick * velocity * settings.output, now);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
    clickSource.connect(clickFilter).connect(clickGain).connect(ctx.destination);
    clickSource.start(now);
  }
}

function snare(velocity: number, profile: VoiceProfile, settings: DrumSettings) {
  const ctx = audioContext();
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 0.26);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = profile.snareHighpass + settings.brightness * 900;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(profile.snareGain * velocity * settings.output, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + profile.snareDecay);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(now);

  if (profile.snareBody > 0 && profile.snareBodyGain > 0) {
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = profile.snareBody;
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(profile.snareBodyGain * velocity * settings.output, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + profile.snareDecay * 0.7);
    body.connect(bodyGain).connect(ctx.destination);
    body.start(now);
    body.stop(now + profile.snareDecay);
  }
}

function hat(velocity: number, open: boolean, profile: VoiceProfile, settings: DrumSettings) {
  const ctx = audioContext();
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, open ? profile.hatOpenDecay + 0.05 : 0.08);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = profile.hatHighpass + settings.brightness * 2600;
  const gain = ctx.createGain();
  const decay = open ? profile.hatOpenDecay : profile.hatClosedDecay;
  gain.gain.setValueAtTime(profile.hatGain * velocity * settings.output, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(now);
}

/** Fire one sequencer step of a pattern. Rows: Kick, Snare, Hat, Open Hat. */
export function playDrumStep(pattern: DrumCell[][], step: number, kit = 'Pocket', provided?: DrumSettings) {
  const settings = provided ?? drumFallback();
  const profile = kitProfile(kit);
  const values = pattern.map((row) => row[step] ?? 0);
  const human = settings.humanize ? (Math.random() - 0.5) * settings.humanize * 0.18 : 0;
  const velocity = (cell: number, quiet = 0.68) => Math.max(0.28, Math.min(1.15, (cell === 2 ? 1 : quiet) + human));
  if (values[0]) kick(velocity(values[0]), profile, settings);
  if (values[1]) snare(velocity(values[1]), profile, settings);
  if (values[2]) hat(velocity(values[2], 0.65), false, profile, settings);
  if (values[3]) hat(velocity(values[3], 0.72), true, profile, settings);
}

/* ------------------------------------------------------------------ */
/* Synth                                                               */
/* ------------------------------------------------------------------ */

export function midiToFrequency(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function playSynthNote(midi: number, patch: SynthPatch, duration = 0.32) {
  const ctx = audioContext();
  const now = ctx.currentTime;
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();
  const gainA = ctx.createGain();
  const gainB = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const amp = ctx.createGain();
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  const drive = softClipCurve(patch.drive, ctx);
  const frequency = midiToFrequency(midi);

  oscA.type = patch.oscA;
  oscB.type = patch.oscB;
  oscA.frequency.value = frequency;
  oscB.frequency.value = frequency;
  oscB.detune.value = patch.detune;
  gainA.gain.value = Math.max(0.03, 1 - patch.oscMix);
  gainB.gain.value = Math.max(0.03, patch.oscMix);
  filter.type = 'lowpass';
  filter.frequency.value = patch.cutoff;
  filter.Q.value = patch.resonance;

  lfo.frequency.value = patch.lfoRate;
  lfoGain.gain.value = patch.lfoDepth * 520;
  lfo.connect(lfoGain).connect(filter.frequency);

  const peak = 0.32;
  const sustain = Math.max(0.03, Math.min(1, patch.sustain)) * peak;
  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.exponentialRampToValueAtTime(peak, now + Math.max(0.005, patch.attack));
  amp.gain.exponentialRampToValueAtTime(sustain, now + patch.attack + Math.min(0.12, duration * 0.35));
  amp.gain.setValueAtTime(sustain, now + patch.attack + duration);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + patch.attack + duration + patch.release);

  oscA.connect(gainA).connect(filter);
  oscB.connect(gainB).connect(filter);
  filter.connect(drive).connect(amp).connect(ctx.destination);
  oscA.start(now);
  oscB.start(now);
  lfo.start(now);
  const stopAt = now + patch.attack + duration + patch.release + 0.06;
  oscA.stop(stopAt);
  oscB.stop(stopAt);
  lfo.stop(stopAt);
}

/* ------------------------------------------------------------------ */
/* Recorded-audio playback channel                                     */
/* ------------------------------------------------------------------ */

export class AudioPlaybackError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'AudioPlaybackError';
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export async function decodeAudioBlob(blob: Blob, cacheKey?: string): Promise<AudioBuffer> {
  if (!blob || blob.size < 16) {
    throw new AudioPlaybackError(playbackErrorMessage('empty'));
  }
  const cached = cachedDecode(cacheKey);
  if (cached) return cached;
  const header = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const kind = inspectMediaBytes(header, blob.type);
  if (kind === 'empty' || kind === 'fragment') {
    throw new AudioPlaybackError(playbackErrorMessage(kind));
  }
  const ctx = audioContext();
  const bytes = await blob.arrayBuffer();
  try {
    const buffer = await ctx.decodeAudioData(bytes.slice(0));
    cacheDecode(cacheKey, buffer);
    return buffer;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'decode failed';
    throw new AudioPlaybackError(playbackErrorMessage(kind === 'unknown' ? 'unknown' : kind, reason), { cause: error });
  }
}

function compressorStage(ctx: BaseAudioContext, options: CompressorStageOptions) {
  const stage = ctx.createDynamicsCompressor();
  stage.threshold.value = options.threshold;
  stage.knee.value = options.knee;
  stage.ratio.value = options.ratio;
  stage.attack.value = options.attack;
  stage.release.value = options.release;
  return stage;
}

interface CompressorStageOptions {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
}

/**
 * Pure description of the playback compression route so it is testable
 * without a Web Audio context.
 */
export function compressionRouteStages(settings: ChannelSettings): { stages: CompressorStageOptions[]; makeupGain: number } {
  const amount = Math.max(0, Math.min(1, settings.compression));
  if (settings.multiStage) {
    return {
      stages: [
        // Stage 1 — fast peak control catching sharp transients.
        { threshold: -10 - amount * 18, knee: 6, ratio: 2.5 + amount * 2.5, attack: 0.004, release: 0.09 },
        // Stage 2 — slower glue / leveling smoothing overall dynamics.
        { threshold: -16 - amount * 8, knee: 18, ratio: 1.6 + amount * 0.8, attack: 0.03, release: 0.28 },
        // Stage 3 — gentle safety limiter.
        { threshold: -2.5, knee: 2, ratio: 12, attack: 0.001, release: 0.06 },
      ],
      makeupGain: 1 + amount * 0.42,
    };
  }
  return {
    stages: [{ threshold: -8 - amount * 32, knee: 20, ratio: 1 + amount * 9, attack: 0.008, release: 0.18 }],
    makeupGain: 1,
  };
}

function buildCompressionRoute(ctx: AudioContext, settings: ChannelSettings): { input: AudioNode; output: AudioNode } {
  const plan = compressionRouteStages(settings);
  let chain: AudioNode | null = null;
  for (const options of plan.stages) {
    const stage = compressorStage(ctx, options);
    if (chain) chain.connect(stage);
    else chain = stage;
  }
  const makeup = ctx.createGain();
  makeup.gain.value = plan.makeupGain;
  chain!.connect(makeup);
  return { input: chain!, output: makeup };
}

export async function playAudioBlob(
  blob: Blob,
  settings: ChannelSettings,
  offsetSeconds = 0,
  durationSeconds?: number,
  decodeCacheKey?: string,
): Promise<AudioBufferSourceNode> {
  const ctx = audioContext();
  const buffer = await decodeAudioBlob(blob, decodeCacheKey);
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const tone = ctx.createBiquadFilter();
  tone.type = 'peaking';
  tone.frequency.value = 1150;
  tone.Q.value = 0.7;
  tone.gain.value = (settings.tone - 0.5) * 15;

  const compRoute = buildCompressionRoute(ctx, settings);

  const pan = ctx.createStereoPanner();
  pan.pan.value = settings.pan;
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const delay = ctx.createDelay(0.5);
  const feedback = ctx.createGain();
  const output = ctx.createGain();
  const space = Math.max(0, Math.min(1, settings.reverb));

  dry.gain.value = 1 - space * 0.25;
  wet.gain.value = space * 0.32;
  delay.delayTime.value = 0.075 + space * 0.07;
  feedback.gain.value = Math.min(0.48, space * 0.42);
  output.gain.value = settings.volume * (0.55 + settings.inputGain * 0.8);

  source.connect(tone).connect(compRoute.input);
  compRoute.output.connect(pan);
  pan.connect(dry).connect(output);
  pan.connect(delay).connect(wet).connect(output);
  delay.connect(feedback).connect(delay);
  output.connect(ctx.destination);

  const offset = Math.max(0, Math.min(offsetSeconds, Math.max(0, buffer.duration - 0.01)));
  const available = Math.max(0.01, buffer.duration - offset);
  const duration = durationSeconds == null ? available : Math.max(0.01, Math.min(durationSeconds, available));
  source.start(0, offset, duration);
  return source;
}

export function playMetronome(accent = false) {
  const ctx = audioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  osc.type = 'sine';
  osc.frequency.value = accent ? 1320 : 980;
  gain.gain.setValueAtTime(0.09, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.045);
}
