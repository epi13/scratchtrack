import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AudioPlaybackError, dropDecodedAudio, playAudioBlob, playDrumStep, playMetronome, playSynthNote } from './audio';
import { PcmCapture } from './capture';
import {
  connectDrive,
  disconnectDrive,
  DriveAuthError,
  driveFolderWebUrl,
  googleClientId,
  isDriveConfigured,
  isDriveConnected,
  isPickerConfigured,
  loadProjectFromDriveFolder,
  openSharedProjectWithPicker,
  parseDriveFolderLink,
  projectShareUrl,
  sharedProjectIdFromLocation,
  syncProjectToDrive,
} from './drive';
import { encodeWavPcm16 } from './media';
import {
  TICKS_PER_BEAT,
  TOTAL_BEATS,
  VALID_DENOMINATORS,
  barBeats,
  clampBeat,
  formatPosition,
  normalizeTimeSignature,
  parsePosition,
  quantizeBeat,
  stepBeats,
  stepTicks,
  stepsPerBar,
} from './music';
import {
  activeScratch,
  duplicateScratch,
  makeScratch,
  normalizeProject,
} from './project';
import {
  defaultChannelSettings,
  defaultDrumSettings,
  deleteAudioBlob,
  loadAudioBlob,
  loadProject,
  saveAudioBlob,
  saveProject,
} from './store';
import type { Clip, DrumCell, Scratch, ScratchtrackProject, Subdivision, TimeSignature, Track } from './types';
import { MAX_LOOP_TAKES, MAX_SCRATCHES, type RecordMode, type RecordingPhase } from './recording';
import DrumEditor from './components/DrumEditor';
import SynthEditor from './components/SynthEditor';
import AudioEditor from './components/AudioEditor';

type SnapSetting = 'off' | '1/32' | '1/16' | '1/8' | '1/4' | '1/2' | 'bar';

const SNAP_OPTIONS: Array<{ value: SnapSetting; label: string }> = [
  { value: 'off', label: 'Off · free' },
  { value: '1/32', label: '1/32 note' },
  { value: '1/16', label: '1/16 note' },
  { value: '1/8', label: '1/8 note' },
  { value: '1/4', label: 'Beat · 1/4 note' },
  { value: '1/2', label: '2 beats · 1/2 note' },
  { value: 'bar', label: 'Whole bar' },
];

/** Swing delays every second step (binary grids) or the third step (triplet grids). */
function swingApplies(subdivision: Subdivision, step: number): boolean {
  return subdivision.includes('t') ? step % 3 === 2 : step % 2 === 1;
}

function snapStepFor(setting: SnapSetting, meter: TimeSignature): number | null {
  switch (setting) {
    case '1/32': return 0.125;
    case '1/16': return 0.25;
    case '1/8': return 0.5;
    case '1/4': return 1;
    case '1/2': return 2;
    case 'bar': return barBeats(meter);
    default: return null;
  }
}

function scratchName(index: number) {
  if (index < 26) return `Scratch ${String.fromCharCode(65 + index)}`;
  return `Scratch ${index + 1}`;
}

function scratchLengthBeats(track: Track, scratch: Scratch, project: ScratchtrackProject) {
  const bar = barBeats(project.timeSignature);
  if (track.kind === 'drum') return bar;
  if (track.kind === 'synth') {
    const bars = Math.min(8, Math.max(1, Math.round(scratch.motifBars ?? 1)));
    return bars * bar;
  }
  if (scratch.audioDuration) return Math.max(0.25, quantizeBeat((scratch.audioDuration * project.bpm) / 60, 0.25));
  return bar;
}

/** Manually editable Loop In / Out value showing musical bar.beat[.sub] position. */
function LoopPointInput({ label, value, meter, snapStep, onChange }: {
  label: string;
  value: number;
  meter: TimeSignature;
  snapStep: number | null;
  onChange: (beat: number) => void;
}) {
  const [text, setText] = useState(() => formatPosition(value, meter));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(formatPosition(value, meter));
    setInvalid(false);
  }, [value, meter]);

  const commit = () => {
    const parsed = parsePosition(text, meter);
    if (parsed == null) {
      setInvalid(true);
      setText(formatPosition(value, meter));
      return;
    }
    setInvalid(false);
    const clamped = clampBeat(parsed);
    if (Math.abs(clamped - value) > 1e-6) onChange(clamped);
  };

  return (
    <label className={`loop-point ${invalid ? 'invalid' : ''}`}>
      <span>{label}</span>
      <input
        className="loop-point-input"
        value={text}
        inputMode="decimal"
        aria-label={`${label} point as bar.beat`}
        title="bar.beat — press Enter to apply, ↑/↓ steps by the snap resolution"
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
            return;
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const direction = event.key === 'ArrowUp' ? 1 : -1;
            const step = snapStep ?? 0.25;
            const next = clampBeat(Math.round(((value + direction * step) / step)) * step);
            if (next !== value) onChange(next);
          }
        }}
      />
    </label>
  );
}

