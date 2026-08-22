import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { playAudioBlob, playDrumStep, playMetronome, playSynthNote } from './audio';
import { connectDrive, isDriveConnected, syncProjectToDrive } from './drive';
import {
  defaultChannelSettings,
  defaultDrumSettings,
  defaultPatch,
  deleteAudioBlob,
  loadAudioBlob,
  loadProject,
  makeBlankPattern,
  normalizeProject,
  saveAudioBlob,
  saveProject,
  uid,
} from './store';
import type { Clip, DrumCell, DrumSettings, Scratch, ScratchtrackProject, SynthPatch, Track } from './types';
import DrumGeometry from './DrumGeometry';
import WaveformDisplay from './WaveformDisplay';

const TOTAL_BEATS = 64;
const MAX_SCRATCHES = 36;
const MAX_LOOP_TAKES = 12;
const DRUM_NAMES = ['Kick', 'Snare', 'Hat', 'Open'];
const SYNTH_KEYS = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72];
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'D', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

type RecordMode = 'none' | 'single' | 'loop-single' | 'loop-auto';
type RecordingPhase = 'idle' | 'warmup' | 'recording' | 'auto';
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

function snapStepFor(setting: SnapSetting, beatsPerBar: number): number | null {
  switch (setting) {
    case '1/32': return 0.125;
    case '1/16': return 0.25;
    case '1/8': return 0.5;
    case '1/4': return 1;
    case '1/2': return 2;
    case 'bar': return Math.max(1, beatsPerBar);
    default: return null;
  }
}

function noteName(midi: number) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function activeScratch(track: Track) {
  return track.scratches.find((s) => s.id === track.activeScratchId) ?? track.scratches[0];
}

function quantizeBeat(value: number, step = 0.25) {
  return Math.round(value / step) * step;
}

function clampBeat(value: number, max = TOTAL_BEATS) {
  return Math.max(0, Math.min(max, value));
}

function scratchLengthBeats(track: Track, scratch: Scratch, bpm: number) {
  if (track.kind === 'drum') return 4;
  if (track.kind === 'synth') {
    const end = Math.max(4, ...(scratch.synthNotes ?? []).map((n) => n.startBeat + n.lengthBeats));
    return Math.max(4, Math.ceil(end / 4) * 4);
  }
  if (scratch.audioDuration) return Math.max(0.25, quantizeBeat(scratch.audioDuration * bpm / 60));
  return 4;
}

function scratchName(index: number) {
  if (index < 26) return `Scratch ${String.fromCharCode(65 + index)}`;
  return `Scratch ${index + 1}`;
}

function barsLabel(beat: number, beatsPerBar: number) {
  return `${Math.floor(beat / beatsPerBar) + 1}.${Math.floor(beat % beatsPerBar) + 1}`;
}

function precisePositionLabel(beat: number, beatsPerBar: number) {
  const bar = Math.floor(beat / beatsPerBar) + 1;
  const beatWithinBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  const wholeBeat = Math.floor(beatWithinBar) + 1;
  const fraction = beatWithinBar - Math.floor(beatWithinBar);
  return fraction > 0.001 ? `${bar}.${wholeBeat} +${fraction.toFixed(3)}b` : `${bar}.${wholeBeat}`;
}

