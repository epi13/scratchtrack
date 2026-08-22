import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { playDrumStep, playMetronome, playSynthNote } from './audio';
import { connectDrive, isDriveConnected, syncProjectToDrive } from './drive';
import { defaultPatch, deleteAudioBlob, loadAudioBlob, loadProject, makeBlankPattern, saveAudioBlob, saveProject, uid } from './store';
import type { Clip, DrumCell, Scratch, ScratchtrackProject, SynthPatch, Track } from './types';

const TOTAL_BEATS = 64;
const DRUM_NAMES = ['Kick', 'Snare', 'Hat', 'Open'];
const SYNTH_KEYS = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72];
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

function noteName(midi: number) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function activeScratch(track: Track) {
  return track.scratches.find((s) => s.id === track.activeScratchId) ?? track.scratches[0];
}

function scratchLength(track: Track, scratch: Scratch) {
  if (track.kind === 'drum') return 4;
  if (track.kind === 'synth') {
    const end = Math.max(4, ...(scratch.synthNotes ?? []).map((n) => n.startBeat + n.lengthBeats));
    return Math.ceil(end / 4) * 4;
  }
  return 4;
}

export default function App() {
  const [project, setProject] = useState<ScratchtrackProject>(() => loadProject());
  const [selectedTrackId, setSelectedTrackId] = useState(project.tracks[0].id);
  const [drawerTrackId, setDrawerTrackId] = useState<string | null>(project.tracks[0].id);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadBeat, setPlayheadBeat] = useState(0);
  const playheadRef = useRef(0);
  const [metronome, setMetronome] = useState(false);
  const [recordingTrackId, setRecordingTrackId] = useState<string | null>(null);
  const [writeMotif, setWriteMotif] = useState(false);
  const [drivePanelOpen, setDrivePanelOpen] = useState(false);
  const [driveStatus, setDriveStatus] = useState<'local' | 'connecting' | 'connected' | 'syncing' | 'synced' | 'error'>('local');
  const [driveMessage, setDriveMessage] = useState('Saved locally');
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement[]>([]);

  const selectedTrack = useMemo(
    () => project.tracks.find((track) => track.id === selectedTrackId) ?? project.tracks[0],
    [project.tracks, selectedTrackId],
  );

  const commitProject = useCallback((mutator: (current: ScratchtrackProject) => ScratchtrackProject) => {
    setProject((current) => {
      const next = mutator(current);
      return { ...next, updatedAt: new Date().toISOString() };
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

  const placeScratch = useCallback((trackId: string, scratchId: string, startBeat = playheadRef.current) => {
    const track = project.tracks.find((item) => item.id === trackId);
    const scratch = track?.scratches.find((item) => item.id === scratchId);
    if (!track || !scratch) return;
    const snapped = Math.max(0, Math.min(TOTAL_BEATS - 1, Math.round(startBeat)));
    const clip: Clip = { id: uid(), trackId, scratchId, startBeat: snapped, lengthBeats: scratchLength(track, scratch) };
    commitProject((current) => ({ ...current, clips: [...current.clips, clip] }));
  }, [commitProject, project.tracks]);

  const createScratch = useCallback((track: Track) => {
    if (track.scratches.length >= 6) return;
    const source = activeScratch(track);
    const letter = String.fromCharCode(65 + track.scratches.length);
    const next: Scratch = {
      id: uid(),
      name: `Scratch ${letter}`,
      note: '',
      createdAt: new Date().toISOString(),
    };
    if (track.kind === 'drum') {
      next.drumPattern = source?.drumPattern?.map((row) => [...row] as DrumCell[]) ?? makeBlankPattern();
      next.drumKit = source?.drumKit ?? 'Pocket';
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
  }, [commitProject]);

  const auditionScratch = useCallback(async (track: Track, scratch: Scratch) => {
    if (track.kind === 'drum' && scratch.drumPattern) {
      let step = 0;
      const ms = (60_000 / project.bpm) / 4;
      playDrumStep(scratch.drumPattern, 0, scratch.drumKit);
      const timer = window.setInterval(() => {
        step += 1;
        if (step >= 16) return window.clearInterval(timer);
        playDrumStep(scratch.drumPattern!, step, scratch.drumKit);
      }, ms);
      return;
    }
    if (track.kind === 'synth' && scratch.synthPatch) {
      for (const note of scratch.synthNotes ?? []) {
        window.setTimeout(() => playSynthNote(note.midi, scratch.synthPatch!, (60 / project.bpm) * note.lengthBeats * 0.8), (60_000 / project.bpm) * note.startBeat);
      }
      return;
    }
    if (scratch.audioBlobId) {
      const blob = await loadAudioBlob(scratch.audioBlobId);
      if (!blob) return;
      const audio = new Audio(URL.createObjectURL(blob));
      audio.onended = () => URL.revokeObjectURL(audio.src);
      await audio.play();
    }
  }, [project.bpm]);

  const performStep = useCallback((beat: number) => {
    const anySolo = project.tracks.some((track) => track.solo);
    for (const track of project.tracks) {
      if (track.muted || (anySolo && !track.solo)) continue;
      const clips = project.clips.filter((clip) => clip.trackId === track.id && beat >= clip.startBeat && beat < clip.startBeat + clip.lengthBeats);
      for (const clip of clips) {
        const scratch = track.scratches.find((item) => item.id === clip.scratchId);
        if (!scratch) continue;
        const localBeat = beat - clip.startBeat;
        if (track.kind === 'drum' && scratch.drumPattern) {
          const step = Math.floor((localBeat % 4) * 4) % 16;
          playDrumStep(scratch.drumPattern, step, scratch.drumKit);
        } else if (track.kind === 'synth' && scratch.synthPatch) {
          for (const note of scratch.synthNotes ?? []) {
            const patternBeat = localBeat % Math.max(4, clip.lengthBeats);
            if (Math.abs(patternBeat - note.startBeat) < 0.02) playSynthNote(note.midi, scratch.synthPatch, (60 / project.bpm) * note.lengthBeats * 0.8);
          }
        } else if (scratch.audioBlobId && Math.abs(localBeat) < 0.02) {
          void loadAudioBlob(scratch.audioBlobId).then((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            activeAudioRef.current.push(audio);
            audio.onended = () => {
              activeAudioRef.current = activeAudioRef.current.filter((item) => item !== audio);
              URL.revokeObjectURL(url);
            };
            void audio.play();
          });
        }
      }
    }
    if (metronome && Math.abs(beat - Math.round(beat)) < 0.02) playMetronome(Math.round(beat) % project.beatsPerBar === 0);
  }, [metronome, project]);

  useEffect(() => {
    if (!isPlaying) return;
    const intervalMs = (60_000 / project.bpm) / 4;
    performStep(playheadRef.current);
    const timer = window.setInterval(() => {
      const next = playheadRef.current + 0.25 >= TOTAL_BEATS ? 0 : playheadRef.current + 0.25;
      playheadRef.current = next;
      setPlayheadBeat(next);
      performStep(next);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [isPlaying, performStep, project.bpm]);

  const stopTransport = useCallback(() => {
    setIsPlaying(false);
    activeAudioRef.current.forEach((audio) => { audio.pause(); audio.currentTime = 0; });
    activeAudioRef.current = [];
  }, []);

  const toggleRecording = useCallback(async (track: Track) => {
    if (recordingTrackId === track.id) {
      recorderRef.current?.stop();
      return;
    }
    if (recordingTrackId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const mimeCandidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
      const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 96000 } : undefined);
      recorderRef.current = recorder;
      recorderStreamRef.current = stream;
      recorderChunksRef.current = [];
      setRecordingTrackId(track.id);
      recorder.ondataavailable = (event) => { if (event.data.size) recorderChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(recorderChunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
        const blobId = uid();
        void saveAudioBlob(blobId, blob).then(() => {
          const letter = String.fromCharCode(65 + Math.min(track.scratches.length, 5));
          const scratch: Scratch = {
            id: uid(),
            name: track.scratches.length < 6 ? `Scratch ${letter}` : `Take ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            note: 'Recorded in browser',
            createdAt: new Date().toISOString(),
            audioBlobId: blobId,
            audioMimeType: blob.type,
          };
          updateTrack(track.id, (current) => {
            const scratches = current.scratches.length >= 6 ? [...current.scratches.slice(0, 5), scratch] : [...current.scratches, scratch];
            return { ...current, activeScratchId: scratch.id, scratches };
          });
          setDrawerTrackId(track.id);
        });
        stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
        recorderRef.current = null;
        recorderStreamRef.current = null;
        setRecordingTrackId(null);
      };
      recorder.start(250);
    } catch (error) {
      setDriveMessage(error instanceof Error ? error.message : 'Microphone permission failed.');
      setDriveStatus('error');
    }
  }, [recordingTrackId, updateTrack]);

  const handleScratchDrag = useCallback((event: ReactPointerEvent<HTMLElement>, track: Track, scratch: Scratch) => {
    event.preventDefault();
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

  const exportProject = useCallback(() => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'scratchtrack'}.scratchtrack.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [project]);

  const importProject = useCallback((file: File) => {
    void file.text().then((text) => {
      const next = JSON.parse(text) as ScratchtrackProject;
      if (next.format !== 'scratchtrack-project' || next.version !== 1) throw new Error('Not a Scratchtrack project file.');
      setProject(next);
      setSelectedTrackId(next.tracks[0].id);
      setDrawerTrackId(next.tracks[0].id);
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
      const result = await syncProjectToDrive(project, loadAudioBlob);
      const now = new Date().toISOString();
      commitProject((current) => ({ ...current, drive: { ...current.drive, ...result, lastSyncedAt: now } }));
      setDriveStatus('synced');
      setDriveMessage(`Drive synced · ${result.uploadedAudio} audio file${result.uploadedAudio === 1 ? '' : 's'}`);
    } catch (error) {
      setDriveStatus('error');
      setDriveMessage(error instanceof Error ? error.message : 'Drive sync failed.');
    }
  }, [commitProject, project]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Scratchtrack home">
          <span className="brand-mark">S/</span>
          <span>Scratchtrack</span>
        </div>
        <input
          className="project-title"
          value={project.title}
          aria-label="Project title"
          onChange={(event) => commitProject((current) => ({ ...current, title: event.target.value }))}
        />
        <div className="topbar-actions">
          <span className={`save-state ${driveStatus === 'error' ? 'error' : ''}`}>{driveMessage}</span>
          <button className="quiet-button" onClick={() => setDrivePanelOpen((value) => !value)}>Drive</button>
          <button className="primary-button" onClick={() => void syncDrive()}>Sync</button>
        </div>
      </header>

      {drivePanelOpen && (
        <section className="drive-panel">
          <div>
            <strong>Google Drive</strong>
            <p>The application is public; your music is not. OAuth stays in this browser and project data is uploaded directly to your Drive.</p>
          </div>
          <label>
            Google OAuth client ID
            <input
              defaultValue={localStorage.getItem('scratchtrack.googleClientId') ?? ''}
              placeholder="000000000000-…apps.googleusercontent.com"
              onBlur={(event) => localStorage.setItem('scratchtrack.googleClientId', event.target.value.trim())}
            />
          </label>
          <div className="drive-actions">
            <button className="quiet-button" onClick={exportProject}>Export project</button>
            <label className="quiet-button file-button">Import project<input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && importProject(event.target.files[0])} /></label>
            <button className="primary-button" onClick={() => void syncDrive()}>Connect & sync</button>
          </div>
        </section>
      )}

      <section className="transport">
        <button className="transport-main" onClick={() => setIsPlaying((value) => !value)} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? 'Ⅱ' : '▶'}</button>
        <button className="transport-stop" onClick={stopTransport} aria-label="Stop">■</button>
        <label className="bpm-control">BPM<input type="number" min="40" max="240" value={project.bpm} onChange={(event) => commitProject((current) => ({ ...current, bpm: Math.min(240, Math.max(40, Number(event.target.value) || 40)) }))} /></label>
        <button className={`toggle-button ${metronome ? 'active' : ''}`} onClick={() => setMetronome((value) => !value)}>Metronome</button>
        <span className="position-readout">{Math.floor(playheadBeat / project.beatsPerBar) + 1}.{Math.floor(playheadBeat % project.beatsPerBar) + 1}</span>
        <input className="transport-scrubber" aria-label="Playhead" type="range" min="0" max={TOTAL_BEATS} step="0.25" value={playheadBeat} onChange={(event) => { const value = Number(event.target.value); playheadRef.current = value; setPlayheadBeat(value); }} />
      </section>

      <section className="editor-panel">
        <div className="editor-heading">
          <div><span className="track-index">{project.tracks.indexOf(selectedTrack) + 1}</span><h2>{selectedTrack.name}</h2></div>
          <span>{selectedTrack.kind === 'drum' ? 'Pattern sequencer' : selectedTrack.kind === 'synth' ? 'Analog sketch synth' : selectedTrack.kind === 'bass' ? 'DI capture' : 'Audio capture'}</span>
        </div>
        {selectedTrack.kind === 'drum' && (
          <DrumEditor track={selectedTrack} updateScratch={updateScratch} onCreateScratch={() => createScratch(selectedTrack)} bpm={project.bpm} />
        )}
        {selectedTrack.kind === 'synth' && (
          <SynthEditor track={selectedTrack} updateScratch={updateScratch} writeMotif={writeMotif} setWriteMotif={setWriteMotif} />
        )}
        {(selectedTrack.kind === 'bass' || selectedTrack.kind === 'audio') && (
          <AudioEditor track={selectedTrack} recording={recordingTrackId === selectedTrack.id} disabled={Boolean(recordingTrackId && recordingTrackId !== selectedTrack.id)} onRecord={() => void toggleRecording(selectedTrack)} />
        )}
      </section>

      <section className="timeline-section">
        <div className="timeline-title-row">
          <div><h2>Arrangement</h2><span>Drag a scratch into its lane, or tap Place.</span></div>
          <span>{project.clips.length} clip{project.clips.length === 1 ? '' : 's'} · {project.tracks.reduce((sum, track) => sum + track.scratches.length, 0)} scratches</span>
        </div>
        <div className="timeline-scroll">
          <div className="ruler-row">
            <div className="ruler-label">Tracks</div>
            <div className="ruler">
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
                    <span className="track-number">{String(trackIndex + 1).padStart(2, '0')}</span>
                    <strong>{track.name}</strong>
                    <div className="track-mini-actions">
                      <button className={track.muted ? 'active' : ''} onClick={(event) => { event.stopPropagation(); updateTrack(track.id, (current) => ({ ...current, muted: !current.muted })); }}>M</button>
                      <button className={track.solo ? 'active' : ''} onClick={(event) => { event.stopPropagation(); updateTrack(track.id, (current) => ({ ...current, solo: !current.solo })); }}>S</button>
                    </div>
                  </div>
                  <div className="timeline-lane" data-track-id={track.id} onClick={() => setSelectedTrackId(track.id)}>
                    <div className="beat-grid" />
                    <div className="lane-playhead" style={{ left: `${(playheadBeat / TOTAL_BEATS) * 100}%` }} />
                    {project.clips.filter((clip) => clip.trackId === track.id).map((clip) => {
                      const scratch = track.scratches.find((item) => item.id === clip.scratchId);
                      if (!scratch) return null;
                      return (
                        <button
                          key={clip.id}
                          className={`timeline-clip ${track.kind}`}
                          style={{ left: `${(clip.startBeat / TOTAL_BEATS) * 100}%`, width: `${Math.max(2.2, (clip.lengthBeats / TOTAL_BEATS) * 100)}%` }}
                          onClick={(event) => { event.stopPropagation(); void auditionScratch(track, scratch); }}
                          title="Tap to audition"
                        >
                          <span>{scratch.name}</span>
                          <i onClick={(event) => { event.stopPropagation(); commitProject((current) => ({ ...current, clips: current.clips.filter((item) => item.id !== clip.id) })); }}>×</i>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {scratchesOpen && (
                  <div className="scratch-drawer">
                    <div className="scratch-drawer-head"><strong>{track.name} scratches</strong><span>{track.scratches.length}/6 variations</span></div>
                    <div className="scratch-list">
                      {track.scratches.map((scratch) => (
                        <article
                          className={`scratch-card ${track.activeScratchId === scratch.id ? 'active' : ''}`}
                          key={scratch.id}
                          onPointerDown={(event) => handleScratchDrag(event, track, scratch)}
                        >
                          <button className="scratch-name" onClick={(event) => { event.stopPropagation(); updateTrack(track.id, (current) => ({ ...current, activeScratchId: scratch.id })); setSelectedTrackId(track.id); }}>{scratch.name}</button>
                          <input value={scratch.note} placeholder="Add a note…" onPointerDown={(event) => event.stopPropagation()} onChange={(event) => updateScratch(track.id, scratch.id, (current) => ({ ...current, note: event.target.value }))} />
                          <div className="scratch-card-actions" onPointerDown={(event) => event.stopPropagation()}>
                            <button onClick={() => void auditionScratch(track, scratch)}>Hear</button>
                            <button onClick={() => placeScratch(track.id, scratch.id)}>Place</button>
                            <button className="danger" onClick={() => void deleteScratch(track, scratch)}>×</button>
                          </div>
                        </article>
                      ))}
                      {track.scratches.length < 6 && <button className="new-scratch-card" onClick={() => createScratch(track)}>+ New scratch</button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <footer className="footer-line"><span>Local-first · audio stays in your browser until you sync it</span><span>Scratchtrack v0.1</span></footer>
      {dragGhost && <div className="drag-ghost" style={{ transform: `translate(${dragGhost.x + 14}px, ${dragGhost.y + 14}px)` }}>{dragGhost.label}</div>}
    </div>
  );
}

function DrumEditor({ track, updateScratch, onCreateScratch, bpm }: { track: Track; updateScratch: (trackId: string, scratchId: string, mutator: (scratch: Scratch) => Scratch) => void; onCreateScratch: () => void; bpm: number }) {
  const scratch = activeScratch(track);
  const [previewing, setPreviewing] = useState(false);
  const timerRef = useRef<number | null>(null);
  const stepRef = useRef(0);
  const pattern = scratch?.drumPattern ?? makeBlankPattern();

  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); }, []);
  if (!scratch) return <button className="empty-editor" onClick={onCreateScratch}>Create the first drum scratch</button>;

  const cycle = (row: number, step: number) => {
    updateScratch(track.id, scratch.id, (current) => {
      const next = (current.drumPattern ?? makeBlankPattern()).map((lane) => [...lane] as DrumCell[]);
      next[row][step] = ((next[row][step] + 1) % 3) as DrumCell;
      return { ...current, drumPattern: next };
    });
  };

  const preview = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
      setPreviewing(false);
      return;
    }
    stepRef.current = 0;
    playDrumStep(pattern, 0, scratch.drumKit);
    timerRef.current = window.setInterval(() => {
      stepRef.current = (stepRef.current + 1) % 16;
      playDrumStep(pattern, stepRef.current, scratch.drumKit);
    }, (60_000 / bpm) / 4);
    setPreviewing(true);
  };

  return (
    <div className="drum-editor">
      <div className="editor-toolbar">
        <label>Kit<select value={scratch.drumKit ?? 'Pocket'} onChange={(event) => updateScratch(track.id, scratch.id, (current) => ({ ...current, drumKit: event.target.value }))}><option>Pocket</option><option>Dust</option><option>Machine</option></select></label>
        <button className={previewing ? 'active' : ''} onClick={preview}>{previewing ? 'Stop pattern' : 'Preview pattern'}</button>
        <button onClick={() => updateScratch(track.id, scratch.id, (current) => ({ ...current, drumPattern: makeBlankPattern() }))}>Clear</button>
        <button onClick={onCreateScratch}>Duplicate → scratch</button>
      </div>
      <div className="step-grid">
        {DRUM_NAMES.map((name, row) => (
          <div className="step-row" key={name}>
            <span>{name}</span>
            <div className="steps">
              {pattern[row].map((cell, step) => <button key={step} aria-label={`${name} step ${step + 1}`} className={`step level-${cell} ${step % 4 === 0 ? 'bar-step' : ''}`} onPointerDown={(event) => { event.preventDefault(); cycle(row, step); }}><i /></button>)}
            </div>
          </div>
        ))}
      </div>
      <p className="editor-hint">Tap once for a hit, twice for an accent, a third time to clear. Four voices, sixteen steps, no menu diving.</p>
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
      const startBeat = currentNotes.length ? Math.min(3.75, currentNotes[currentNotes.length - 1].startBeat + 0.5) : 0;
      return { ...current, synthNotes: [...currentNotes, { id: uid(), midi, startBeat, lengthBeats: 0.5 }] };
    });
  };

  return (
    <div className="synth-editor">
      <div className="synth-controls">
        <label>OSC A<select value={patch.oscA} onChange={(event) => patchField('oscA', event.target.value as SynthPatch['oscA'])}><option value="sawtooth">Saw</option><option value="square">Square</option><option value="triangle">Triangle</option><option value="sine">Sine</option></select></label>
        <label>OSC B<select value={patch.oscB} onChange={(event) => patchField('oscB', event.target.value as SynthPatch['oscB'])}><option value="square">Square</option><option value="sawtooth">Saw</option><option value="triangle">Triangle</option><option value="sine">Sine</option></select></label>
        <label>Mix<input type="range" min="0" max="1" step="0.01" value={patch.oscMix} onChange={(event) => patchField('oscMix', Number(event.target.value))} /></label>
        <label>Cutoff<input type="range" min="180" max="9000" step="10" value={patch.cutoff} onChange={(event) => patchField('cutoff', Number(event.target.value))} /></label>
        <label>Attack<input type="range" min="0.005" max="1" step="0.005" value={patch.attack} onChange={(event) => patchField('attack', Number(event.target.value))} /></label>
        <label>Release<input type="range" min="0.05" max="2" step="0.01" value={patch.release} onChange={(event) => patchField('release', Number(event.target.value))} /></label>
      </div>
      <div className="motif-row">
        <button className={`toggle-button ${writeMotif ? 'active' : ''}`} onClick={() => setWriteMotif(!writeMotif)}>{writeMotif ? 'Writing motif' : 'Write motif'}</button>
        <div className="motif-notes">{notes.length ? notes.map((note) => <button key={note.id} onClick={() => updateScratch(track.id, scratch.id, (current) => ({ ...current, synthNotes: (current.synthNotes ?? []).filter((item) => item.id !== note.id) }))}>{noteName(note.midi)}</button>) : <span>Tap Write motif, then play up to eight notes.</span>}</div>
        {notes.length > 0 && <button onClick={() => updateScratch(track.id, scratch.id, (current) => ({ ...current, synthNotes: [] }))}>Clear</button>}
      </div>
      <div className="keyboard" aria-label="Synth keyboard">
        {SYNTH_KEYS.map((midi) => <button key={midi} onPointerDown={(event) => { event.preventDefault(); hitKey(midi); }}><span>{noteName(midi)}</span></button>)}
      </div>
    </div>
  );
}

function AudioEditor({ track, recording, disabled, onRecord }: { track: Track; recording: boolean; disabled: boolean; onRecord: () => void }) {
  const [input, setInput] = useState(72);
  const [tone, setTone] = useState(54);
  const [compression, setCompression] = useState(38);
  return (
    <div className="audio-editor">
      <div className="record-zone">
        <button className={`record-button ${recording ? 'recording' : ''}`} disabled={disabled} onClick={onRecord}><i />{recording ? 'Stop recording' : 'Record new scratch'}</button>
        <div><strong>{track.kind === 'bass' ? 'Clean DI first' : 'Capture first'}</strong><p>{track.kind === 'bass' ? 'Record mono and keep the source clean. These controls are sketch settings, not destructive processing.' : 'Browser capture targets a compact mono recording appropriate for songwriting ideas.'}</p></div>
      </div>
      <div className="channel-strip">
        <label>Input<input type="range" min="0" max="100" value={input} onChange={(event) => setInput(Number(event.target.value))} /><span>{input}</span></label>
        <label>{track.kind === 'bass' ? 'Body / bite' : 'Tone'}<input type="range" min="0" max="100" value={tone} onChange={(event) => setTone(Number(event.target.value))} /><span>{tone}</span></label>
        <label>Compression<input type="range" min="0" max="100" value={compression} onChange={(event) => setCompression(Number(event.target.value))} /><span>{compression}</span></label>
        <div className="meter"><i style={{ height: `${Math.max(8, input * 0.76)}%` }} /></div>
      </div>
      <p className="editor-hint">The prototype records at the browser's supported compressed format, preferring Opus at 96 kbps and mono input.</p>
    </div>
  );
}