export default function App() {
  const [project, setProject] = useState<ScratchtrackProject>(() => loadProject());
  const projectRef = useRef(project);
  const [selectedTrackId, setSelectedTrackId] = useState(project.tracks[0].id);
  const [drawerTrackId, setDrawerTrackId] = useState<string | null>(project.tracks[0].id);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<Clip | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadTick, setPlayheadTick] = useState(0);
  const playheadTickRef = useRef(0);
  const playheadBeat = playheadTick / TICKS_PER_BEAT;
  const [metronome, setMetronome] = useState(false);
  const [snapSetting, setSnapSetting] = useState<SnapSetting>(() => {
    const stored = localStorage.getItem('scratchtrack.snapDivision') as SnapSetting | null;
    if (stored && SNAP_OPTIONS.some((option) => option.value === stored)) return stored;
    return localStorage.getItem('scratchtrack.snap') === 'off' ? 'off' : '1/4';
  });
  const [recordingTrackId, setRecordingTrackId] = useState<string | null>(null);
  const recordingTrackRef = useRef<string | null>(null);
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>('idle');
  const [loopTakeCount, setLoopTakeCount] = useState(0);
  const [writeMotif, setWriteMotif] = useState(false);
  const [drivePanelOpen, setDrivePanelOpen] = useState(() => Boolean(sharedProjectIdFromLocation()));
  const [driveStatus, setDriveStatus] = useState<'local' | 'connecting' | 'connected' | 'syncing' | 'synced' | 'error'>('local');
  const [driveMessage, setDriveMessage] = useState('Saved locally');
  const [driveConnected, setDriveConnected] = useState(false);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [invitedFolderId] = useState(() => sharedProjectIdFromLocation());
  const [driveLinkInput, setDriveLinkInput] = useState('');
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const [moveFeedback, setMoveFeedback] = useState<{ startBeat: number; delta: number } | null>(null);
  const [loopDraft, setLoopDraft] = useState<{ startBeat: number; endBeat: number } | null>(null);

  const captureRef = useRef<PcmCapture | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recordModeRef = useRef<RecordMode>('none');
  const loopWarmupRef = useRef(false);
  const loopSavedTakeRef = useRef(0);
  const saveQueueRef = useRef(Promise.resolve());
  const activeAudioRef = useRef<AudioBufferSourceNode[]>([]);
  const playbackErrorRef = useRef<string | null>(null);

  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => { localStorage.setItem('scratchtrack.snapDivision', snapSetting); }, [snapSetting]);

  const selectedTrack = useMemo(
    () => project.tracks.find((track) => track.id === selectedTrackId) ?? project.tracks[0],
    [project.tracks, selectedTrackId],
  );
  const selectedClip = useMemo(() => project.clips.find((clip) => clip.id === selectedClipId) ?? null, [project.clips, selectedClipId]);
  const meter = project.timeSignature;
  const beatsPerBarValue = barBeats(meter);
  const snapStep = useMemo(() => snapStepFor(snapSetting, meter), [meter, snapSetting]);
  const snapMinimum = snapStep ?? 0.01;

  const editBeat = useCallback((value: number) => {
    if (snapStep) return quantizeBeat(value, snapStep);
    return Math.round(value * 100) / 100;
  }, [snapStep]);

  const commitProject = useCallback((mutator: (current: ScratchtrackProject) => ScratchtrackProject) => {
    setProject((current) => {
      const next = mutator(current);
      const stamped = { ...next, updatedAt: new Date().toISOString() };
      projectRef.current = stamped;
      return stamped;
    });
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => saveProject(project), 120);
    return () => window.clearTimeout(id);
  }, [project]);

  const updateTrack = useCallback((trackId: string, mutator: (track: Track) => Track) => {
    commitProject((current) => ({ ...current, tracks: current.tracks.map((track) => track.id === trackId ? mutator(track) : track) }));
  }, [commitProject]);

  const updateScratch = useCallback((trackId: string, scratchId: string, mutator: (scratch: Scratch) => Scratch) => {
    updateTrack(trackId, (track) => ({ ...track, scratches: track.scratches.map((scratch) => scratch.id === scratchId ? mutator(scratch) : scratch) }));
  }, [updateTrack]);

  const stopActiveSources = useCallback(() => {
    activeAudioRef.current.forEach((source) => { try { source.stop(); } catch { /* already stopped */ } });
    activeAudioRef.current = [];
  }, []);

  const reportAudioError = useCallback((error: unknown) => {
    const message = error instanceof AudioPlaybackError || error instanceof Error
      ? error.message
      : 'Playback failed.';
    if (playbackErrorRef.current === message) return;
    playbackErrorRef.current = message;
    setDriveStatus('error');
    setDriveMessage(message);
  }, []);

  /* ---------------------------------------------------------------- */
  /* Scratch workflow: New / Duplicate / Place @ Playhead              */
  /* ---------------------------------------------------------------- */

  const placeScratch = useCallback((trackId: string, scratchId: string, startBeat = playheadTickRef.current / TICKS_PER_BEAT) => {
    const current = projectRef.current;
    const track = current.tracks.find((item) => item.id === trackId);
    const scratch = track?.scratches.find((item) => item.id === scratchId);
    if (!track || !scratch) return;
    const snapped = clampBeat(editBeat(startBeat), TOTAL_BEATS - 0.25);
    const length = scratchLengthBeats(track, scratch, current);
    const clip: Clip = { id: crypto.randomUUID(), trackId, scratchId, startBeat: snapped, lengthBeats: Math.min(length, TOTAL_BEATS - snapped), sourceOffsetBeats: 0 };
    commitProject((projectNow) => ({ ...projectNow, clips: [...projectNow.clips, clip] }));
    setSelectedClipId(clip.id);
  }, [commitProject, editBeat]);

  const activateNewScratch = useCallback((track: Track, fresh: Scratch) => {
    updateTrack(track.id, (current) => ({ ...current, activeScratchId: fresh.id, scratches: [...current.scratches, fresh] }));
    setSelectedTrackId(track.id);
    setDrawerTrackId(track.id);
  }, [updateTrack]);

  /** New Scratch: independent section keeping useful sound configuration only. */
  const createNewScratch = useCallback((track: Track) => {
    if (track.scratches.length >= MAX_SCRATCHES) {
      setDriveStatus('error');
      setDriveMessage(`Scratch limit reached (${MAX_SCRATCHES}). Delete misses before adding more.`);
      return;
    }
    activateNewScratch(track, makeScratch(track));
  }, [activateNewScratch]);

  /** Duplicate Scratch: deliberate deep copy of the current idea. */
  const duplicateActiveScratch = useCallback((track: Track) => {
    const source = activeScratch(track);
    if (!source || track.scratches.length >= MAX_SCRATCHES) return;
    activateNewScratch(track, duplicateScratch(source));
  }, [activateNewScratch]);

  const activeOfSelected = activeScratch(selectedTrack);
  const placeDisabled = selectedTrack.kind === 'audio' || selectedTrack.kind === 'bass'
    ? !(activeOfSelected?.audioBlobId)
    : false;

  const placeActiveAtPlayhead = useCallback(() => {
    const scratch = activeScratch(selectedTrack);
    if (!scratch) return;
    placeScratch(selectedTrack.id, scratch.id);
  }, [placeScratch, selectedTrack]);

  const deleteScratch = useCallback(async (track: Track, scratch: Scratch) => {
    if (scratch.audioBlobId) {
      dropDecodedAudio(scratch.audioBlobId);
      await deleteAudioBlob(scratch.audioBlobId).catch(() => undefined);
    }
    commitProject((current) => ({
      ...current,
      tracks: current.tracks.map((item) => item.id !== track.id ? item : {
        ...item,
        activeScratchId: item.activeScratchId === scratch.id ? item.scratches.find((s) => s.id !== scratch.id)?.id : item.activeScratchId,
        scratches: item.scratches.filter((s) => s.id !== scratch.id),
      }),
      clips: current.clips.filter((clip) => clip.scratchId !== scratch.id),
    }));
    setSelectedClipId((id) => projectRef.current.clips.some((clip) => clip.id === id) ? id : null);
  }, [commitProject]);

  /* ---------------------------------------------------------------- */
  /* Editing                                                           */
  /* ---------------------------------------------------------------- */

  const auditionScratch = useCallback(async (track: Track, scratch: Scratch) => {
    const current = projectRef.current;
    if (track.kind === 'drum' && scratch.drumPattern) {
      const subdivision = scratch.drumSubdivision ?? '1/16';
      const steps = stepsPerBar(current.timeSignature, subdivision) ?? 16;
      const msPerStep = (60_000 / current.bpm) * stepBeats(subdivision);
      let step = 0;
      playDrumStep(scratch.drumPattern, 0, scratch.drumKit, scratch.drumSettings);
      const timer = window.setInterval(() => {
        step += 1;
        if (step >= steps) return window.clearInterval(timer);
        const settings = scratch.drumSettings ?? defaultDrumSettings;
        const swingDelay = swingApplies(subdivision, step) ? msPerStep * 0.48 * settings.swing : 0;
        window.setTimeout(() => playDrumStep(scratch.drumPattern!, step, scratch.drumKit, settings), swingDelay);
      }, msPerStep);
      return;
    }
    if (track.kind === 'synth' && scratch.synthPatch) {
      for (const note of scratch.synthNotes ?? []) {
        window.setTimeout(() => playSynthNote(note.midi, scratch.synthPatch!, (60 / current.bpm) * note.lengthBeats * 0.9), (60_000 / current.bpm) * note.startBeat);
      }
      return;
    }
    if (scratch.audioBlobId) {
      try {
        const blob = await loadAudioBlob(scratch.audioBlobId);
        if (!blob) throw new AudioPlaybackError('This Scratch has no audio in this browser.');
        const source = await playAudioBlob(blob, track.settings ?? defaultChannelSettings, 0, undefined, scratch.audioBlobId);
        activeAudioRef.current.push(source);
        source.onended = () => { activeAudioRef.current = activeAudioRef.current.filter((item) => item !== source); };
      } catch (error) {
        reportAudioError(error);
      }
    }
  }, [reportAudioError]);

  const moveClip = useCallback((clipId: string, startBeat: number) => {
    commitProject((current) => ({
      ...current,
      clips: current.clips.map((clip) => clip.id === clipId
        ? { ...clip, startBeat: clampBeat(editBeat(startBeat), TOTAL_BEATS - clip.lengthBeats) }
        : clip),
    }));
  }, [commitProject, editBeat]);

  const resizeClip = useCallback((clipId: string, desiredLength: number) => {
    const current = projectRef.current;
    const clip = current.clips.find((item) => item.id === clipId);
    if (!clip) return;
    const track = current.tracks.find((item) => item.id === clip.trackId);
    const scratch = track?.scratches.find((item) => item.id === clip.scratchId);
    if (!track || !scratch) return;
    let maxLength = TOTAL_BEATS - clip.startBeat;
    if (track.kind === 'audio' || track.kind === 'bass') maxLength = Math.min(maxLength, scratchLengthBeats(track, scratch, current) - (clip.sourceOffsetBeats ?? 0));
    const lengthBeats = Math.max(snapMinimum, Math.min(maxLength, editBeat(desiredLength)));
    commitProject((projectNow) => ({ ...projectNow, clips: projectNow.clips.map((item) => item.id === clipId ? { ...item, lengthBeats } : item) }));
  }, [commitProject, editBeat, snapMinimum]);

  const splitSelectedClip = useCallback(() => {
    const current = projectRef.current;
    const clip = current.clips.find((item) => item.id === selectedClipId);
    const split = editBeat(playheadTickRef.current / TICKS_PER_BEAT);
    if (!clip || split <= clip.startBeat || split >= clip.startBeat + clip.lengthBeats) return;
    const leftLength = split - clip.startBeat;
    const right: Clip = {
      ...clip,
      id: crypto.randomUUID(),
      startBeat: split,
      lengthBeats: clip.lengthBeats - leftLength,
      sourceOffsetBeats: (clip.sourceOffsetBeats ?? 0) + leftLength,
    };
    commitProject((projectNow) => ({
      ...projectNow,
      clips: [...projectNow.clips.map((item) => item.id === clip.id ? { ...item, lengthBeats: leftLength } : item), right],
    }));
    setSelectedClipId(right.id);
  }, [commitProject, editBeat, selectedClipId]);

  const copySelectedClip = useCallback(() => {
    const clip = projectRef.current.clips.find((item) => item.id === selectedClipId);
    if (clip) setClipboard({ ...clip });
  }, [selectedClipId]);

  const pasteClip = useCallback(() => {
    if (!clipboard) return;
    const startBeat = clampBeat(editBeat(playheadTickRef.current / TICKS_PER_BEAT), TOTAL_BEATS - clipboard.lengthBeats);
    const clip = { ...clipboard, id: crypto.randomUUID(), startBeat };
    commitProject((current) => ({ ...current, clips: [...current.clips, clip] }));
    setSelectedClipId(clip.id);
    setSelectedTrackId(clip.trackId);
  }, [clipboard, commitProject, editBeat]);

  const duplicateSelectedClip = useCallback(() => {
    const clip = projectRef.current.clips.find((item) => item.id === selectedClipId);
    if (!clip) return;
    const nextStart = clampBeat(editBeat(clip.startBeat + clip.lengthBeats), TOTAL_BEATS - clip.lengthBeats);
    const duplicate = { ...clip, id: crypto.randomUUID(), startBeat: nextStart };
    commitProject((current) => ({ ...current, clips: [...current.clips, duplicate] }));
    setSelectedClipId(duplicate.id);
  }, [commitProject, editBeat, selectedClipId]);

  const deleteSelectedClip = useCallback(() => {
    if (!selectedClipId) return;
    commitProject((current) => ({ ...current, clips: current.clips.filter((item) => item.id !== selectedClipId) }));
    setSelectedClipId(null);
  }, [commitProject, selectedClipId]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select')) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelectedClip(); }
      if (command && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteClip(); }
      if (command && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelectedClip(); }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelectedClip(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [copySelectedClip, deleteSelectedClip, duplicateSelectedClip, pasteClip]);

  /* ---------------------------------------------------------------- */
  /* Transport — fixed 1/24-beat tick grid so every meter/subdivision   */
  /* (quarters, eighths, triplets, 1/32s) lands exactly on a tick.     */
  /* ---------------------------------------------------------------- */

  const fireTick = useCallback((tick: number) => {
    const current = projectRef.current;
    const barTicksValue = Math.round(barBeats(current.timeSignature) * TICKS_PER_BEAT);
    if (metronome && barTicksValue > 0) {
      const posInBar = ((tick % barTicksValue) + barTicksValue) % barTicksValue;
      if (posInBar % 6 === 0) playMetronome(posInBar === 0);
    }
    const anySolo = current.tracks.some((track) => track.solo);
    for (const track of current.tracks) {
      if (track.muted || (anySolo && !track.solo)) continue;
      for (const clip of current.clips) {
        if (clip.trackId !== track.id) continue;
        const clipStartTick = Math.round(clip.startBeat * TICKS_PER_BEAT);
        const clipLengthTicks = Math.max(1, Math.round(clip.lengthBeats * TICKS_PER_BEAT));
        const localTick = tick - clipStartTick;
        if (localTick < 0 || localTick >= clipLengthTicks) continue;
        const scratch = track.scratches.find((item) => item.id === clip.scratchId);
        if (!scratch) continue;
        const sourceTick = Math.round((clip.sourceOffsetBeats ?? 0) * TICKS_PER_BEAT) + localTick;

        if (track.kind === 'drum' && scratch.drumPattern) {
          const subdivision = scratch.drumSubdivision ?? '1/16';
          const steps = stepsPerBar(current.timeSignature, subdivision);
          if (!steps) continue;
          const stepLengthTicks = stepTicks(subdivision);
          const patternTicks = steps * stepLengthTicks;
          const position = ((sourceTick % patternTicks) + patternTicks) % patternTicks;
          if (position % stepLengthTicks !== 0) continue;
          const stepIndex = position / stepLengthTicks;
          const settings = scratch.drumSettings ?? defaultDrumSettings;
          const secondsPerStep = (60 / current.bpm) * stepBeats(subdivision);
          const swingDelay = swingApplies(subdivision, stepIndex) ? secondsPerStep * 480 * settings.swing : 0;
          const humanDelay = settings.humanize * Math.random() * 13;
          window.setTimeout(() => playDrumStep(scratch.drumPattern!, stepIndex, scratch.drumKit, settings), swingDelay + humanDelay);
        } else if (track.kind === 'synth' && scratch.synthPatch) {
          const motifBars = Math.min(8, Math.max(1, Math.round(scratch.motifBars ?? 1)));
          const motifTicks = Math.max(1, Math.round(motifBars * barBeats(current.timeSignature) * TICKS_PER_BEAT));
          const position = ((sourceTick % motifTicks) + motifTicks) % motifTicks;
          for (const note of scratch.synthNotes ?? []) {
            const noteTick = Math.round(note.startBeat * TICKS_PER_BEAT) % motifTicks;
            if (noteTick === position) {
              playSynthNote(note.midi, scratch.synthPatch, (60 / current.bpm) * note.lengthBeats * 0.9);
            }
          }
        } else if (scratch.audioBlobId && localTick === 0) {
          void loadAudioBlob(scratch.audioBlobId).then(async (blob) => {
            if (!blob) throw new AudioPlaybackError(`${scratch.name} has no audio in this browser.`);
            const offsetSeconds = ((clip.sourceOffsetBeats ?? 0) * 60) / current.bpm;
            const durationSeconds = (clip.lengthBeats * 60) / current.bpm;
            const source = await playAudioBlob(blob, track.settings ?? defaultChannelSettings, offsetSeconds, durationSeconds, scratch.audioBlobId);
            activeAudioRef.current.push(source);
            source.onended = () => { activeAudioRef.current = activeAudioRef.current.filter((item) => item !== source); };
          }).catch(reportAudioError);
        }
      }
    }
  }, [metronome, reportAudioError]);

  const cleanupRecordingSession = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    recorderStreamRef.current?.getTracks().forEach((mediaTrack) => mediaTrack.stop());
    recorderStreamRef.current = null;
    recordingTrackRef.current = null;
    recordModeRef.current = 'none';
    loopWarmupRef.current = false;
    setRecordingTrackId(null);
    setRecordingPhase('idle');
  }, []);

  const saveRecordedTake = useCallback(async (trackId: string, blob: Blob, durationSeconds: number, loopTake: boolean, takeNumber?: number) => {
    const current = projectRef.current;
    const track = current.tracks.find((item) => item.id === trackId);
    if (!track) return false;
    if (!loopTake && track.scratches.length >= MAX_SCRATCHES) {
      setDriveStatus('error');
      setDriveMessage(`Scratch limit reached (${MAX_SCRATCHES}). Delete bad takes before recording more.`);
      return false;
    }
    const blobId = crypto.randomUUID();
    await saveAudioBlob(blobId, blob);

    if (!loopTake) {
      // Fill the selected blank recording slot instead of stacking another Scratch.
      const blank = activeScratch(track);
      if (blank && !blank.audioBlobId) {
        playbackErrorRef.current = null;
        updateTrack(track.id, (freshTrack) => ({
          ...freshTrack,
          scratches: freshTrack.scratches.map((item) => item.id === blank.id
            ? { ...item, audioBlobId: blobId, audioMimeType: blob.type || 'audio/wav', audioDuration: durationSeconds }
            : item),
        }));
        setDrawerTrackId(track.id);
        return true;
      }
    }

    if (track.scratches.length >= MAX_SCRATCHES) {
      setDriveStatus('error');
      setDriveMessage(`Scratch limit reached (${MAX_SCRATCHES}).`);
      return false;
    }
    const name = loopTake && takeNumber ? `Loop ${String(takeNumber).padStart(2, '0')}` : scratchName(track.scratches.length);
    const scratch: Scratch = {
      id: crypto.randomUUID(),
      name,
      note: loopTake ? 'Auto Scratch loop take' : 'Recorded with arrangement playback',
      createdAt: new Date().toISOString(),
      audioBlobId: blobId,
      audioMimeType: blob.type || 'audio/wav',
      audioDuration: durationSeconds,
    };
    playbackErrorRef.current = null;
    updateTrack(track.id, (freshTrack) => ({ ...freshTrack, activeScratchId: scratch.id, scratches: [...freshTrack.scratches, scratch] }));
    setDrawerTrackId(track.id);
    return true;
  }, [updateTrack]);

  const enqueueSaveTake = useCallback((trackId: string, samples: Float32Array, sampleRate: number, loopTake: boolean, takeNumber?: number) => {
    if (samples.length < Math.floor(sampleRate * 0.05)) return Promise.resolve(false);
    const blob = encodeWavPcm16(samples, sampleRate);
    const durationSeconds = samples.length / sampleRate;
    const task = saveQueueRef.current.then(() => saveRecordedTake(trackId, blob, durationSeconds, loopTake, takeNumber));
    saveQueueRef.current = task.then(() => undefined, () => undefined);
    return task;
  }, [saveRecordedTake]);

  const finishRecordingSession = useCallback((saveTrailing: boolean) => {
    const trackId = recordingTrackRef.current;
    const capture = captureRef.current;
    const mode = recordModeRef.current;
    const wasWarmup = loopWarmupRef.current;
    loopWarmupRef.current = false;
    if (!saveTrailing || wasWarmup || !trackId || !capture || mode === 'none') {
      cleanupRecordingSession();
      return;
    }
    if (mode === 'loop-auto') {
      if (loopSavedTakeRef.current < MAX_LOOP_TAKES) {
        const samples = capture.peekSinceMark();
        if (samples.length >= capture.sampleRate * 0.25) {
          const takeNumber = loopSavedTakeRef.current + 1;
          loopSavedTakeRef.current = takeNumber;
          setLoopTakeCount(takeNumber);
          void enqueueSaveTake(trackId, capture.takeSinceMark(), capture.sampleRate, true, takeNumber).finally(cleanupRecordingSession);
          return;
        }
      }
      cleanupRecordingSession();
      return;
    }
    const samples = capture.takeSinceMark();
    void enqueueSaveTake(trackId, samples, capture.sampleRate, false).finally(cleanupRecordingSession);
  }, [cleanupRecordingSession, enqueueSaveTake]);

  const stopRecordingSession = useCallback(() => {
    finishRecordingSession(true);
  }, [finishRecordingSession]);

  const beginPostWarmupCapture = useCallback(() => {
    const capture = captureRef.current;
    if (!capture) return;
    capture.markBoundary();
    if (recordModeRef.current === 'loop-auto') setRecordingPhase('auto');
    else setRecordingPhase('recording');
  }, []);

  const captureAutoTake = useCallback(() => {
    const trackId = recordingTrackRef.current;
    const capture = captureRef.current;
    if (!trackId || !capture || loopSavedTakeRef.current >= MAX_LOOP_TAKES) return;
    const samples = capture.takeSinceMark();
    const takeNumber = loopSavedTakeRef.current + 1;
    loopSavedTakeRef.current = takeNumber;
    setLoopTakeCount(takeNumber);
    void enqueueSaveTake(trackId, samples, capture.sampleRate, true, takeNumber);
    if (takeNumber >= MAX_LOOP_TAKES) {
      setDriveMessage(`${MAX_LOOP_TAKES} loop Scratches captured · recording stopped`);
      capture.stop();
      captureRef.current = null;
      recorderStreamRef.current?.getTracks().forEach((mediaTrack) => mediaTrack.stop());
      recorderStreamRef.current = null;
      recordingTrackRef.current = null;
      recordModeRef.current = 'none';
      setRecordingTrackId(null);
      setRecordingPhase('idle');
    }
  }, [enqueueSaveTake]);

  const toggleRecording = useCallback(async (track: Track) => {
    if (recordingTrackRef.current === track.id) {
      stopRecordingSession();
      return;
    }
    if (recordingTrackRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      stopActiveSources();
      const capture = await PcmCapture.start(stream);
      captureRef.current = capture;
      recorderStreamRef.current = stream;
      recordingTrackRef.current = track.id;
      setRecordingTrackId(track.id);
      setLoopTakeCount(0);
      loopSavedTakeRef.current = 0;
      const current = projectRef.current;

      if (current.loop.enabled) {
        recordModeRef.current = current.loop.autoScratch ? 'loop-auto' : 'loop-single';
        loopWarmupRef.current = true;
        playheadTickRef.current = Math.round(current.loop.startBeat * TICKS_PER_BEAT);
        setPlayheadTick(playheadTickRef.current);
        setRecordingPhase('warmup');
        setDriveStatus('local');
        setDriveMessage('Warm-up pass · playback only, nothing recorded yet');
        setIsPlaying(true);
        return;
      }

      recordModeRef.current = 'single';
      capture.markBoundary();
      setRecordingPhase('recording');
      setDriveStatus('local');
      setDriveMessage(activeScratch(track) && !activeScratch(track)?.audioBlobId
        ? `Filling blank Scratch “${activeScratch(track)!.name}”`
        : 'Recording with arrangement playback');
      setIsPlaying(true);
    } catch (error) {
      cleanupRecordingSession();
      setDriveMessage(error instanceof Error ? error.message : 'Microphone permission failed.');
      setDriveStatus('error');
    }
  }, [cleanupRecordingSession, stopActiveSources, stopRecordingSession]);

  useEffect(() => {
    if (!isPlaying) return;
    const intervalMs = Math.max(8, (60_000 / project.bpm) / TICKS_PER_BEAT);
    fireTick(playheadTickRef.current);
    const timer = window.setInterval(() => {
      const current = projectRef.current;
      const loop = current.loop;
      const startTick = Math.round(loop.startBeat * TICKS_PER_BEAT);
      const endTick = Math.round(loop.endBeat * TICKS_PER_BEAT);
      const maxTick = Math.round(TOTAL_BEATS * TICKS_PER_BEAT);
      let next = playheadTickRef.current + 1;
      const reachedLoopEnd = loop.enabled && next >= endTick && playheadTickRef.current < endTick;

      if (reachedLoopEnd) {
        if (recordingTrackRef.current && (recordModeRef.current === 'loop-auto' || recordModeRef.current === 'loop-single')) {
          if (loopWarmupRef.current) {
            loopWarmupRef.current = false;
            beginPostWarmupCapture();
            setDriveMessage(recordModeRef.current === 'loop-auto' ? `Auto Scratch · capturing pass 1/${MAX_LOOP_TAKES}` : 'Warm-up complete · recording');
          } else if (recordModeRef.current === 'loop-auto' && captureRef.current) {
            const nextTake = loopSavedTakeRef.current + 1;
            captureAutoTake();
            if (nextTake < MAX_LOOP_TAKES) {
              setDriveMessage(`Auto Scratch · capturing pass ${nextTake + 1}/${MAX_LOOP_TAKES}`);
            }
          }
        }
        stopActiveSources();
        next = startTick;
      } else if (next >= maxTick) {
        stopActiveSources();
        next = loop.enabled ? startTick : 0;
      }
      playheadTickRef.current = next;
      setPlayheadTick(next);
      fireTick(next);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [beginPostWarmupCapture, captureAutoTake, fireTick, isPlaying, project.bpm, stopActiveSources]);

  const toggleTransport = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      stopActiveSources();
      if (recordingTrackRef.current) stopRecordingSession();
      return;
    }
    setIsPlaying(true);
  }, [isPlaying, stopActiveSources, stopRecordingSession]);

  const stopTransport = useCallback(() => {
    setIsPlaying(false);
    stopActiveSources();
    if (recordingTrackRef.current) stopRecordingSession();
    const current = projectRef.current;
    const next = current.loop.enabled ? current.loop.startBeat : 0;
    playheadTickRef.current = Math.round(next * TICKS_PER_BEAT);
    setPlayheadTick(playheadTickRef.current);
  }, [stopActiveSources, stopRecordingSession]);

  /* ---------------------------------------------------------------- */
  /* Time signature                                                    */
  /* ---------------------------------------------------------------- */

  const changeTimeSignature = useCallback((numerator: number, denominator: TimeSignature['denominator']) => {
    commitProject((current) => {
      const previousMeter = current.timeSignature;
      const nextMeter = normalizeTimeSignature({ numerator, denominator });
      if (previousMeter.numerator === nextMeter.numerator && previousMeter.denominator === nextMeter.denominator) return current;
      const tracks = current.tracks.map((track) => ({
        ...track,
        scratches: track.scratches.map((scratch) => {
          if (!scratch.drumPattern) return scratch;
          const subdivision = scratch.drumSubdivision ?? '1/16';
          const fromSteps = scratch.drumPattern[0]?.length ?? stepsPerBar(previousMeter, subdivision) ?? 16;
          const toSteps = stepsPerBar(nextMeter, subdivision) ?? 16;
          if (fromSteps === toSteps) return scratch;
          const drumPattern = scratch.drumPattern.map((row) => {
            const targetRow = Array.from({ length: toSteps }, () => 0 as DrumCell);
            row.forEach((cell, index) => {
              if (!cell) return;
              const position = (index / fromSteps) * toSteps;
              const mapped = Math.min(toSteps - 1, Math.max(0, Math.floor(position + 0.5)));
              targetRow[mapped] = Math.max(targetRow[mapped], cell) as DrumCell;
            });
            return targetRow;
          });
          return { ...scratch, drumPattern };
        }),
      }));
      return { ...current, timeSignature: nextMeter, tracks };
    });
  }, [commitProject]);

  /* ---------------------------------------------------------------- */
  /* Loop points                                                       */
  /* ---------------------------------------------------------------- */

  const setLoopPoint = useCallback((which: 'in' | 'out', beat: number) => {
    commitProject((current) => {
      if (which === 'in') {
        const point = clampBeat(beat, TOTAL_BEATS - 0.05);
        return { ...current, loop: { ...current.loop, startBeat: Math.min(point, current.loop.endBeat - 0.05) } };
      }
      const point = Math.max(0.05, clampBeat(beat));
      return { ...current, loop: { ...current.loop, endBeat: Math.max(point, current.loop.startBeat + 0.05) } };
    });
  }, [commitProject]);

  const setLoopIn = useCallback(() => setLoopPoint('in', editBeat(playheadTickRef.current / TICKS_PER_BEAT)), [editBeat, setLoopPoint]);
  const setLoopOut = useCallback(() => setLoopPoint('out', editBeat(playheadTickRef.current / TICKS_PER_BEAT)), [editBeat, setLoopPoint]);

  const setPlayheadBeat = useCallback((beat: number) => {
    const tick = Math.round(clampBeat(beat) * TICKS_PER_BEAT);
    playheadTickRef.current = tick;
    setPlayheadTick(tick);
  }, []);

  const handleRulerPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerToBeat = (clientX: number) => clampBeat(editBeat(((clientX - rect.left) / rect.width) * TOTAL_BEATS));
    const startBeat = pointerToBeat(event.clientX);
    const startX = event.clientX;
    let endBeat = startBeat;
    let moved = false;
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      endBeat = pointerToBeat(pointer.clientX);
      if (Math.abs(pointer.clientX - startX) > 6) moved = true;
      if (moved) {
        const a = Math.min(startBeat, endBeat);
        const b = Math.max(startBeat, endBeat);
        setLoopDraft({ startBeat: a, endBeat: Math.max(a + snapMinimum, b) });
      }
    };
    const up = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (moved) {
        const start = Math.min(startBeat, endBeat);
        const end = Math.min(TOTAL_BEATS, Math.max(start + snapMinimum, Math.max(startBeat, endBeat)));
        commitProject((current) => ({ ...current, loop: { ...current.loop, enabled: true, startBeat: start, endBeat: end } }));
        setPlayheadBeat(start);
      } else {
        setPlayheadBeat(startBeat);
      }
      setLoopDraft(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
  }, [commitProject, editBeat, setPlayheadBeat, snapMinimum]);

  const handleScratchDrag = useCallback((event: ReactPointerEvent<HTMLElement>, track: Track, scratch: Scratch) => {
    event.preventDefault();
    event.stopPropagation();
    setDragGhost({ x: event.clientX, y: event.clientY, label: scratch.name });
    const move = (pointer: PointerEvent) => setDragGhost({ x: pointer.clientX, y: pointer.clientY, label: scratch.name });
    const up = (pointer: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const element = document.elementFromPoint(pointer.clientX, pointer.clientY) as HTMLElement | null;
      const lane = element?.closest<HTMLElement>('.timeline-lane');
      if (lane?.dataset.trackId === track.id) {
        const rect = lane.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (pointer.clientX - rect.left) / rect.width));
        placeScratch(track.id, scratch.id, ratio * TOTAL_BEATS);
      }
      setDragGhost(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }, [placeScratch]);

  const handleClipMove = useCallback((event: ReactPointerEvent<HTMLElement>, clip: Clip, label: string) => {
    if ((event.target as HTMLElement).closest('.clip-resize')) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const lane = event.currentTarget.closest('.timeline-lane') as HTMLElement | null;
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    const original = clip.startBeat;
    setSelectedClipId(clip.id);
    setSelectedTrackId(clip.trackId);
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      const deltaBeats = ((pointer.clientX - startX) / rect.width) * TOTAL_BEATS;
      const next = clampBeat(editBeat(original + deltaBeats), TOTAL_BEATS - clip.lengthBeats);
      moveClip(clip.id, next);
      const delta = next - original;
      setMoveFeedback({ startBeat: next, delta });
      setDragGhost({
        x: pointer.clientX,
        y: pointer.clientY,
        label: `${label} · ${formatPosition(next, projectRef.current.timeSignature)} · ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}b`,
      });
    };
    const up = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDragGhost(null);
      window.setTimeout(() => setMoveFeedback(null), 850);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
  }, [editBeat, moveClip]);

  const handleClipResize = useCallback((event: ReactPointerEvent<HTMLElement>, clip: Clip) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedClipId(clip.id);
    const lane = event.currentTarget.closest('.timeline-lane') as HTMLElement | null;
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      const pointerBeat = Math.max(clip.startBeat + snapMinimum, Math.min(TOTAL_BEATS, ((pointer.clientX - rect.left) / rect.width) * TOTAL_BEATS));
      resizeClip(clip.id, pointerBeat - clip.startBeat);
    };
    const up = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
  }, [resizeClip, snapMinimum]);

  /* ---------------------------------------------------------------- */
  /* Import/export + Drive                                             */
  /* ---------------------------------------------------------------- */

  const exportProject = useCallback(() => {
    const blob = new Blob([JSON.stringify(projectRef.current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${projectRef.current.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'scratchtrack'}.scratchtrack.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const resetTransientState = useCallback((next: ScratchtrackProject) => {
    setSelectedTrackId(next.tracks[0].id);
    setDrawerTrackId(next.tracks[0].id);
    setSelectedClipId(null);
    playheadTickRef.current = 0;
    setPlayheadTick(0);
  }, []);

  const importProject = useCallback((file: File) => {
    void file.text().then((text) => {
      const next = normalizeProject(JSON.parse(text));
      setProject(next);
      projectRef.current = next;
      resetTransientState(next);
    }).catch((error) => {
      setDriveStatus('error');
      setDriveMessage(error instanceof Error ? error.message : 'Could not import project.');
    });
  }, [resetTransientState]);

  const applyRemoteProject = useCallback(async (remote: ScratchtrackProject, folderId?: string) => {
    const next = normalizeProject({
      ...remote,
      drive: {
        ...remote.drive,
        projectFolderId: folderId ?? remote.drive?.projectFolderId,
      },
    });
    setProject(next);
    projectRef.current = next;
    saveProject(next);
    resetTransientState(next);
  }, [resetTransientState]);

  const handleDriveError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Google Drive failed.';
    setDriveStatus('error');
    setDriveMessage(message);
    if (error instanceof DriveAuthError) setDriveConnected(false);
  }, []);

  const connectGoogle = useCallback(async () => {
    if (!isDriveConfigured()) {
      setDrivePanelOpen(true);
      setDriveStatus('error');
      setDriveMessage('This site still needs a one-time Google setup by the owner.');
      return;
    }
    try {
      setDriveStatus('connecting');
      setDriveMessage('Connecting Google Drive…');
      await connectDrive(true);
      setDriveConnected(true);
      setDriveStatus('connected');
      setDriveMessage('Google Drive connected');
    } catch (error) {
      handleDriveError(error);
    }
  }, [handleDriveError]);

  const syncDrive = useCallback(async () => {
    if (!isDriveConfigured()) {
      setDrivePanelOpen(true);
      setDriveStatus('error');
      setDriveMessage('This site still needs a one-time Google setup by the owner.');
      return;
    }
    try {
      if (!isDriveConnected()) {
        setDriveStatus('connecting');
        setDriveMessage('Connecting Google Drive…');
        await connectDrive(true);
        setDriveConnected(true);
      }
      setDriveStatus('syncing');
      setDriveMessage('Saving project to Google Drive…');
      const result = await syncProjectToDrive(projectRef.current, loadAudioBlob);
      const now = new Date().toISOString();
      commitProject((current) => ({ ...current, drive: { ...current.drive, ...result, lastSyncedAt: now } }));
      setDriveStatus('synced');
      setDriveMessage(`Saved to Drive · ${result.uploadedAudio} audio file${result.uploadedAudio === 1 ? '' : 's'}`);
    } catch (error) {
      handleDriveError(error);
    }
  }, [commitProject, handleDriveError]);

  const openSharedProject = useCallback(async (folderId?: string) => {
    if (!isDriveConfigured()) {
      setDrivePanelOpen(true);
      setDriveStatus('error');
      setDriveMessage('This site still needs a one-time Google setup by the owner.');
      return;
    }
    try {
      if (!isDriveConnected()) {
        setDriveStatus('connecting');
        setDriveMessage('Connecting Google Drive…');
        await connectDrive(true);
        setDriveConnected(true);
      }
      setDriveStatus('syncing');
      setDriveMessage(folderId ? 'Opening Drive folder…' : 'Opening shared project…');
      if (folderId) {
        const remote = await loadProjectFromDriveFolder(folderId, saveAudioBlob);
        await applyRemoteProject(remote, folderId);
      } else {
        const opened = await openSharedProjectWithPicker(saveAudioBlob);
        await applyRemoteProject(opened.project, opened.folderId);
      }
      setDriveStatus('synced');
      setDriveMessage('Opened shared Scratchtrack project');
    } catch (error) {
      handleDriveError(error);
      if (folderId) {
        setDriveStatus('error');
        setDriveMessage(`${error instanceof Error ? error.message : 'Could not open that folder.'} Google may require one-time permission for this app: click “Open shared project” and select the folder in the picker once.`);
      }
    }
  }, [applyRemoteProject, handleDriveError]);

  const openDriveLink = useCallback(async (raw: string) => {
    const folderId = parseDriveFolderLink(raw);
    if (!folderId) {
      setDrivePanelOpen(true);
      setDriveStatus('error');
      setDriveMessage('That does not look like a Google Drive folder link (or a folder ID). Paste the share link Google Drive gives you.');
      return;
    }
    await openSharedProject(folderId);
  }, [openSharedProject]);

  const shareProject = useCallback(async () => {
    try {
      let folderId = projectRef.current.drive?.projectFolderId;
      if (!folderId) {
        await syncDrive();
        folderId = projectRef.current.drive?.projectFolderId;
      }
      if (!folderId) throw new Error('Save the project to Google Drive before sharing it.');
      const link = projectShareUrl(folderId);
      await navigator.clipboard.writeText(link);
      setShareLinkCopied(true);
      window.setTimeout(() => setShareLinkCopied(false), 2500);
      window.open(driveFolderWebUrl(folderId), '_blank', 'noopener,noreferrer');
      setDriveStatus('connected');
      setDriveMessage('Share link copied · share the Drive folder with your collaborator');
    } catch (error) {
      handleDriveError(error);
    }
  }, [handleDriveError, syncDrive]);

  const visibleLoop = loopDraft ?? project.loop;
  const barCount = Math.ceil(TOTAL_BEATS / beatsPerBarValue);
  const barPercent = (beatsPerBarValue / TOTAL_BEATS) * 100;
  const numeratorOptions = Array.from({ length: 32 }, (_, index) => index + 1);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Scratchtrack home"><span className="brand-mark">S/</span><span>Scratchtrack</span></div>
        <input className="project-title" value={project.title} aria-label="Project title" onChange={(event) => commitProject((current) => ({ ...current, title: event.target.value }))} />
        <div className="topbar-actions">
          <span className={`save-state ${driveStatus === 'error' ? 'error' : ''}`}>{driveMessage}</span>
          <button className="quiet-button" onClick={() => setDrivePanelOpen((value) => !value)}>
            {driveConnected ? 'Drive' : 'Connect Google Drive'}
          </button>
          <button className="primary-button" onClick={() => void syncDrive()}>Sync</button>
        </div>
      </header>

      {drivePanelOpen && (
        <section className="drive-panel">
          <div>
            <strong>Google Drive</strong>
            <p>
              Scratchtrack is a public website. Your recordings stay private in your own Google Drive.
              You and a collaborator each sign in with your own Google account — never share a password.
            </p>
            <p className={`drive-status-line ${driveConnected ? 'connected' : driveStatus === 'error' ? 'error' : ''}`}>
              {driveConnected ? 'Connected to Google Drive' : driveStatus === 'connecting' ? 'Connecting…' : driveStatus === 'error' ? driveMessage : 'Not connected'}
            </p>
          </div>
          <div className="drive-copy">
            <form
              className="drive-link-row"
              onSubmit={(event) => {
                event.preventDefault();
                void openDriveLink(driveLinkInput);
                setDriveLinkInput('');
              }}
            >
              <input
                value={driveLinkInput}
                onChange={(event) => setDriveLinkInput(event.target.value)}
                placeholder="https://drive.google.com/drive/folders/…"
                aria-label="Google Drive folder link"
              />
              <button type="submit" className="primary-button">Open Drive link</button>
            </form>
            <p className="drive-hint">
              Paste a standard Google Drive folder share link (or a Scratchtrack link). Google may ask you to confirm the folder once in the picker — that is how this site gets narrow access without broad Drive permissions.
            </p>
            {invitedFolderId
              ? <p><strong>Someone shared a Scratchtrack project with you.</strong> Connect Google Drive, then open the shared project.</p>
              : (
                <ol>
                  <li>Connect Google Drive with your Google account.</li>
                  <li>Sync to create or update this project in Drive.</li>
                  <li>Share project copies a link and opens the Drive folder so you can invite a collaborator as an editor.</li>
                  <li>They paste the folder link here, sign in with their own account, and confirm the folder once.</li>
                </ol>
              )}
            {!isDriveConfigured() && (
              <p className="drive-setup-note">This deployed app still needs a one-time Google Cloud / GitHub Pages setup by the site owner. Musicians should not have to paste OAuth details.</p>
            )}
            {isDriveConfigured() && !isPickerConfigured() && (
              <p className="drive-setup-note">Saving to your own Drive works. Opening a folder someone shared with you also needs the site owner’s Google Picker API key.</p>
            )}
            {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
              <label>Advanced · Google client ID for this browser only
                <input defaultValue={googleClientId()} placeholder="000000000000-…apps.googleusercontent.com" onBlur={(event) => localStorage.setItem('scratchtrack.googleClientId', event.target.value.trim())} />
              </label>
            )}
          </div>
          <div className="drive-actions">
            {driveConnected
              ? <button className="quiet-button" onClick={() => { disconnectDrive(); setDriveConnected(false); setDriveStatus('local'); setDriveMessage('Disconnected from Google Drive'); }}>Disconnect</button>
              : <button className="primary-button" onClick={() => void connectGoogle()}>Connect Google Drive</button>}
            {driveStatus === 'error' && driveMessage.includes('reconnect') && (
              <button className="primary-button" onClick={() => void connectGoogle()}>Reconnect Google Drive</button>
            )}
            <button className="quiet-button" onClick={() => void openSharedProject(invitedFolderId || undefined)}>
              {invitedFolderId ? 'Open this shared project' : 'Open shared project'}
            </button>
            <button className="quiet-button" onClick={() => void shareProject()}>{shareLinkCopied ? 'Share link copied' : 'Share project'}</button>
            <button className="primary-button" onClick={() => void syncDrive()}>Sync</button>
            <button className="quiet-button" onClick={exportProject}>Export project</button>
            <label className="quiet-button file-button">Import project<input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && importProject(event.target.files[0])} /></label>
          </div>
        </section>
      )}

      <section className="transport">
        <button className="transport-main" onClick={toggleTransport} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? 'Ⅱ' : '▶'}</button>
        <button className="transport-stop" onClick={stopTransport} aria-label="Stop">■</button>
        <label className="bpm-control">BPM<input type="number" min="40" max="240" value={project.bpm} onChange={(event) => commitProject((current) => ({ ...current, bpm: Math.min(240, Math.max(40, Number(event.target.value) || 40)) }))} /></label>
        <div className="meter-control" role="group" aria-label="Time signature">
          <span>Meter</span>
          <select aria-label="Beats per bar" value={meter.numerator} onChange={(event) => changeTimeSignature(Number(event.target.value), meter.denominator)}>
            {numeratorOptions.map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
          <select aria-label="Note value per beat" value={meter.denominator} onChange={(event) => changeTimeSignature(meter.numerator, Number(event.target.value) as TimeSignature['denominator'])}>
            {VALID_DENOMINATORS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <button className={`toggle-button ${metronome ? 'active' : ''}`} onClick={() => setMetronome((value) => !value)}>Metronome</button>
        <button className={`toggle-button ${project.loop.enabled ? 'active' : ''}`} onClick={() => commitProject((current) => ({ ...current, loop: { ...current.loop, enabled: !current.loop.enabled } }))}>Loop</button>
        <div className="loop-controls">
          <button onClick={setLoopIn}>Set In</button>
          <LoopPointInput label="In" value={project.loop.startBeat} meter={meter} snapStep={snapStep} onChange={(beat) => setLoopPoint('in', beat)} />
          <button onClick={setLoopOut}>Set Out</button>
          <LoopPointInput label="Out" value={project.loop.endBeat} meter={meter} snapStep={snapStep} onChange={(beat) => setLoopPoint('out', beat)} />
          <button className={`take-toggle ${project.loop.autoScratch ? 'active' : ''}`} onClick={() => commitProject((current) => ({ ...current, loop: { ...current.loop, autoScratch: !current.loop.autoScratch } }))}>Auto Scratch {project.loop.autoScratch ? 'On' : 'Off'}</button>
        </div>
        <span className="position-readout">{formatPosition(playheadBeat, meter)}</span>
        <input className="transport-scrubber" aria-label="Playhead" type="range" min="0" max={TOTAL_BEATS} step={snapMinimum} value={playheadBeat} onChange={(event) => setPlayheadBeat(Number(event.target.value))} />
      </section>

      <section className="editor-panel">
        <div className="editor-heading">
          <div><span className="track-index">{project.tracks.indexOf(selectedTrack) + 1}</span><h2>{selectedTrack.name}</h2></div>
          <span>
            {selectedTrack.kind === 'drum'
              ? `Pattern sequencer · ${stepsPerBar(meter, activeOfSelected?.drumSubdivision ?? '1/16') ?? 16} steps/bar`
              : selectedTrack.kind === 'synth' ? 'Analog sketch synth + motif composer' : selectedTrack.kind === 'bass' ? 'DI capture + mix' : 'Audio capture + mix'}
          </span>
        </div>
        {selectedTrack.kind === 'drum' && (
          <DrumEditor
            key={selectedTrack.id + ':' + (activeOfSelected?.id ?? '')}
            track={selectedTrack}
            updateScratch={updateScratch}
            meter={meter}
            bpm={project.bpm}
            onNewScratch={() => createNewScratch(selectedTrack)}
            onDuplicateScratch={() => duplicateActiveScratch(selectedTrack)}
            onPlaceActive={placeActiveAtPlayhead}
          />
        )}
        {selectedTrack.kind === 'synth' && (
          <SynthEditor
            key={selectedTrack.id + ':' + (activeOfSelected?.id ?? '')}
            track={selectedTrack}
            updateScratch={updateScratch}
            meter={meter}
            writeMotif={writeMotif}
            setWriteMotif={setWriteMotif}
            onNewScratch={() => createNewScratch(selectedTrack)}
            onDuplicateScratch={() => duplicateActiveScratch(selectedTrack)}
            onPlaceActive={placeActiveAtPlayhead}
          />
        )}
        {(selectedTrack.kind === 'bass' || selectedTrack.kind === 'audio') && (
          <AudioEditor
            track={selectedTrack}
            updateTrack={updateTrack}
            recording={recordingTrackId === selectedTrack.id}
            recordingPhase={recordingTrackId === selectedTrack.id ? recordingPhase : 'idle'}
            loopTakeCount={recordingTrackId === selectedTrack.id ? loopTakeCount : 0}
            disabled={Boolean(recordingTrackId && recordingTrackId !== selectedTrack.id)}
            onRecord={() => void toggleRecording(selectedTrack)}
            loopEnabled={project.loop.enabled}
            autoScratch={project.loop.autoScratch}
            maxLoopTakes={MAX_LOOP_TAKES}
            onNewScratch={() => createNewScratch(selectedTrack)}
            onDuplicateScratch={() => duplicateActiveScratch(selectedTrack)}
            onPlaceActive={placeActiveAtPlayhead}
            placeDisabled={placeDisabled}
          />
        )}
      </section>

      <section className="timeline-section">
        <div className="timeline-title-row">
          <div><h2>Arrangement</h2><span>Scroll the lanes freely. Tap a clip to select; use its move or resize handle to edit on touch.</span></div>
          <span>{project.clips.length} clip{project.clips.length === 1 ? '' : 's'} · {project.tracks.reduce((sum, track) => sum + track.scratches.length, 0)} scratches</span>
        </div>
        <div className="edit-toolbar" aria-label="Clip editing controls">
          <label className="snap-control">
            <span>Snap</span>
            <select value={snapSetting} onChange={(event) => setSnapSetting(event.target.value as SnapSetting)} aria-label="Snap resolution">
              {SNAP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button disabled={!selectedClip} onClick={splitSelectedClip}>Snip @ playhead</button>
          <button disabled={!selectedClip} onClick={copySelectedClip}>Copy</button>
          <button disabled={!clipboard} onClick={pasteClip}>Paste</button>
          <button disabled={!selectedClip} onClick={duplicateSelectedClip}>Duplicate</button>
          <button disabled={!selectedClip} className="danger" onClick={deleteSelectedClip}>Delete</button>
          <span className={`edit-help ${moveFeedback ? 'moving' : ''}`}>{moveFeedback
            ? `Move → ${formatPosition(moveFeedback.startBeat, meter)} · ${moveFeedback.delta >= 0 ? '+' : ''}${moveFeedback.delta.toFixed(3)}b`
            : selectedClip ? `Selected: ${formatPosition(selectedClip.startBeat, meter)} · ${selectedClip.lengthBeats.toFixed(3)} beats` : 'Select a clip to edit'}</span>
        </div>
        <div className="timeline-scroll">
          <div className="ruler-row">
            <div className="ruler-label">Bars · tap = playhead · drag = loop</div>
            <div className="ruler" onPointerDown={handleRulerPointerDown} style={{ backgroundImage: `linear-gradient(to right, #25292e 0 1px, transparent 1px)`, backgroundSize: `${barPercent}% 100%` }}>
              {(project.loop.enabled || loopDraft) && <div className={`loop-region ${loopDraft ? 'draft' : ''}`} style={{ left: `${(visibleLoop.startBeat / TOTAL_BEATS) * 100}%`, width: `${((visibleLoop.endBeat - visibleLoop.startBeat) / TOTAL_BEATS) * 100}%` }}><span>LOOP</span></div>}
              {Array.from({ length: barCount }, (_, index) => (
                <span key={index} style={{ left: `${((index * beatsPerBarValue) / TOTAL_BEATS) * 100}%` }}>{index + 1}</span>
              ))}
              <div className="playhead" style={{ left: `${(playheadBeat / TOTAL_BEATS) * 100}%` }} />
            </div>
          </div>
          {project.tracks.map((track, trackIndex) => {
            const scratchesOpen = drawerTrackId === track.id;
            return (
              <div className="track-block" key={track.id}>
                <div className={`track-row ${selectedTrackId === track.id ? 'selected' : ''}`}>
                  <div className="track-controls" onClick={() => setSelectedTrackId(track.id)}>
                    <button
                      className="scratch-plus"
                      aria-expanded={scratchesOpen}
                      aria-label={`${scratchesOpen ? 'Close' : 'Open'} ${track.name} scratches`}
                      onClick={(event) => { event.stopPropagation(); setDrawerTrackId(scratchesOpen ? null : track.id); }}
                    >{scratchesOpen ? '−' : '+'}</button>
                    <span className="track-number">{String(trackIndex + 1).padStart(2, '0')}</span><strong>{track.name}</strong>
                    <div className="track-mini-actions"><button className={track.muted ? 'active' : ''} onClick={(event) => { event.stopPropagation(); updateTrack(track.id, (current) => ({ ...current, muted: !current.muted })); }}>M</button><button className={track.solo ? 'active' : ''} onClick={(event) => { event.stopPropagation(); updateTrack(track.id, (current) => ({ ...current, solo: !current.solo })); }}>S</button></div>
                  </div>
                  <div className="timeline-lane" data-track-id={track.id}>
                    <div className="beat-grid" style={{ backgroundImage: 'linear-gradient(to right, rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,.075) 1px, transparent 1px)', backgroundSize: `${(1 / TOTAL_BEATS) * 100}% 100%, ${(beatsPerBarValue / TOTAL_BEATS) * 100}% 100%` }} />
                    {project.loop.enabled && <div className="lane-loop-region" style={{ left: `${(project.loop.startBeat / TOTAL_BEATS) * 100}%`, width: `${((project.loop.endBeat - project.loop.startBeat) / TOTAL_BEATS) * 100}%` }} />}
                    <div className="lane-playhead" style={{ left: `${(playheadBeat / TOTAL_BEATS) * 100}%` }} />
                    {project.clips.filter((clip) => clip.trackId === track.id).map((clip) => {
                      const scratch = track.scratches.find((item) => item.id === clip.scratchId);
                      if (!scratch) return null;
                      const patternLength = scratchLengthBeats(track, scratch, project);
                      const repeatCount = (track.kind === 'drum' || track.kind === 'synth') ? Math.max(1, clip.lengthBeats / patternLength) : 1;
                      return (
                        <div
                          key={clip.id}
                          className={`timeline-clip ${track.kind} ${selectedClipId === clip.id ? 'clip-selected' : ''} ${repeatCount > 1.01 ? 'repeating' : ''}`}
                          style={{ left: `${(clip.startBeat / TOTAL_BEATS) * 100}%`, width: `${Math.max(1.5, (clip.lengthBeats / TOTAL_BEATS) * 100)}%` }}
                          onPointerDown={(event) => {
                            setSelectedClipId(clip.id);
                            setSelectedTrackId(track.id);
                            if (event.pointerType === 'mouse' && !(event.target as HTMLElement).closest('.clip-move,.clip-resize')) handleClipMove(event, clip, scratch.name);
                          }}
                          onDoubleClick={() => void auditionScratch(track, scratch)}
                          title="Tap to select · use ↔ handle on touch · right edge resizes · double-click auditions"
                        >
                          <button className="clip-move" aria-label="Move clip" onPointerDown={(event) => handleClipMove(event, clip, scratch.name)}>↔</button>
                          <span>{scratch.name}</span><small>{repeatCount > 1.01 ? `${repeatCount.toFixed(repeatCount % 1 ? 1 : 0)}× pattern` : `${clip.lengthBeats.toFixed(2)}b`}</small>
                          <button className="clip-resize" aria-label="Resize clip" onPointerDown={(event) => handleClipResize(event, clip)}><i /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {scratchesOpen && (
                  <div className="scratch-drawer">
                    <div className="scratch-drawer-head"><strong>{track.name} scratches</strong><span>{track.scratches.length}/{MAX_SCRATCHES} · loop sessions add at most {MAX_LOOP_TAKES}</span></div>
                    <div className="scratch-list">
                      {track.scratches.map((scratch) => (
                        <article className={`scratch-card ${track.activeScratchId === scratch.id ? 'active' : ''}`} key={scratch.id}>
                          <button className="scratch-name" onClick={() => { updateTrack(track.id, (current) => ({ ...current, activeScratchId: scratch.id })); setSelectedTrackId(track.id); }}>{scratch.name}</button>
                          <input value={scratch.note} placeholder="Add a note…" onChange={(event) => updateScratch(track.id, scratch.id, (current) => ({ ...current, note: event.target.value }))} />
                          <div className="scratch-card-actions">
                            <button onClick={() => void auditionScratch(track, scratch)}>Hear</button>
                            <button onClick={() => placeScratch(track.id, scratch.id)}>Place</button>
                            <button className="scratch-drag" onPointerDown={(event) => handleScratchDrag(event, track, scratch)}>Drag</button>
                            <button className="danger" onClick={() => void deleteScratch(track, scratch)}>×</button>
                          </div>
                        </article>
                      ))}
                      {track.scratches.length < MAX_SCRATCHES && <button className="new-scratch-card" onClick={() => createNewScratch(track)}>＋ New scratch</button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <footer className="footer-line"><span>Local-first · audio stays in your browser until you sync it</span><span>Scratchtrack v0.5</span></footer>
      {dragGhost && <div className="drag-ghost" style={{ transform: `translate(${dragGhost.x + 14}px, ${dragGhost.y + 14}px)` }}>{dragGhost.label}</div>}
    </div>
  );
}
