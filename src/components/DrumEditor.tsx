import { useEffect, useRef, useState } from 'react';
import { playDrumStep } from '../audio';
import { DRUM_KITS, defaultDrumSettings } from '../project';
import { SUBDIVISIONS, stepsPerBar, stepBeats } from '../music';
import type { DrumCell, DrumSettings, Scratch, Subdivision, TimeSignature, Track } from '../types';
import { ScratchActionStrip, Control } from './Control';
import DrumGeometry from '../DrumGeometry';

const DRUM_NAMES = ['Kick', 'Snare', 'Hat', 'Open'];

function blankRows(steps: number): DrumCell[][] {
  return Array.from({ length: 4 }, () => Array.from({ length: steps }, () => 0 as DrumCell));
}

/** Swing delays every second step (binary grids) or the third step (triplet grids). */
function swingApplies(subdivision: Subdivision, step: number): boolean {
  return subdivision.includes('t') ? step % 3 === 2 : step % 2 === 1;
}

export default function DrumEditor({ track, updateScratch, meter, bpm, onNewScratch, onDuplicateScratch, onPlaceActive }: {
  track: Track;
  updateScratch: (trackId: string, scratchId: string, mutator: (scratch: Scratch) => Scratch) => void;
  meter: TimeSignature;
  bpm: number;
  onNewScratch: () => void;
  onDuplicateScratch: () => void;
  onPlaceActive: () => void;
}) {
  const scratch = track.scratches.find((item) => item.id === track.activeScratchId) ?? track.scratches[0];
  const [previewing, setPreviewing] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'geometry'>(() => localStorage.getItem('scratchtrack.drumView') === 'geometry' ? 'geometry' : 'grid');
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); }, []);
  useEffect(() => { localStorage.setItem('scratchtrack.drumView', viewMode); }, [viewMode]);
  // Stop preview whenever a different scratch becomes active.
  useEffect(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
      setPreviewing(false);
    }
  }, [scratch?.id]);

  if (!scratch) {
    return (
      <div className="drum-editor">
        <ScratchActionStrip canDuplicate={false} placeDisabled onNew={onNewScratch} onPlace={() => undefined} />
        <button className="empty-editor" onClick={onNewScratch}>Create the first drum scratch</button>
      </div>
    );
  }

  const subdivision = scratch.drumSubdivision ?? '1/16';
  const steps = stepsPerBar(meter, subdivision) ?? 16;
  const pattern = scratch.drumPattern?.[0]?.length === steps ? scratch.drumPattern : blankRows(steps);
  const settings = scratch.drumSettings ?? defaultDrumSettings;
  // Beat markers land once per notated beat: numerator markers around the ring.
  const stepsPerBeat = Math.max(1, Math.round(steps / meter.numerator));

  const cycle = (row: number, step: number) => updateScratch(track.id, scratch.id, (current) => {
    const source = current.drumPattern?.[0]?.length === steps ? current.drumPattern : blankRows(steps);
    const next = source.map((lane) => [...lane] as DrumCell[]);
    next[row][step] = ((next[row][step] + 1) % 3) as DrumCell;
    return { ...current, drumPattern: next };
  });

  const changeSubdivision = (nextSubdivision: Subdivision) => updateScratch(track.id, scratch.id, (current) => {
    const targetSteps = stepsPerBar(meter, nextSubdivision);
    if (!targetSteps) return current;
    const previousSubdivision = current.drumSubdivision ?? '1/16';
    const fromSteps = current.drumPattern?.[0]?.length ?? stepsPerBar(meter, previousSubdivision) ?? 16;
    let drumPattern = current.drumPattern;
    if (drumPattern && fromSteps !== targetSteps) {
      // Preserve musical timing: move each hit to the closest equivalent position.
      drumPattern = drumPattern.map((row) => {
        const targetRow = Array.from({ length: targetSteps }, () => 0 as DrumCell);
        row.forEach((cell, index) => {
          if (!cell) return;
          const position = (index / fromSteps) * targetSteps;
          const mapped = Math.min(targetSteps - 1, Math.max(0, Math.floor(position + 0.5)));
          targetRow[mapped] = Math.max(targetRow[mapped], cell) as DrumCell;
        });
        return targetRow;
      });
    }
    return { ...current, drumSubdivision: nextSubdivision, drumPattern };
  });

  const clearPattern = () => updateScratch(track.id, scratch.id, (current) => ({ ...current, drumPattern: blankRows(steps) }));

  const settingsField = <K extends keyof DrumSettings>(key: K, value: DrumSettings[K]) =>
    updateScratch(track.id, scratch.id, (current) => ({ ...current, drumSettings: { ...(current.drumSettings ?? defaultDrumSettings), [key]: value } }));

  const preview = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
      setPreviewing(false);
      return;
    }
    const msPerStep = (60_000 / bpm) * stepBeats(subdivision);
    let step = 0;
    playDrumStep(pattern, 0, scratch.drumKit, settings);
    timerRef.current = window.setInterval(() => {
      step = (step + 1) % steps;
      const baseDelay = swingApplies(subdivision, step) ? msPerStep * 0.48 * settings.swing : 0;
      const humanDelay = settings.humanize * Math.random() * 13;
      window.setTimeout(() => playDrumStep(pattern, step, scratch.drumKit, settings), baseDelay + humanDelay);
    }, msPerStep);
    setPreviewing(true);
  };

  const validOptions = SUBDIVISIONS.map((option) => ({ ...option, disabled: !stepsPerBar(meter, option.value) }));

  return (
    <div className="drum-editor">
      <ScratchActionStrip
        canDuplicate
        placeDisabled={false}
        onNew={onNewScratch}
        onDuplicate={onDuplicateScratch}
        onPlace={onPlaceActive}
      />
      <div className="editor-toolbar">
        <label>Kit
          <select value={scratch.drumKit ?? 'Pocket'} onChange={(event) => updateScratch(track.id, scratch.id, (current) => ({ ...current, drumKit: event.target.value }))}>
            {DRUM_KITS.map((kit) => <option key={kit}>{kit}</option>)}
          </select>
        </label>
        <label>Subdivision
          <select value={subdivision} onChange={(event) => changeSubdivision(event.target.value as Subdivision)} aria-label="Drum subdivision">
            {validOptions.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}{!option.disabled ? ` · ${stepsPerBar(meter, option.value)}` : ''}</option>
            ))}
          </select>
        </label>
        <div className="drum-view-toggle" role="group" aria-label="Drum sequencer view">
          <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}>Grid</button>
          <button className={viewMode === 'geometry' ? 'active' : ''} onClick={() => setViewMode('geometry')}>Geometry</button>
        </div>
        <button className={previewing ? 'active' : ''} onClick={preview}>{previewing ? 'Stop pattern' : 'Preview pattern'}</button>
        <button onClick={clearPattern}>Clear</button>
      </div>
      <div className="control-bank drum-bank">
        <Control label="Swing" value={settings.swing} min={0} max={1} step={0.01} onChange={(value) => settingsField('swing', value)} />
        <Control label="Human" value={settings.humanize} min={0} max={1} step={0.01} onChange={(value) => settingsField('humanize', value)} />
        <Control label="Output" value={settings.output} min={0.2} max={1.2} step={0.01} onChange={(value) => settingsField('output', value)} />
        <Control label="Punch" value={settings.punch} min={0} max={1} step={0.01} onChange={(value) => settingsField('punch', value)} />
        <Control label="Bright" value={settings.brightness} min={0} max={1} step={0.01} onChange={(value) => settingsField('brightness', value)} />
      </div>
      {viewMode === 'grid' ? (
        <div className="step-grid">
          {DRUM_NAMES.map((name, row) => (
            <div className="step-row" key={name}>
              <span>{name}</span>
              <div className="steps" style={{ gridTemplateColumns: `repeat(${steps}, minmax(26px, 1fr))`, minWidth: `${Math.min(1100, 60 + steps * 30)}px` }}>
                {pattern[row].map((cell, step) => (
                  <button
                    key={step}
                    aria-label={`${name} step ${step + 1}`}
                    className={`step level-${cell} ${step % stepsPerBeat === 0 ? 'bar-step' : ''}`}
                    onPointerDown={(event) => { event.preventDefault(); cycle(row, step); }}
                  ><i /></button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <DrumGeometry names={DRUM_NAMES} pattern={pattern} stepsPerBar={steps} stepsPerBeat={stepsPerBeat} onCycle={cycle} />
      )}
      <p className="editor-hint">{steps} steps per bar · Grid and Geometry edit the exact same pattern. Tap a step/node to cycle hit → accent → clear.</p>
    </div>
  );
}
