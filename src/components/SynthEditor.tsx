import { useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { playSynthNote } from '../audio';
import { defaultPatch } from '../project';
import { NOTE_NAMES, SCALES, barBeats, noteName, padMidi, scaleIntervals } from '../music';
import type { Scratch, SynthPatch, TimeSignature, Track } from '../types';
import { Control, ScratchActionStrip } from './Control';
import MotifEditor from './MotifEditor';

const PAD_COUNT = 15;
const TONICS = NOTE_NAMES.map((name, index) => ({ name, value: index }));

function layoutHasOverrides(scratch: Scratch): boolean {
  return Boolean(scratch.keyLayout?.some((entry) => typeof entry === 'number'));
}

export default function SynthEditor({ track, updateScratch, meter, writeMotif, setWriteMotif, onNewScratch, onDuplicateScratch, onPlaceActive }: {
  track: Track;
  updateScratch: (trackId: string, scratchId: string, mutator: (scratch: Scratch) => Scratch) => void;
  meter: TimeSignature;
  writeMotif: boolean;
  setWriteMotif: (value: boolean) => void;
  onNewScratch: () => void;
  onDuplicateScratch: () => void;
  onPlaceActive: () => void;
}) {
  const scratch = track.scratches.find((item) => item.id === track.activeScratchId) ?? track.scratches[0];
  const [cursorBeat, setCursorBeat] = useState(0);
  const [editingPad, setEditingPad] = useState<number | null>(null);

  if (!scratch) {
    return (
      <div className="synth-editor">
        <ScratchActionStrip canDuplicate={false} placeDisabled onNew={onNewScratch} onPlace={() => undefined} />
        <div className="empty-editor">Open the scratch drawer and create a synth scratch.</div>
      </div>
    );
  }

  const patch: SynthPatch = scratch.synthPatch ?? defaultPatch;
  const notes = scratch.synthNotes ?? [];
  const scaleRoot = scratch.scaleRoot ?? 0;
  const scaleName = scratch.scaleName ?? 'Major (Ionian)';
  const keyOctave = scratch.keyOctave ?? 3;
  const motifBars = Math.min(8, Math.max(1, Math.round(scratch.motifBars ?? 1)));
  const noteLengthBeats = scratch.noteLengthBeats ?? 0.5;

  const patchField = <K extends keyof SynthPatch>(key: K, value: SynthPatch[K]) =>
    updateScratch(track.id, scratch.id, (current) => ({ ...current, synthPatch: { ...(current.synthPatch ?? defaultPatch), [key]: value } }));
  const metaField = (fields: Partial<Scratch>) =>
    updateScratch(track.id, scratch.id, (current) => ({ ...current, ...fields }));

  const pads = Array.from({ length: PAD_COUNT }, (_, index) => padMidi({ index, scaleRoot, scaleName, keyOctave, keyLayout: scratch.keyLayout }));

  const hitKey = (midi: number) => {
    playSynthNote(midi, patch);
    if (!writeMotif) return;
    // Quick-entry writes into the motif timeline at the moving cursor position.
    const motifLength = motifBars * barBeats(meter);
    const startBeat = cursorBeat % motifLength;
    updateScratch(track.id, scratch.id, (current) => ({
      ...current,
      synthNotes: [...(current.synthNotes ?? []), { id: crypto.randomUUID(), midi, startBeat, lengthBeats: current.noteLengthBeats ?? 0.5 }],
    }));
    setCursorBeat((startBeat + (scratch.noteLengthBeats ?? 0.5)) % motifLength);
  };

  const customIntervals = scaleName === 'Custom' ? (scratch.customIntervals ?? '') : undefined;
  const intervals = scaleIntervals(scaleName, customIntervals);

  const setPadOverride = (padIndex: number, midi: number | null) => {
    updateScratch(track.id, scratch.id, (current) => {
      const layout = [...(current.keyLayout ?? [])];
      while (layout.length < PAD_COUNT) layout.push(null);
      layout[padIndex] = midi;
      const next: Scratch = { ...current, keyLayout: layout };
      return next;
    });
  };

  return (
    <div className="synth-editor">
      <ScratchActionStrip
        canDuplicate
        placeDisabled={false}
        onNew={onNewScratch}
        onDuplicate={onDuplicateScratch}
        onPlace={onPlaceActive}
      />
      <div className="editor-toolbar">
        <label>Key
          <select value={scaleRoot} onChange={(event) => metaField({ scaleRoot: Number(event.target.value) })} aria-label="Scale root">
            {TONICS.map((tonic) => <option key={tonic.value} value={tonic.value}>{tonic.name}</option>)}
          </select>
        </label>
        <label>Scale
          <select value={scaleName} onChange={(event) => metaField({ scaleName: event.target.value })} aria-label="Scale or mode">
            {[...SCALES.map((scale) => scale.name), 'Custom'].map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
        {scaleName === 'Custom' && (
          <label className="custom-scale">Intervals
            <input
              defaultValue={scratch.customIntervals ?? '0-2-4-5-7-9-10'}
              placeholder="e.g. 0-2-3-5-7-8-10"
              onBlur={(event) => metaField({ customIntervals: event.target.value })}
              aria-label="Custom scale intervals from the root, separated by dashes"
            />
          </label>
        )}
        <div className="octave-stepper" role="group" aria-label="Keyboard octave">
          <button onClick={() => metaField({ keyOctave: Math.max(1, keyOctave - 1) })} aria-label="Octave down">−</button>
          <span>Oct {keyOctave}</span>
          <button onClick={() => metaField({ keyOctave: Math.min(6, keyOctave + 1) })} aria-label="Octave up">＋</button>
        </div>
        {layoutHasOverrides(scratch) && (
          <button onClick={() => metaField({ keyLayout: undefined })}>Reset pad map</button>
        )}
        <button className={`toggle-button ${writeMotif ? 'active' : ''}`} onClick={() => setWriteMotif(!writeMotif)}>{writeMotif ? '● Writing motif' : 'Write motif'}</button>
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

      <MotifEditor
        notes={notes}
        meter={meter}
        motifBars={motifBars}
        cursorBeat={cursorBeat}
        noteLengthBeats={noteLengthBeats}
        onChange={(nextNotes) => metaField({ synthNotes: nextNotes })}
        onCursorChange={setCursorBeat}
        onNoteLengthChange={(beats) => metaField({ noteLengthBeats: beats })}
        onMotifBarsChange={(bars) => metaField({ motifBars: bars })}
      />

      <div className="keyboard" aria-label="Synth keyboard">
        {pads.map((midi, index) => (
          <div className="key-pad" key={index}>
            <button
              className={`key-play ${scratch.keyLayout?.[index] != null ? 'overridden' : ''}`}
              onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => { event.preventDefault(); hitKey(midi); }}
            >
              <span>{noteName(midi)}</span>
              {scratch.keyLayout?.[index] != null && <i title="Manually mapped" />}
            </button>
            <button
              className="key-map"
              aria-label={`Map pad ${index + 1} to an exact note`}
              onClick={() => setEditingPad(editingPad === index ? null : index)}
            >⋯</button>
          </div>
        ))}
      </div>
      <p className="editor-hint">{notes.length} note{notes.length === 1 ? '' : 's'} · {scaleRoot === 0 ? '' : `${NOTE_NAMES[scaleRoot]} `}{scaleName !== 'Custom' ? scaleName : `Custom (${intervals.join('-')})`} layout · tap ⋯ to map any pad to an exact MIDI note</p>

      {editingPad != null && (
        <section className="pad-mapper" aria-label={`Exact note mapping for pad ${editingPad + 1}`}>
          <header>
            <strong>Pad {editingPad + 1}</strong>
            <span>{noteName(pads[editingPad])}</span>
          </header>
          <div className="pad-mapper-grid" role="group" aria-label="Choose exact MIDI note">
            {[1, 2, 3, 4, 5, 6].map((octave) => (
              <div className="pad-mapper-octave" key={octave}>
                <span>C{octave}</span>
                <div>
                  {NOTE_NAMES.map((name, pitch) => {
                    const midi = 12 * (octave + 1) + pitch;
                    return (
                      <button
                        key={pitch}
                        className={midi === pads[editingPad] ? 'active' : ''}
                        onClick={() => { setPadOverride(editingPad, midi); playSynthNote(midi, patch); }}
                        aria-label={`${name} octave ${octave}`}
                      >{name}</button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <footer>
            <button onClick={() => setPadOverride(editingPad, null)}>Follow scale</button>
            <button className="primary-button" onClick={() => setEditingPad(null)}>Done</button>
          </footer>
        </section>
      )}
    </div>
  );
}
