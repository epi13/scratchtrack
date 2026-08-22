import type { DrumCell, SynthPatch } from './types';

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

function kick(velocity: number, kit: string) {
  const ctx = audioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  osc.type = kit === 'Machine' ? 'sine' : 'triangle';
  osc.frequency.setValueAtTime(kit === 'Dust' ? 120 : 150, now);
  osc.frequency.exponentialRampToValueAtTime(42, now + 0.12);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.85 * velocity, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (kit === 'Dust' ? 0.24 : 0.34));
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.4);
}

function snare(velocity: number, kit: string) {
  const ctx = audioContext();
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, 0.24);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = kit === 'Dust' ? 900 : 1400;
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.65 * velocity, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (kit === 'Machine' ? 0.12 : 0.2));
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(now);
}

function hat(velocity: number, open: boolean, kit: string) {
  const ctx = audioContext();
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, open ? 0.32 : 0.08);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = kit === 'Dust' ? 5200 : 7200;
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  const decay = open ? 0.28 : 0.065;
  gain.gain.setValueAtTime(0.28 * velocity, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(now);
}

export function playDrumStep(pattern: DrumCell[][], step: number, kit = 'Pocket') {
  const values = pattern.map((row) => row[step] ?? 0);
  if (values[0]) kick(values[0] === 2 ? 1 : 0.68, kit);
  if (values[1]) snare(values[1] === 2 ? 1 : 0.68, kit);
  if (values[2]) hat(values[2] === 2 ? 1 : 0.65, false, kit);
  if (values[3]) hat(values[3] === 2 ? 1 : 0.72, true, kit);
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
  const frequency = midiToFrequency(midi);

  oscA.type = patch.oscA;
  oscB.type = patch.oscB;
  oscA.frequency.value = frequency;
  oscB.frequency.value = frequency;
  oscB.detune.value = 7;
  gainA.gain.value = Math.max(0.03, 1 - patch.oscMix);
  gainB.gain.value = Math.max(0.03, patch.oscMix);
  filter.type = 'lowpass';
  filter.frequency.value = patch.cutoff;
  filter.Q.value = 1.1;

  amp.gain.setValueAtTime(0.0001, now);
  amp.gain.exponentialRampToValueAtTime(0.3, now + Math.max(0.005, patch.attack));
  amp.gain.setValueAtTime(0.3, now + patch.attack + duration);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + patch.attack + duration + patch.release);

  oscA.connect(gainA).connect(filter);
  oscB.connect(gainB).connect(filter);
  filter.connect(amp).connect(ctx.destination);
  oscA.start(now);
  oscB.start(now);
  const stopAt = now + patch.attack + duration + patch.release + 0.04;
  oscA.stop(stopAt);
  oscB.stop(stopAt);
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
