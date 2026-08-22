import { useEffect, useMemo, useState } from 'react';
import { audioContext } from './audio';
import { loadAudioBlob } from './store';
import type { Scratch } from './types';

const PEAK_COUNT = 120;

function durationLabel(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  const wholeMinutes = Math.floor(seconds / 60);
  const remaining = seconds - wholeMinutes * 60;
  return wholeMinutes ? `${wholeMinutes}:${remaining.toFixed(1).padStart(4, '0')}` : `${remaining.toFixed(1)}s`;
}

function samplePeaks(buffer: AudioBuffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const bucketSize = Math.max(1, Math.floor(buffer.length / PEAK_COUNT));
  return Array.from({ length: PEAK_COUNT }, (_, bucket) => {
    const start = bucket * bucketSize;
    const end = Math.min(buffer.length, start + bucketSize);
    const stride = Math.max(1, Math.floor((end - start) / 90));
    let peak = 0;
    for (let sample = start; sample < end; sample += stride) {
      for (const channel of channels) peak = Math.max(peak, Math.abs(channel[sample] ?? 0));
    }
    return Math.min(1, peak);
  });
}

export default function WaveformDisplay({ scratch }: { scratch?: Scratch }) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [status, setStatus] = useState<'empty' | 'loading' | 'ready' | 'error'>('empty');

  useEffect(() => {
    let cancelled = false;
    setPeaks([]);
    if (!scratch?.audioBlobId) {
      setStatus('empty');
      return () => { cancelled = true; };
    }

    setStatus('loading');
    void loadAudioBlob(scratch.audioBlobId)
      .then(async (blob) => {
        if (!blob) throw new Error('Audio is not available in this browser.');
        const buffer = await audioContext().decodeAudioData(await blob.arrayBuffer());
        if (!cancelled) {
          setPeaks(samplePeaks(buffer));
          setStatus('ready');
        }
      })
      .catch(() => { if (!cancelled) setStatus('error'); });

    return () => { cancelled = true; };
  }, [scratch?.audioBlobId]);

  const lines = useMemo(() => peaks.map((peak, index) => {
    const x = (index / Math.max(1, peaks.length - 1)) * 100;
    const height = Math.max(1.2, peak * 15.5);
    return <line key={index} x1={x} x2={x} y1={18 - height} y2={18 + height} />;
  }), [peaks]);

  return (
    <section className="scratch-waveform" aria-label="Selected scratch waveform">
      <div className="waveform-head">
        <div><span>Selected scratch</span><strong>{scratch?.name ?? 'No scratch selected'}</strong></div>
        <span>{durationLabel(scratch?.audioDuration)}</span>
      </div>
      <div className={`waveform-canvas ${status}`}>
        {status === 'ready' ? (
          <svg viewBox="0 0 100 36" preserveAspectRatio="none" role="img" aria-label={`${scratch?.name ?? 'Scratch'} waveform`}>
            <line className="waveform-zero" x1="0" x2="100" y1="18" y2="18" />
            <g>{lines}</g>
          </svg>
        ) : (
          <div className="waveform-placeholder">
            {status === 'loading' ? 'Drawing waveform…' : status === 'error' ? 'Waveform unavailable on this device.' : 'Record or select an audio Scratch to see its waveform.'}
          </div>
        )}
      </div>
    </section>
  );
}
