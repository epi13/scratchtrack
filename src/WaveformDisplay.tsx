import { useEffect, useMemo, useState } from 'react';
import { AudioPlaybackError, decodeAudioBlob } from './audio';
import { mncsBucketBounds, mncsBucketStride } from './mncsGeometry';
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
  return Array.from({ length: PEAK_COUNT }, (_, bucket) => {
    // Bucket partitioning owned by the MNCS geometry model
    // (`bucket_bounds`, `bucket_stride`); the float peak loop stays host.
    const { start, end } = mncsBucketBounds(buffer.length, bucket, PEAK_COUNT);
    const stride = mncsBucketStride(start, end);
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
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    let cancelled = false;
    setPeaks([]);
    if (!scratch?.audioBlobId) {
      setStatus('empty');
      return () => { cancelled = true; };
    }

    setStatus('loading');
    setErrorText('');
        void loadAudioBlob(scratch.audioBlobId)
          .then(async (blob) => {
            if (!blob) throw new AudioPlaybackError('Audio is not available in this browser.');
            const buffer = await decodeAudioBlob(blob, scratch.audioBlobId);
        if (!cancelled) {
          setPeaks(samplePeaks(buffer));
          setStatus('ready');
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus('error');
        setErrorText(error instanceof Error ? error.message : 'Waveform unavailable on this device.');
      });

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
            {status === 'loading' ? 'Drawing waveform…' : status === 'error' ? (errorText || 'Waveform unavailable on this device.') : 'Record or select an audio Scratch to see its waveform.'}
          </div>
        )}
      </div>
    </section>
  );
}
