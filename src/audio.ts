import type { ChannelSettings, DrumCell, DrumSettings, SynthPatch } from './types';

let context: AudioContext | null = null;

export function audioContext(): AudioContext {
  if (!context) context = new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

function noiseBuffer(ctx: AudioContext, seconds = 0.2) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function softClip(amount: number, ctx: AudioContext) {
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

function drumFallback(): DrumSettings {
  return { swing: 0, humanize: 0, output: 0.88, punch: 0.55, brightness: 0.58 };
}

function kick(velocity: number, kit: string, settings: DrumSettings) {
  const ctx = audioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  osc.type = kit === 'Machine' ? 'sine' : 'triangle';
  const start = (kit === 'Dust' ? 120 : 150) + settings.punch * 65;
  osc.frequency.setValueAtTime(start, now);
  osc.frequency.exponentialRampToValueAtTime(38 + settings.punch * 10, now + 0.12);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.85 * velocity * settings.output, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (kit === 'Dust' ? 0.24 : 0.34));
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.4);
}

function snare(velocity: number, kit: string, settings: DrumSettings) {
  const ctx = audioContext();
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 0.24);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = (kit === 'Dust' ? 700 : 1100) + settings.brightness * 900;
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.65 * velocity * settings.output, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (kit === 'Machine' ? 0.12 : 0.2));
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(now);
}

function hat(velocity: number, open: boolean, kit: string, settings: DrumSettings) {
  const ctx = audioContext();
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, open ? 0.32 : 0.08);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = (kit === 'Dust' ? 4200 : 5600) + settings.brightness * 3200;
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  const decay = open ? 0.28 : 0.065;
  gain.gain.setValueAtTime(0.28 * velocity * settings.output, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(now);
}

export function playDrumStep(pattern: DrumCell[][], step: number, kit = 'Pocket', provided?: DrumSettings) {
  const settings = provided ?? drumFallback();
  const values = pattern.map((row) => row[step] ?? 0);
  const human = settings.humanize ? (Math.random() - 0.5) * settings.humanize * 0.18 : 0;
  const velocity = (cell: number, quiet = 0.68) => Math.max(0.28, Math.min(1.15, (cell === 2 ? 1 : quiet) + human));
  if (values[0]) kick(velocity(values[0]), kit, settings);
  if (values[1]) snare(velocity(values[1]), kit, settings);
  if (values[2]) hat(velocity(values[2], 0.65), false, kit, settings);
  if (values[3]) hat(velocity(values[3], 0.72), true, kit, settings);
}

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
  const drive = softClip(patch.drive, ctx);
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

export async function playAudioBlob(
  blob: Blob,
  settings: ChannelSettings,
  offsetSeconds = 0,
  durationSeconds?: number,
): Promise<AudioBufferSourceNode> {
  const ctx = audioContext();
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const tone = ctx.createBiquadFilter();
  tone.type = 'peaking';
  tone.frequency.value = 1150;
  tone.Q.value = 0.7;
  tone.gain.value = (settings.tone - 0.5) * 15;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -8 - settings.compression * 32;
  compressor.knee.value = 20;
  compressor.ratio.value = 1 + settings.compression * 9;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.18;

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

  source.connect(tone).connect(compressor).connect(pan);
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
