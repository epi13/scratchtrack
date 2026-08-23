import type { RecordingPhase } from '../recording';
import { defaultChannelSettings } from '../project';
import type { ChannelSettings, Track } from '../types';
import { Control, ScratchActionStrip } from './Control';
import WaveformDisplay from '../WaveformDisplay';

export default function AudioEditor({
  track,
  updateTrack,
  recording,
  recordingPhase,
  loopTakeCount,
  disabled,
  onRecord,
  loopEnabled,
  autoScratch,
  maxLoopTakes,
  onNewScratch,
  onDuplicateScratch,
  onPlaceActive,
  placeDisabled,
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
  maxLoopTakes: number;
  onNewScratch: () => void;
  onDuplicateScratch: () => void;
  onPlaceActive: () => void;
  placeDisabled: boolean;
}) {
  const settings = track.settings ?? defaultChannelSettings;
  const scratch = track.scratches.find((item) => item.id === track.activeScratchId) ?? track.scratches[0];
  const field = (key: keyof ChannelSettings, value: number | boolean) =>
    updateTrack(track.id, (current) => ({ ...current, settings: { ...(current.settings ?? defaultChannelSettings), [key]: value } }));

  const phaseTitle = recordingPhase === 'warmup'
    ? 'Warm-up pass — playback only'
    : recordingPhase === 'auto'
      ? `Auto Scratch · ${loopTakeCount}/${maxLoopTakes} saved`
      : recordingPhase === 'recording'
        ? 'Recording with the arrangement'
        : loopEnabled && autoScratch
          ? 'Warm-up first, then Auto Scratch'
          : track.kind === 'bass' ? 'Clean DI first' : 'Capture first';

  const phaseText = recordingPhase === 'warmup'
    ? 'Nothing is recorded on the first trip through the loop. Capture starts automatically when the loop returns to the In point.'
    : recordingPhase === 'auto'
      ? `Every completed loop becomes a separate Scratch. This session stops automatically after ${maxLoopTakes} takes.`
      : recordingPhase === 'recording'
        ? scratch && !scratch.audioBlobId
          ? `Filling the selected blank Scratch “${scratch.name}”.`
          : 'The Record button drives the same playback transport, so you hear the arrangement while capturing.'
        : loopEnabled && autoScratch
          ? `Record starts the arrangement, gives you one warm-up pass, then can stack up to ${maxLoopTakes} loop takes automatically.`
          : 'Record fills the selected blank Scratch if there is one; otherwise it creates a fresh take.';

  return (
    <div className="audio-editor">
      <div className="audio-editor-main">
        <ScratchActionStrip
          canDuplicate={false}
          placeDisabled={placeDisabled}
          placeHint={placeDisabled ? 'This blank Scratch has no audio yet — record it first.' : undefined}
          onNew={onNewScratch}
          onDuplicate={onDuplicateScratch}
          onPlace={onPlaceActive}
        />
        <div className="record-zone">
          <button className={`record-button ${recording ? 'recording' : ''}`} disabled={disabled} onClick={onRecord}>
            <i />{recording ? recordingPhase === 'warmup' ? 'Cancel warm-up' : 'Stop recording' : loopEnabled ? 'Record loop' : 'Record new scratch'}
          </button>
          <div><strong>{phaseTitle}</strong><p>{phaseText}</p></div>
        </div>
        <div className={`input-meter ${recordingPhase !== 'idle' ? 'live' : ''}`} aria-label="Input activity"><i /><i /><i /><i /><i /><i /><i /><i /></div>
        <WaveformDisplay scratch={scratch} />
        <p className="editor-hint">Select a Scratch in the drawer to inspect its waveform. The stored source stays clean while these controls shape playback.</p>
      </div>
      <div className="control-bank audio-bank">
        <Control label="Trim" value={settings.inputGain} min={0} max={1} step={0.01} onChange={(value) => field('inputGain', value)} />
        <Control label={track.kind === 'bass' ? 'Body / bite' : 'Tone'} value={settings.tone} min={0} max={1} step={0.01} onChange={(value) => field('tone', value)} />
        <Control label="Comp" value={settings.compression} min={0} max={1} step={0.01} onChange={(value) => field('compression', value)} />
        <button
          className={`toggle-button multi-stage-toggle ${settings.multiStage ? 'active' : ''}`}
          onClick={() => field('multiStage', !settings.multiStage)}
          aria-pressed={Boolean(settings.multiStage)}
          title="Serial peak → glue → safety compression instead of one compressor"
        >Multi-stage comp {settings.multiStage ? 'On' : 'Off'}</button>
        <Control label="Volume" value={settings.volume} min={0} max={1.2} step={0.01} onChange={(value) => field('volume', value)} />
        <Control label="Pan" value={settings.pan} min={-1} max={1} step={0.01} onChange={(value) => field('pan', value)} />
        <Control label="Space" value={settings.reverb} min={0} max={1} step={0.01} onChange={(value) => field('reverb', value)} />
      </div>
    </div>
  );
}