export default function App() {
  const [project, setProject] = useState<ScratchtrackProject>(() => loadProject());
  const projectRef = useRef(project);
  const [selectedTrackId, setSelectedTrackId] = useState(project.tracks[0].id);
  const [drawerTrackId, setDrawerTrackId] = useState<string | null>(project.tracks[0].id);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<Clip | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadBeat, setPlayheadBeat] = useState(0);
  const playheadRef = useRef(0);
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
  const [drivePanelOpen, setDrivePanelOpen] = useState(false);
  const [driveStatus, setDriveStatus] = useState<'local' | 'connecting' | 'connected' | 'syncing' | 'synced' | 'error'>('local');
  const [driveMessage, setDriveMessage] = useState('Saved locally');
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const [moveFeedback, setMoveFeedback] = useState<{ startBeat: number; delta: number } | null>(null);
  const [loopDraft, setLoopDraft] = useState<{ startBeat: number; endBeat: number } | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderStartedAtRef = useRef(0);
  const recordModeRef = useRef<RecordMode>('none');
  const loopWarmupRef = useRef(false);
  const loopRequestedTakeRef = useRef(0);
  const loopSavedTakeRef = useRef(0);
  const activeAudioRef = useRef<AudioBufferSourceNode[]>([]);

  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => { localStorage.setItem('scratchtrack.snapDivision', snapSetting); }, [snapSetting]);

  const selectedTrack = useMemo(
    () => project.tracks.find((track) => track.id === selectedTrackId) ?? project.tracks[0],
    [project.tracks, selectedTrackId],
  );
  const selectedClip = useMemo(() => project.clips.find((clip) => clip.id === selectedClipId) ?? null, [project.clips, selectedClipId]);
  const snapStep = useMemo(() => snapStepFor(snapSetting, project.beatsPerBar), [project.beatsPerBar, snapSetting]);
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

  const placeScratch = useCallback((trackId: string, scratchId: string, startBeat = playheadRef.current) => {
    const current = projectRef.current;
    const track = current.tracks.find((item) => item.id === trackId);
    const scratch = track?.scratches.find((item) => item.id === scratchId);
    if (!track || !scratch) return;
    const snapped = clampBeat(editBeat(startBeat), TOTAL_BEATS - 0.25);
    const length = scratchLengthBeats(track, scratch, current.bpm);
    const clip: Clip = { id: uid(), trackId, scratchId, startBeat: snapped, lengthBeats: Math.min(length, TOTAL_BEATS - snapped), sourceOffsetBeats: 0 };
    commitProject((projectNow) => ({ ...projectNow, clips: [...projectNow.clips, clip] }));
    setSelectedClipId(clip.id);
  }, [commitProject, editBeat]);

  const createScratch = useCallback((track: Track) => {
    if (track.scratches.length >= MAX_SCRATCHES) return;
    const source = activeScratch(track);
    const next: Scratch = {
      id: uid(),
      name: scratchName(track.scratches.length),
      note: '',
      createdAt: new Date().toISOString(),
    };
    if (track.kind === 'drum') {
      next.drumPattern = source?.drumPattern?.map((row) => [...row] as DrumCell[]) ?? makeBlankPattern();
      next.drumKit = source?.drumKit ?? 'Pocket';
      next.drumSettings = { ...(source?.drumSettings ?? defaultDrumSettings) };
    }
    if (track.kind === 'synth') {
      next.synthPatch = { ...(source?.synthPatch ?? defaultPatch) };
      next.synthNotes = (source?.synthNotes ?? []).map((note) => ({ ...note, id: uid() }));
    }
    updateTrack(track.id, (current) => ({ ...current, activeScratchId: next.id, scratches: [...current.scratches, next] }));
    setDrawerTrackId(track.id);
  }, [updateTrack]);

  const deleteScratch = useCallback(async (track: Track, scratch: Scratch) => {
    if (scratch.audioBlobId) await deleteAudioBlob(scratch.audioBlobId).catch(() => undefined);
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

  const auditionScratch = useCallback(async (track: Track, scratch: Scratch) => {
    const current = projectRef.current;
    if (track.kind === 'drum' && scratch.drumPattern) {
      let step = 0;
      const ms = (60_000 / current.bpm) / 4;
      playDrumStep(scratch.drumPattern, 0, scratch.drumKit, scratch.drumSettings);
      const timer = window.setInterval(() => {
        step += 1;
        if (step >= 16) return window.clearInterval(timer);
        const settings = scratch.drumSettings ?? defaultDrumSettings;
        const swingDelay = step % 2 ? ms * 0.48 * settings.swing : 0;
        window.setTimeout(() => playDrumStep(scratch.drumPattern!, step, scratch.drumKit, settings), swingDelay);
      }, ms);
      return;
    }
    if (track.kind === 'synth' && scratch.synthPatch) {
      for (const note of scratch.synthNotes ?? []) {
        window.setTimeout(() => playSynthNote(note.midi, scratch.synthPatch!, (60 / current.bpm) * note.lengthBeats * 0.8), (60_000 / current.bpm) * note.startBeat);
      }
      return;
    }
    if (scratch.audioBlobId) {
      const blob = await loadAudioBlob(scratch.audioBlobId);
      if (!blob) return;
      const source = await playAudioBlob(blob, track.settings ?? defaultChannelSettings);
      activeAudioRef.current.push(source);
      source.onended = () => { activeAudioRef.current = activeAudioRef.current.filter((item) => item !== source); };
    }
  }, []);

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
    if (track.kind === 'audio' || track.kind === 'bass') maxLength = Math.min(maxLength, scratchLengthBeats(track, scratch, current.bpm) - (clip.sourceOffsetBeats ?? 0));
    const lengthBeats = Math.max(snapMinimum, Math.min(maxLength, editBeat(desiredLength)));
    commitProject((projectNow) => ({ ...projectNow, clips: projectNow.clips.map((item) => item.id === clipId ? { ...item, lengthBeats } : item) }));
  }, [commitProject, editBeat, snapMinimum]);

  const splitSelectedClip = useCallback(() => {
    const current = projectRef.current;
    const clip = current.clips.find((item) => item.id === selectedClipId);
    const split = editBeat(playheadRef.current);
    if (!clip || split <= clip.startBeat || split >= clip.startBeat + clip.lengthBeats) return;
    const leftLength = split - clip.startBeat;
    const right: Clip = {
      ...clip,
      id: uid(),
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
    const startBeat = clampBeat(editBeat(playheadRef.current), TOTAL_BEATS - clipboard.lengthBeats);
    const clip = { ...clipboard, id: uid(), startBeat };
    commitProject((current) => ({ ...current, clips: [...current.clips, clip] }));
    setSelectedClipId(clip.id);
    setSelectedTrackId(clip.trackId);
  }, [clipboard, commitProject, editBeat]);

  const duplicateSelectedClip = useCallback(() => {
    const clip = projectRef.current.clips.find((item) => item.id === selectedClipId);
    if (!clip) return;
    const nextStart = clampBeat(editBeat(clip.startBeat + clip.lengthBeats), TOTAL_BEATS - clip.lengthBeats);
    const duplicate = { ...clip, id: uid(), startBeat: nextStart };
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

  const performStep = useCallback((beat: number) => {
    const current = projectRef.current;
    const anySolo = current.tracks.some((track) => track.solo);
    for (const track of current.tracks) {
      if (track.muted || (anySolo && !track.solo)) continue;
      const clips = current.clips.filter((clip) => clip.trackId === track.id && beat >= clip.startBeat && beat < clip.startBeat + clip.lengthBeats);
      for (const clip of clips) {
        const scratch = track.scratches.find((item) => item.id === clip.scratchId);
        if (!scratch) continue;
        const localBeat = beat - clip.startBeat;
        const sourceBeat = (clip.sourceOffsetBeats ?? 0) + localBeat;
        if (track.kind === 'drum' && scratch.drumPattern) {
          const patternBeat = ((sourceBeat % 4) + 4) % 4;
          const step = Math.floor(patternBeat * 4) % 16;
          const settings = scratch.drumSettings ?? defaultDrumSettings;
          const sixteenthMs = (60_000 / current.bpm) / 4;
          const swingDelay = step % 2 ? sixteenthMs * 0.48 * settings.swing : 0;
          const humanDelay = settings.humanize * Math.random() * 13;
          window.setTimeout(() => playDrumStep(scratch.drumPattern!, step, scratch.drumKit, settings), swingDelay + humanDelay);
        } else if (track.kind === 'synth' && scratch.synthPatch) {
          const patternLength = scratchLengthBeats(track, scratch, current.bpm);
          const patternBeat = ((sourceBeat % patternLength) + patternLength) % patternLength;
          for (const note of scratch.synthNotes ?? []) {
            if (Math.abs(patternBeat - note.startBeat) < 0.02) playSynthNote(note.midi, scratch.synthPatch, (60 / current.bpm) * note.lengthBeats * 0.8);
          }
        } else if (scratch.audioBlobId && Math.abs(localBeat) < 0.02) {
          void loadAudioBlob(scratch.audioBlobId).then(async (blob) => {
            if (!blob) return;
            const offsetSeconds = (clip.sourceOffsetBeats ?? 0) * 60 / current.bpm;
            const durationSeconds = clip.lengthBeats * 60 / current.bpm;
            const source = await playAudioBlob(blob, track.settings ?? defaultChannelSettings, offsetSeconds, durationSeconds);
            activeAudioRef.current.push(source);
            source.onended = () => { activeAudioRef.current = activeAudioRef.current.filter((item) => item !== source); };
          });
        }
      }
    }
    if (metronome && Math.abs(beat - Math.round(beat)) < 0.02) playMetronome(Math.round(beat) % current.beatsPerBar === 0);
  }, [metronome]);

  const cleanupRecordingSession = useCallback(() => {
    recorderStreamRef.current?.getTracks().forEach((mediaTrack) => mediaTrack.stop());
    recorderStreamRef.current = null;
    recorderRef.current = null;
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
    if (track.scratches.length >= MAX_SCRATCHES) {
      setDriveStatus('error');
      setDriveMessage(`Scratch limit reached (${MAX_SCRATCHES}). Delete bad takes before recording more.`);
      return false;
    }
    const blobId = uid();
    await saveAudioBlob(blobId, blob);
    const name = loopTake && takeNumber ? `Loop ${String(takeNumber).padStart(2, '0')}` : scratchName(track.scratches.length);
    const scratch: Scratch = {
      id: uid(),
      name,
      note: loopTake ? 'Auto Scratch loop take' : 'Recorded with arrangement playback',
      createdAt: new Date().toISOString(),
      audioBlobId: blobId,
      audioMimeType: blob.type,
      audioDuration: durationSeconds,
    };
    updateTrack(track.id, (freshTrack) => ({ ...freshTrack, activeScratchId: scratch.id, scratches: [...freshTrack.scratches, scratch] }));
    setDrawerTrackId(track.id);
    return true;
  }, [updateTrack]);

  const recorderOptions = useCallback(() => {
    const mimeCandidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
    const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type));
    return { mimeType, options: mimeType ? { mimeType, audioBitsPerSecond: 96000 } : undefined };
  }, []);

  const startSingleRecorder = useCallback((trackId: string, stream: MediaStream) => {
    const { mimeType, options } = recorderOptions();
    const recorder = new MediaRecorder(stream, options);
    recorderRef.current = recorder;
    recorderChunksRef.current = [];
    recorderStartedAtRef.current = performance.now();
    recorder.ondataavailable = (event) => { if (event.data.size) recorderChunksRef.current.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(recorderChunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
      const elapsed = Math.max(0.1, (performance.now() - recorderStartedAtRef.current) / 1000);
      void saveRecordedTake(trackId, blob, elapsed, false).finally(cleanupRecordingSession);
    };
    recorder.start(200);
    setRecordingPhase('recording');
  }, [cleanupRecordingSession, recorderOptions, saveRecordedTake]);

  const startAutoLoopRecorder = useCallback((trackId: string, stream: MediaStream) => {
    const { options } = recorderOptions();
    const recorder = new MediaRecorder(stream, options);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      if (loopSavedTakeRef.current >= loopRequestedTakeRef.current || loopSavedTakeRef.current >= MAX_LOOP_TAKES) return;
      const takeNumber = loopSavedTakeRef.current + 1;
      loopSavedTakeRef.current = takeNumber;
      setLoopTakeCount(takeNumber);
      const current = projectRef.current;
      const loopSeconds = Math.max(0.1, (current.loop.endBeat - current.loop.startBeat) * 60 / current.bpm);
      void saveRecordedTake(trackId, event.data, loopSeconds, true, takeNumber);
    };
    recorder.onstop = cleanupRecordingSession;
    recorder.start();
    setRecordingPhase('auto');
  }, [cleanupRecordingSession, recorderOptions, saveRecordedTake]);

  const stopRecordingSession = useCallback(() => {
    loopWarmupRef.current = false;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      return;
    }
    cleanupRecordingSession();
  }, [cleanupRecordingSession]);

  const beginPostWarmupCapture = useCallback(() => {
    const trackId = recordingTrackRef.current;
    const stream = recorderStreamRef.current;
    if (!trackId || !stream?.active) return;
    if (recordModeRef.current === 'loop-auto') startAutoLoopRecorder(trackId, stream);
    else if (recordModeRef.current === 'loop-single') startSingleRecorder(trackId, stream);
  }, [startAutoLoopRecorder, startSingleRecorder]);

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
      recorderStreamRef.current = stream;
      recordingTrackRef.current = track.id;
      setRecordingTrackId(track.id);
      setLoopTakeCount(0);
      loopRequestedTakeRef.current = 0;
      loopSavedTakeRef.current = 0;
      const current = projectRef.current;

      if (current.loop.enabled) {
        recordModeRef.current = current.loop.autoScratch ? 'loop-auto' : 'loop-single';
        loopWarmupRef.current = true;
        playheadRef.current = current.loop.startBeat;
        setPlayheadBeat(current.loop.startBeat);
        setRecordingPhase('warmup');
        setDriveStatus('local');
        setDriveMessage('Warm-up pass · playback only, nothing recorded yet');
        setIsPlaying(true);
        return;
      }

      recordModeRef.current = 'single';
      startSingleRecorder(track.id, stream);
      setDriveStatus('local');
      setDriveMessage('Recording with arrangement playback');
      setIsPlaying(true);
    } catch (error) {
      setDriveMessage(error instanceof Error ? error.message : 'Microphone permission failed.');
      setDriveStatus('error');
    }
  }, [startSingleRecorder, stopActiveSources, stopRecordingSession]);

  useEffect(() => {
    if (!isPlaying) return;
    const intervalMs = (60_000 / project.bpm) / 4;
    performStep(playheadRef.current);
    const timer = window.setInterval(() => {
      const current = projectRef.current;
      const loop = current.loop;
      let next = playheadRef.current + 0.25;
      const reachedLoopEnd = loop.enabled && next >= loop.endBeat;

      if (reachedLoopEnd) {
        if (recordingTrackRef.current && (recordModeRef.current === 'loop-auto' || recordModeRef.current === 'loop-single')) {
          if (loopWarmupRef.current) {
            loopWarmupRef.current = false;
            beginPostWarmupCapture();
            setDriveMessage(recordModeRef.current === 'loop-auto' ? `Auto Scratch · capturing pass 1/${MAX_LOOP_TAKES}` : 'Warm-up complete · recording');
          } else if (recordModeRef.current === 'loop-auto' && recorderRef.current?.state === 'recording') {
            if (loopRequestedTakeRef.current < MAX_LOOP_TAKES) {
              loopRequestedTakeRef.current += 1;
              recorderRef.current.requestData();
              const nextTake = Math.min(MAX_LOOP_TAKES, loopRequestedTakeRef.current + 1);
              if (loopRequestedTakeRef.current < MAX_LOOP_TAKES) {
                setDriveMessage(`Auto Scratch · capturing pass ${nextTake}/${MAX_LOOP_TAKES}`);
              } else {
                setDriveMessage(`${MAX_LOOP_TAKES} loop Scratches captured · recording stopped`);
                const recorder = recorderRef.current;
                window.setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 0);
              }
            }
          }
        }
        next = loop.startBeat;
        stopActiveSources();
      } else if (next >= TOTAL_BEATS) {
        next = loop.enabled ? loop.startBeat : 0;
      }
      playheadRef.current = next;
      setPlayheadBeat(next);
      performStep(next);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [beginPostWarmupCapture, isPlaying, performStep, project.bpm, stopActiveSources]);

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
    playheadRef.current = next;
    setPlayheadBeat(next);
  }, [stopActiveSources, stopRecordingSession]);

  const setLoopIn = useCallback(() => {
    const point = clampBeat(editBeat(playheadRef.current), TOTAL_BEATS - snapMinimum);
    commitProject((current) => ({ ...current, loop: { ...current.loop, startBeat: Math.min(point, current.loop.endBeat - snapMinimum) } }));
  }, [commitProject, editBeat, snapMinimum]);

  const setLoopOut = useCallback(() => {
    const point = Math.max(snapMinimum, clampBeat(editBeat(playheadRef.current)));
    commitProject((current) => ({ ...current, loop: { ...current.loop, endBeat: Math.max(point, current.loop.startBeat + snapMinimum) } }));
  }, [commitProject, editBeat, snapMinimum]);

  const setPlayhead = useCallback((beat: number) => {
    const value = clampBeat(editBeat(beat));
    playheadRef.current = value;
    setPlayheadBeat(value);
  }, [editBeat]);

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
        setPlayhead(start);
      } else {
        setPlayhead(startBeat);
      }
      setLoopDraft(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
  }, [commitProject, editBeat, setPlayhead, snapMinimum]);

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
        label: `${label} · ${precisePositionLabel(next, projectRef.current.beatsPerBar)} · ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}b`,
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

  const exportProject = useCallback(() => {
    const blob = new Blob([JSON.stringify(projectRef.current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${projectRef.current.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'scratchtrack'}.scratchtrack.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const importProject = useCallback((file: File) => {
    void file.text().then((text) => {
      const next = normalizeProject(JSON.parse(text));
      setProject(next);
      projectRef.current = next;
      setSelectedTrackId(next.tracks[0].id);
      setDrawerTrackId(next.tracks[0].id);
      setSelectedClipId(null);
      playheadRef.current = 0;
      setPlayheadBeat(0);
    }).catch((error) => {
      setDriveStatus('error');
      setDriveMessage(error instanceof Error ? error.message : 'Could not import project.');
    });
  }, []);

  const syncDrive = useCallback(async () => {
    const clientId = localStorage.getItem('scratchtrack.googleClientId')?.trim();
    if (!clientId) {
      setDrivePanelOpen(true);
      setDriveMessage('Add a Google OAuth client ID first.');
      return;
    }
    try {
      if (!isDriveConnected()) {
        setDriveStatus('connecting');
        setDriveMessage('Connecting Google Drive…');
        await connectDrive(clientId);
      }
      setDriveStatus('syncing');
      setDriveMessage('Syncing project and audio…');
      const result = await syncProjectToDrive(projectRef.current, loadAudioBlob);
      const now = new Date().toISOString();
      commitProject((current) => ({ ...current, drive: { ...current.drive, ...result, lastSyncedAt: now } }));
      setDriveStatus('synced');
      setDriveMessage(`Drive synced · ${result.uploadedAudio} audio file${result.uploadedAudio === 1 ? '' : 's'}`);
    } catch (error) {
      setDriveStatus('error');
      setDriveMessage(error instanceof Error ? error.message : 'Drive sync failed.');
    }
  }, [commitProject]);

  const visibleLoop = loopDraft ?? project.loop;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Scratchtrack home"><span className="brand-mark">S/</span><span>Scratchtrack</span></div>
        <input className="project-title" value={project.title} aria-label="Project title" onChange={(event) => commitProject((current) => ({ ...current, title: event.target.value }))} />
        <div className="topbar-actions">
          <span className={`save-state ${driveStatus === 'error' ? 'error' : ''}`}>{driveMessage}</span>
          <button className="quiet-button" onClick={() => setDrivePanelOpen((value) => !value)}>Drive</button>
          <button className="primary-button" onClick={() => void syncDrive()}>Sync</button>
        </div>
      </header>

      {drivePanelOpen && (
        <section className="drive-panel">
          <div><strong>Google Drive</strong><p>The application is public; your music is not. OAuth stays in this browser and project data is uploaded directly to your Drive.</p></div>
          <label>Google OAuth client ID<input defaultValue={localStorage.getItem('scratchtrack.googleClientId') ?? ''} placeholder="000000000000-…apps.googleusercontent.com" onBlur={(event) => localStorage.setItem('scratchtrack.googleClientId', event.target.value.trim())} /></label>
          <div className="drive-actions"><button className="quiet-button" onClick={exportProject}>Export project</button><label className="quiet-button file-button">Import project<input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && importProject(event.target.files[0])} /></label><button className="primary-button" onClick={() => void syncDrive()}>Connect & sync</button></div>
        </section>
      )}

      <section className="transport">
        <button className="transport-main" onClick={toggleTransport} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? 'Ⅱ' : '▶'}</button>
        <button className="transport-stop" onClick={stopTransport} aria-label="Stop">■</button>
        <label className="bpm-control">BPM<input type="number" min="40" max="240" value={project.bpm} onChange={(event) => commitProject((current) => ({ ...current, bpm: Math.min(240, Math.max(40, Number(event.target.value) || 40)) }))} /></label>
        <button className={`toggle-button ${metronome ? 'active' : ''}`} onClick={() => setMetronome((value) => !value)}>Metronome</button>
        <button className={`toggle-button ${project.loop.enabled ? 'active' : ''}`} onClick={() => commitProject((current) => ({ ...current, loop: { ...current.loop, enabled: !current.loop.enabled } }))}>Loop</button>
        <div className="loop-controls">
          <button onClick={setLoopIn}>Set In</button><span>{barsLabel(project.loop.startBeat, project.beatsPerBar)}</span>
          <button onClick={setLoopOut}>Set Out</button><span>{barsLabel(project.loop.endBeat, project.beatsPerBar)}</span>
          <button className={`take-toggle ${project.loop.autoScratch ? 'active' : ''}`} onClick={() => commitProject((current) => ({ ...current, loop: { ...current.loop, autoScratch: !current.loop.autoScratch } }))}>Auto Scratch {project.loop.autoScratch ? 'On' : 'Off'}</button>
        </div>
        <span className="position-readout">{precisePositionLabel(playheadBeat, project.beatsPerBar)}</span>
        <input className="transport-scrubber" aria-label="Playhead" type="range" min="0" max={TOTAL_BEATS} step={snapMinimum} value={playheadBeat} onChange={(event) => setPlayhead(Number(event.target.value))} />
      </section>

      <section className="editor-panel">
        <div className="editor-heading">
          <div><span className="track-index">{project.tracks.indexOf(selectedTrack) + 1}</span><h2>{selectedTrack.name}</h2></div>
          <span>{selectedTrack.kind === 'drum' ? 'Pattern sequencer' : selectedTrack.kind === 'synth' ? 'Analog sketch synth' : selectedTrack.kind === 'bass' ? 'DI capture + mix' : 'Audio capture + mix'}</span>
        </div>
        {selectedTrack.kind === 'drum' && <DrumEditor track={selectedTrack} updateScratch={updateScratch} onCreateScratch={() => createScratch(selectedTrack)} bpm={project.bpm} />}
        {selectedTrack.kind === 'synth' && <SynthEditor track={selectedTrack} updateScratch={updateScratch} writeMotif={writeMotif} setWriteMotif={setWriteMotif} />}
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
            ? `Move → ${precisePositionLabel(moveFeedback.startBeat, project.beatsPerBar)} · ${moveFeedback.delta >= 0 ? '+' : ''}${moveFeedback.delta.toFixed(3)}b`
            : selectedClip ? `Selected: ${precisePositionLabel(selectedClip.startBeat, project.beatsPerBar)} · ${selectedClip.lengthBeats.toFixed(3)} beats` : 'Select a clip to edit'}</span>
        </div>
        <div className="timeline-scroll">
          <div className="ruler-row">
            <div className="ruler-label">Bars · tap = playhead · drag = loop</div>
            <div className="ruler" onPointerDown={handleRulerPointerDown}>
              {(project.loop.enabled || loopDraft) && <div className={`loop-region ${loopDraft ? 'draft' : ''}`} style={{ left: `${(visibleLoop.startBeat / TOTAL_BEATS) * 100}%`, width: `${((visibleLoop.endBeat - visibleLoop.startBeat) / TOTAL_BEATS) * 100}%` }}><span>LOOP</span></div>}
              {Array.from({ length: TOTAL_BEATS / 4 }, (_, index) => <span key={index} style={{ left: `${(index * 4 / TOTAL_BEATS) * 100}%` }}>{index + 1}</span>)}
              <div className="playhead" style={{ left: `${(playheadBeat / TOTAL_BEATS) * 100}%` }} />
            </div>
          </div>
          {project.tracks.map((track, trackIndex) => {
            const scratchesOpen = drawerTrackId === track.id;
            return (
              <div className="track-block" key={track.id}>
                <div className={`track-row ${selectedTrackId === track.id ? 'selected' : ''}`}>
                  <div className="track-controls" onClick={() => setSelectedTrackId(track.id)}>
                    <button className="scratch-plus" aria-label={`Open ${track.name} scratches`} onClick={(event) => { event.stopPropagation(); setDrawerTrackId(scratchesOpen ? null : track.id); }}>+</button>
                    <span className="track-number">{String(trackIndex + 1).padStart(2, '0')}</span><strong>{track.name}</strong>
                    <div className="track-mini-actions"><button className={track.muted ? 'active' : ''} onClick={(event) => { event.stopPropagation(); updateTrack(track.id, (current) => ({ ...current, muted: !current.muted })); }}>M</button><button className={track.solo ? 'active' : ''} onClick={(event) => { event.stopPropagation(); updateTrack(track.id, (current) => ({ ...current, solo: !current.solo })); }}>S</button></div>
                  </div>
                  <div className="timeline-lane" data-track-id={track.id}>
                    <div className="beat-grid" />
                    {project.loop.enabled && <div className="lane-loop-region" style={{ left: `${(project.loop.startBeat / TOTAL_BEATS) * 100}%`, width: `${((project.loop.endBeat - project.loop.startBeat) / TOTAL_BEATS) * 100}%` }} />}
                    <div className="lane-playhead" style={{ left: `${(playheadBeat / TOTAL_BEATS) * 100}%` }} />
                    {project.clips.filter((clip) => clip.trackId === track.id).map((clip) => {
                      const scratch = track.scratches.find((item) => item.id === clip.scratchId);
                      if (!scratch) return null;
                      const patternLength = scratchLengthBeats(track, scratch, project.bpm);
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
                      {track.scratches.length < MAX_SCRATCHES && <button className="new-scratch-card" onClick={() => createScratch(track)}>+ New scratch</button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <footer className="footer-line"><span>Local-first · audio stays in your browser until you sync it</span><span>Scratchtrack v0.4</span></footer>
      {dragGhost && <div className="drag-ghost" style={{ transform: `translate(${dragGhost.x + 14}px, ${dragGhost.y + 14}px)` }}>{dragGhost.label}</div>}
    </div>
  );
}

function Control({ label, value, min, max, step, onChange, suffix = '' }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; suffix?: string }) {
  return <label className="touch-control"><span>{label}</span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /><output>{Number(value).toFixed(step < 0.1 ? 2 : 0)}{suffix}</output></label>;
}

function DrumEditor({ track, updateScratch, onCreateScratch, bpm }: { track: Track; updateScratch: (trackId: string, scratchId: string, mutator: (scratch: Scratch) => Scratch) => void; onCreateScratch: () => void; bpm: number }) {
  const scratch = activeScratch(track);
  const [previewing, setPreviewing] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'geometry'>(() => localStorage.getItem('scratchtrack.drumView') === 'geometry' ? 'geometry' : 'grid');
  const timerRef = useRef<number | null>(null);
  const stepRef = useRef(0);
  const pattern = scratch?.drumPattern ?? makeBlankPattern();
  const settings = scratch?.drumSettings ?? defaultDrumSettings;

  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); }, []);
  useEffect(() => { localStorage.setItem('scratchtrack.drumView', viewMode); }, [viewMode]);
  if (!scratch) return <button className="empty-editor" onClick={onCreateScratch}>Create the first drum scratch</button>;

  const cycle = (row: number, step: number) => updateScratch(track.id, scratch.id, (current) => {
    const next = (current.drumPattern ?? makeBlankPattern()).map((lane) => [...lane] as DrumCell[]);
    next[row][step] = ((next[row][step] + 1) % 3) as DrumCell;
    return { ...current, drumPattern: next };
  });
  const settingsField = <K extends keyof DrumSettings>(key: K, value: DrumSettings[K]) => updateScratch(track.id, scratch.id, (current) => ({ ...current, drumSettings: { ...(current.drumSettings ?? defaultDrumSettings), [key]: value } }));

  const preview = () => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; setPreviewing(false); return; }
    stepRef.current = 0; playDrumStep(pattern, 0, scratch.drumKit, settings);
    const ms = (60_000 / bpm) / 4;
    timerRef.current = window.setInterval(() => {
      stepRef.current = (stepRef.current + 1) % 16;
      const delay = stepRef.current % 2 ? ms * 0.48 * settings.swing : 0;
      window.setTimeout(() => playDrumStep(pattern, stepRef.current, scratch.drumKit, settings), delay + settings.humanize * Math.random() * 13);
    }, ms);
    setPreviewing(true);
  };

  return (
    <div className="drum-editor">
      <div className="editor-toolbar">
        <label>Kit<select value={scratch.drumKit ?? 'Pocket'} onChange={(event) => updateScratch(track.id, scratch.id, (current) => ({ ...current, drumKit: event.target.value }))}><option>Pocket</option><option>Dust</option><option>Machine</option></select></label>
        <div className="drum-view-toggle" role="group" aria-label="Drum sequencer view">
          <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}>Grid</button>
          <button className={viewMode === 'geometry' ? 'active' : ''} onClick={() => setViewMode('geometry')}>Geometry</button>
        </div>
        <button className={previewing ? 'active' : ''} onClick={preview}>{previewing ? 'Stop pattern' : 'Preview pattern'}</button>
        <button onClick={() => updateScratch(track.id, scratch.id, (current) => ({ ...current, drumPattern: makeBlankPattern() }))}>Clear</button>
        <button onClick={onCreateScratch}>Duplicate → scratch</button>
      </div>
      <div className="control-bank drum-bank">
        <Control label="Swing" value={settings.swing} min={0} max={1} step={0.01} onChange={(value) => settingsField('swing', value)} />
        <Control label="Human" value={settings.humanize} min={0} max={1} step={0.01} onChange={(value) => settingsField('humanize', value)} />
        <Control label="Output" value={settings.output} min={0.2} max={1.2} step={0.01} onChange={(value) => settingsField('output', value)} />
        <Control label="Punch" value={settings.punch} min={0} max={1} step={0.01} onChange={(value) => settingsField('punch', value)} />
        <Control label="Bright" value={settings.brightness} min={0} max={1} step={0.01} onChange={(value) => settingsField('brightness', value)} />
      </div>
      {viewMode === 'grid'
        ? <div className="step-grid">{DRUM_NAMES.map((name, row) => <div className="step-row" key={name}><span>{name}</span><div className="steps">{pattern[row].map((cell, step) => <button key={step} aria-label={`${name} step ${step + 1}`} className={`step level-${cell} ${step % 4 === 0 ? 'bar-step' : ''}`} onPointerDown={(event) => { event.preventDefault(); cycle(row, step); }}><i /></button>)}</div></div>)}</div>
        : <DrumGeometry names={DRUM_NAMES} pattern={pattern} onCycle={cycle} />}
      <p className="editor-hint">Grid and Geometry edit the exact same pattern. Tap a step/node to cycle hit → accent → clear; switch views whenever a different way of seeing the rhythm helps.</p>
    </div>
  );
}

function SynthEditor({ track, updateScratch, writeMotif, setWriteMotif }: { track: Track; updateScratch: (trackId: string, scratchId: string, mutator: (scratch: Scratch) => Scratch) => void; writeMotif: boolean; setWriteMotif: (value: boolean) => void }) {
  const scratch = activeScratch(track);
  if (!scratch) return <div className="empty-editor">Open the scratch drawer and create a synth scratch.</div>;
  const patch = scratch.synthPatch ?? defaultPatch;
  const notes = scratch.synthNotes ?? [];
  const patchField = <K extends keyof SynthPatch>(key: K, value: SynthPatch[K]) => updateScratch(track.id, scratch.id, (current) => ({ ...current, synthPatch: { ...(current.synthPatch ?? defaultPatch), [key]: value } }));
  const hitKey = (midi: number) => {
    playSynthNote(midi, patch);
    if (!writeMotif) return;
    updateScratch(track.id, scratch.id, (current) => {
      const currentNotes = current.synthNotes ?? [];
      const startBeat = currentNotes.length ? Math.min(7.75, currentNotes[currentNotes.length - 1].startBeat + 0.5) : 0;
      return { ...current, synthNotes: [...currentNotes, { id: uid(), midi, startBeat, lengthBeats: 0.5 }] };
    });
  };

  return (
    <div className="synth-editor">
      <div className="synth-controls">
        <label>OSC A<select value={patch.oscA} onChange={(event) => patchField('oscA', event.target.value as SynthPatch['oscA'])}><option value="sawtooth">Saw</option><option value="square">Square</option><option value="triangle">Triangle</option><option value="sine">Sine</option></select></label>
        <label>OSC B<select value={patch.oscB} onChange={(event) => patchField('oscB', event.target.value as SynthPatch['oscB'])}><option value="square">Square</option><option value="sawtooth">Saw</option><option value="triangle">Triangle</option><option value="sine">Sine</option></select></label>
      </div>
      <div className="control-bank synth-bank">
        <Control label="Mix" value={patch.oscMix} min={0} max={1} step={0.01} onChange={(value) => patchField('oscMix', value)} />
        <Control label="Detune" value={patch.detune} min={-24} max={24} step={1} onChange={(value) => patchField('detune', value)} suffix="¢" />
        <Control label="Cutoff" value={patch.cutoff} min={180} max={9000} step={10} onChange={(value) => patchField('cutoff', value)} />
        <Control label="Reso" value={patch.resonance} min={0.1} max={12} step={0.1} onChange={(value) => patchField('resonance', value)} />
        <Control label="Attack" value={patch.attack} min={0.005} max={1} step={0.005} onChange={(value) => patchField('attack', value)} />
        <Control label="Sustain" value={patch.sustain} min={0.05} max={1} step={0.01} onChange={(value) => patchField('sustain', value)} />
        <Control label="Release" value={patch.release} min={0.05} max={2} step={0.01} onChange={(value) => patchField('release', value)} />
        <Control label="Drive" value={patch.drive} min={0} max={1} step={0.01} onChange={(value) => patchField('drive', value)} />
        <Control label="LFO rate" value={patch.lfoRate} min={0.1} max={12} step={0.1} onChange={(value) => patchField('lfoRate', value)} />
        <Control label="LFO depth" value={patch.lfoDepth} min={0} max={1} step={0.01} onChange={(value) => patchField('lfoDepth', value)} />
      </div>
      <div className="motif-row"><button className={`toggle-button ${writeMotif ? 'active' : ''}`} onClick={() => setWriteMotif(!writeMotif)}>{writeMotif ? 'Writing motif' : 'Write motif'}</button><div className="motif-notes">{notes.length ? notes.map((note) => <button key={note.id} onClick={() => updateScratch(track.id, scratch.id, (current) => ({ ...current, synthNotes: (current.synthNotes ?? []).filter((item) => item.id !== note.id) }))}>{noteName(note.midi)}</button>) : <span>Tap Write motif, then play notes.</span>}</div>{notes.length > 0 && <button onClick={() => updateScratch(track.id, scratch.id, (current) => ({ ...current, synthNotes: [] }))}>Clear</button>}</div>
      <div className="keyboard" aria-label="Synth keyboard">{SYNTH_KEYS.map((midi) => <button key={midi} onPointerDown={(event) => { event.preventDefault(); hitKey(midi); }}><span>{noteName(midi)}</span></button>)}</div>
    </div>
  );
}

function AudioEditor({
  track,
  updateTrack,
  recording,
  recordingPhase,
  loopTakeCount,
  disabled,
  onRecord,
  loopEnabled,
  autoScratch,
}: {
  track: Track;
  updateTrack: (trackId: string, mutator: (track: Track) => Track) => void;
  recording: boolean;
  recordingPhase: RecordingPhase;
  loopTakeCount: number;
  disabled: boolean;
  onRecord: () => void;
  loopEnabled: boolean;
  autoScratch: boolean;
}) {
  const settings = track.settings ?? defaultChannelSettings;
  const scratch = activeScratch(track);
  const field = (key: keyof typeof settings, value: number | boolean) => updateTrack(track.id, (current) => ({ ...current, settings: { ...(current.settings ?? defaultChannelSettings), [key]: value } }));

  const phaseTitle = recordingPhase === 'warmup'
    ? 'Warm-up pass — playback only'
    : recordingPhase === 'auto'
      ? `Auto Scratch · ${loopTakeCount}/${MAX_LOOP_TAKES} saved`
      : recordingPhase === 'recording'
        ? 'Recording with the arrangement'
        : loopEnabled && autoScratch
          ? 'Warm-up first, then Auto Scratch'
          : track.kind === 'bass' ? 'Clean DI first' : 'Capture first';

  const phaseText = recordingPhase === 'warmup'
    ? 'Nothing is recorded on the first trip through the loop. Capture starts automatically when the loop returns to the In point.'
    : recordingPhase === 'auto'
      ? `Every completed loop becomes a separate Scratch. This session stops automatically after ${MAX_LOOP_TAKES} takes.`
      : recordingPhase === 'recording'
        ? 'The Record button now drives the same playback transport, so you hear the arrangement while capturing.'
        : loopEnabled && autoScratch
          ? `Record starts the arrangement, gives you one warm-up pass, then can stack up to ${MAX_LOOP_TAKES} loop takes automatically.`
          : track.kind === 'bass' ? 'Record a compact mono DI and shape it non-destructively for playback.' : 'Capture a compact mono source and keep the original recording untouched.';

  return (
    <div className="audio-editor">
      <div className="record-zone">
        <button className={`record-button ${recording ? 'recording' : ''}`} disabled={disabled} onClick={onRecord}><i />{recording ? recordingPhase === 'warmup' ? 'Cancel warm-up' : 'Stop recording' : loopEnabled ? 'Record loop' : 'Record new scratch'}</button>
        <div><strong>{phaseTitle}</strong><p>{phaseText}</p></div>
      </div>
      <div className="control-bank audio-bank">
        <Control label="Trim" value={settings.inputGain} min={0} max={1} step={0.01} onChange={(value) => field('inputGain', value)} />
        <Control label={track.kind === 'bass' ? 'Body / bite' : 'Tone'} value={settings.tone} min={0} max={1} step={0.01} onChange={(value) => field('tone', value)} />
        <Control label="Comp" value={settings.compression} min={0} max={1} step={0.01} onChange={(value) => field('compression', value)} />
        <Control label="Volume" value={settings.volume} min={0} max={1.2} step={0.01} onChange={(value) => field('volume', value)} />
        <Control label="Pan" value={settings.pan} min={-1} max={1} step={0.01} onChange={(value) => field('pan', value)} />
        <Control label="Space" value={settings.reverb} min={0} max={1} step={0.01} onChange={(value) => field('reverb', value)} />
      </div>
      <div className={`input-meter ${recordingPhase !== 'idle' ? 'live' : ''}`} aria-label="Input activity"><i /><i /><i /><i /><i /><i /><i /><i /></div>
      <WaveformDisplay scratch={scratch} />
      <p className="editor-hint">Select a Scratch in the drawer to inspect its waveform here. The stored source remains clean while track controls shape playback.</p>
    </div>
  );
}
