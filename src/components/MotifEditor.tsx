import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { TICKS_PER_BEAT, noteName } from '../music';
import {
  mncsClampMotifMidi,
  mncsDragStarted,
  mncsHalfBeatlineCount,
  mncsPickRowMidi,
  mncsRowDelta,
  mncsShiftMotifMidi,
  mncsTapCancelled,
} from '../mncsGeometry';
import type { SynthNote, TimeSignature } from '../types';
import { barBeats } from '../music';

const PX_PER_BEAT = 46;
const ROW_H = 26;
const MIN_LENGTH_BEATS = 1 / TICKS_PER_BEAT;

type MotifSnap = 'off' | '1/4' | '1/8' | '1/8t' | '1/16' | '1/32';

const MOTIF_SNAPS: Array<{ value: MotifSnap; label: string; step: number }> = [
  { value: 'off', label: 'Free', step: MIN_LENGTH_BEATS },
  { value: '1/4', label: '1/4', step: 1 },
  { value: '1/8', label: '1/8', step: 0.5 },
  { value: '1/8t', label: '1/8T', step: 1 / 3 },
  { value: '1/16', label: '1/16', step: 0.25 },
  { value: '1/32', label: '1/32', step: 0.125 },
];

function snapStepFor(snap: MotifSnap): number {
  return MOTIF_SNAPS.find((option) => option.value === snap)?.step ?? 0.25;
}

function snapValue(value: number, snap: MotifSnap): number {
  const step = snapStepFor(snap);
  return Math.max(0, Math.round(value / step) * step);
}

const QUICK_LENGTHS = [0.25, 0.5, 1, 1.5, 2];

type DragMode = 'move' | 'resize';

export default function MotifEditor({ notes, meter, motifBars, cursorBeat, noteLengthBeats, onChange, onCursorChange, onNoteLengthChange, onMotifBarsChange }: {
  notes: SynthNote[];
  meter: TimeSignature;
  motifBars: number;
  cursorBeat: number;
  noteLengthBeats: number;
  onChange: (notes: SynthNote[]) => void;
  onCursorChange: (beat: number) => void;
  onNoteLengthChange: (beats: number) => void;
  onMotifBarsChange: (bars: number) => void;
}) {
  const [snap, setSnap] = useState<MotifSnap>('1/8');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingTapRef = useRef<{ x: number; y: number } | null>(null);

  const beatsPerBar = barBeats(meter);
  const motifLength = motifBars * beatsPerBar;

  const pitchRange = useMemo(() => {
    const midis = notes.map((note) => note.midi);
    const center = midis.length ? Math.round(midis.reduce((sum, value) => sum + value, 0) / midis.length) : 60;
    const lo = Math.max(12, Math.min(center - 10, ...(midis.length ? midis : [center]) ) - 2);
    const hi = Math.min(108, Math.max(center + 9, ...(midis.length ? midis : [center])) + 2);
    return { lo, hi };
  }, [notes]);

  const rowCount = pitchRange.hi - pitchRange.lo + 1;

  // Keep the interesting part of the motif visible vertically.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !notes.length) return;
    const focusMidi = selectedId
      ? notes.find((note) => note.id === selectedId)?.midi
      : notes[0]?.midi;
    if (focusMidi == null) return;
    const targetRow = pitchRange.hi - focusMidi;
    const targetTop = targetRow * ROW_H;
    if (targetTop < scroller.scrollTop || targetTop > scroller.scrollTop + scroller.clientHeight - ROW_H * 2) {
      scroller.scrollTop = Math.max(0, targetTop - scroller.clientHeight / 2);
    }
  }, [notes, pitchRange, selectedId]);

  const beatFromEvent = (clientX: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return ((clientX - rect.left) / PX_PER_BEAT);
  };
  const midiFromEvent = (clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const row = Math.floor((clientY - rect.top) / ROW_H);
    // Row picking owned by the MNCS geometry model (`pick_row_midi`).
    return mncsPickRowMidi(pitchRange.hi, row, rowCount);
  };

  const addNote = (clientX: number, clientY: number) => {
    const startBeat = Math.min(Math.max(0, snapValue(beatFromEvent(clientX), snap)), Math.max(0, motifLength - MIN_LENGTH_BEATS));
    const midi = midiFromEvent(clientY);
    const note: SynthNote = {
      id: crypto.randomUUID(),
      midi,
      startBeat,
      lengthBeats: noteLengthBeats,
    };
    onChange([...notes, note]);
    setSelectedId(note.id);
  };

  const beginNoteDrag = (event: ReactPointerEvent<HTMLElement>, note: SynthNote, mode: DragMode) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(note.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const grabOffset = mode === 'move' ? beatFromEvent(event.clientX) - note.startBeat : 0;
    let moved = false;
    const applyMove = (pointer: PointerEvent) => {
      // Pointer interpretation owned by the MNCS geometry model
      // (`row_delta`, `drag_started`, `clamp_motif_midi`).
      const dyRows = mncsRowDelta(pointer.clientY - startY, ROW_H);
      if (!moved && !mncsDragStarted(pointer.clientX - startX, dyRows)) return;
      moved = true;
      onChange(notes.map((item) => {
        if (item.id !== note.id) return item;
        if (mode === 'resize') {
          const rawLength = snapValue(beatFromEvent(pointer.clientX) - item.startBeat, snap);
          const length = Math.max(MIN_LENGTH_BEATS, Math.min(rawLength || MIN_LENGTH_BEATS, motifLength - item.startBeat));
          return { ...item, lengthBeats: length };
        }
        const startBeat = Math.min(Math.max(0, snapValue(beatFromEvent(pointer.clientX) - grabOffset, snap)), Math.max(0, motifLength - MIN_LENGTH_BEATS));
        const midi = mncsClampMotifMidi(item.midi - dyRows);
        return { ...item, startBeat, midi };
      }));
    };
    const finish = () => {
      window.removeEventListener('pointermove', applyMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    window.addEventListener('pointermove', applyMove);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  };

  const backgroundPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pendingTapRef.current = { x: event.clientX, y: event.clientY };
  };
  const backgroundPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pending = pendingTapRef.current;
    if (!pending) return;
    // Tap grace owned by the MNCS geometry model (`tap_cancelled`).
    if (mncsTapCancelled(event.clientX - pending.x, event.clientY - pending.y)) pendingTapRef.current = null;
  };
  const backgroundPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pending = pendingTapRef.current;
    pendingTapRef.current = null;
    if (!pending) return;
    if (mncsTapCancelled(event.clientX - pending.x, event.clientY - pending.y)) return;
    setSelectedId(null);
    addNote(event.clientX, event.clientY);
  };

  const selected = notes.find((note) => note.id === selectedId) ?? null;

  const mutateSelected = (mutator: (note: SynthNote) => SynthNote) => {
    if (!selected) return;
    onChange(notes.map((note) => (note.id === selected.id ? mutator(note) : note)));
  };

  const step = snapStepFor(snap);
  const barLines = Array.from({ length: motifBars }, (_, index) => index);
  // Grid-line count owned by the MNCS geometry model (`half_beatline_count`);
  // positions stay host-side (pixel layout is a rendering concern).
  const beatLines = Array.from(
    { length: mncsHalfBeatlineCount(Math.round(motifLength * TICKS_PER_BEAT)) },
    (_, index) => index * 0.5,
  );

  return (
    <div className="motif-composer">
      <div className="motif-toolbar">
        <label>Snap
          <select value={snap} onChange={(event) => setSnap(event.target.value as MotifSnap)} aria-label="Motif snap">
            {MOTIF_SNAPS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>Length
          <select value={motifBars} onChange={(event) => onMotifBarsChange(Number(event.target.value))} aria-label="Motif length in bars">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((bars) => <option key={bars} value={bars}>{bars} bar{bars > 1 ? 's' : ''}</option>)}
          </select>
        </label>
        <label>Note len
          <select value={noteLengthBeats} onChange={(event) => onNoteLengthChange(Number(event.target.value))} aria-label="Quick entry note length">
            {QUICK_LENGTHS.map((length) => <option key={length} value={length}>{length}</option>)}
          </select>
        </label>
        <button onClick={() => onCursorChange((cursorBeat + noteLengthBeats) % motifLength)} title="Advance the write cursor without adding a note">Rest ›</button>
        <button onClick={() => { onChange([]); setSelectedId(null); }} disabled={!notes.length}>Clear</button>
        <span className="motif-hint">Tap empty space to add · drag notes to move · right edge resizes</span>
      </div>

      <div className="motif-scroll" ref={scrollRef}>
        <div
          className="motif-canvas"
          ref={canvasRef}
          style={{ width: `${motifLength * PX_PER_BEAT}px`, height: `${rowCount * ROW_H}px` }}
          onPointerDown={backgroundPointerDown}
          onPointerMove={backgroundPointerMove}
          onPointerUp={backgroundPointerUp}
          onPointerCancel={() => { pendingTapRef.current = null; }}
        >
          {pitchRange.hi >= pitchRange.lo && Array.from({ length: rowCount }, (_, row) => {
            const midi = pitchRange.hi - row;
            return (
              <div
                key={row}
                className={`motif-row ${midi % 12 === 0 ? 'root-row' : (midi % 12) % 2 === 0 ? '' : 'black-row'}`}
                style={{ top: `${row * ROW_H}px`, height: `${ROW_H}px` }}
              >
                {(midi % 12 === 0 || row === rowCount - 1) && <span className="motif-pitch-label">{noteName(midi)}</span>}
              </div>
            );
          })}
          {barLines.map((bar) => (
            <div key={`bar-${bar}`} className="motif-barline" style={{ left: `${bar * beatsPerBar * PX_PER_BEAT}px`, width: `${beatsPerBar * PX_PER_BEAT}px` }}>
              <span>{bar + 1}</span>
            </div>
          ))}
          {beatLines.map((beat) => (
            <div key={`beat-${beat}`} className={`motif-beatline ${Number.isInteger(beat) ? '' : 'half'}`} style={{ left: `${beat * PX_PER_BEAT}px` }} />
          ))}
          <div className="motif-cursor" style={{ left: `${cursorBeat * PX_PER_BEAT}px` }} aria-hidden="true" />
          {notes.map((note) => {
            const isSelected = note.id === selectedId;
            const width = Math.max(7, note.lengthBeats * PX_PER_BEAT - 2);
            return (
              <div
                key={note.id}
                className={`motif-note ${isSelected ? 'selected' : ''}`}
                style={{
                  left: `${note.startBeat * PX_PER_BEAT}px`,
                  top: `${(pitchRange.hi - note.midi) * ROW_H}px`,
                  width: `${width}px`,
                  height: `${ROW_H - 3}px`,
                  touchAction: 'none',
                }}
                role="button"
                aria-label={`${noteName(note.midi)} at ${note.startBeat.toFixed(2)} beats`}
                tabIndex={isSelected ? 0 : -1}
                onPointerDown={(event) => beginNoteDrag(event, note, 'move')}
              >
                <span>{noteName(note.midi)}</span>
                {isSelected && (
                  <button
                    className="motif-note-delete"
                    aria-label={`Delete ${noteName(note.midi)}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onChange(notes.filter((item) => item.id !== note.id));
                      setSelectedId(null);
                    }}
                  >×</button>
                )}
                <i
                  className="motif-note-resize"
                  aria-hidden="true"
                  onPointerDown={(event) => beginNoteDrag(event, note, 'resize')}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className={`motif-inspector ${selected ? '' : 'disabled'}`} aria-label="Selected note inspector">
        {selected ? (
          <>
            <strong>{noteName(selected.midi)}</strong>
            <div className="inspector-group">
              <button aria-label="Pitch down one semitone" onClick={() => mutateSelected((note) => ({ ...note, midi: mncsShiftMotifMidi(note.midi, -1) }))}>−</button>
              <span>Pitch</span>
              <button aria-label="Pitch up one semitone" onClick={() => mutateSelected((note) => ({ ...note, midi: mncsShiftMotifMidi(note.midi, 1) }))}>＋</button>
            </div>
            <div className="inspector-group">
              <button aria-label="Octave down" onClick={() => mutateSelected((note) => ({ ...note, midi: mncsShiftMotifMidi(note.midi, -12) }))}>−</button>
              <span>Oct</span>
              <button aria-label="Octave up" onClick={() => mutateSelected((note) => ({ ...note, midi: mncsShiftMotifMidi(note.midi, 12) }))}>＋</button>
            </div>
            <div className="inspector-group">
              <button aria-label="Start earlier" onClick={() => mutateSelected((note) => ({ ...note, startBeat: Math.max(0, Number((note.startBeat - step).toFixed(4))) }))}>−</button>
              <span>Start {selected.startBeat.toFixed(2)}</span>
              <button aria-label="Start later" onClick={() => mutateSelected((note) => ({ ...note, startBeat: Math.min(motifLength - MIN_LENGTH_BEATS, Number((note.startBeat + step).toFixed(4))) }))}>＋</button>
            </div>
            <div className="inspector-group">
              <button aria-label="Shorter note" onClick={() => mutateSelected((note) => ({ ...note, lengthBeats: Math.max(MIN_LENGTH_BEATS, Number((note.lengthBeats - step).toFixed(4))) }))}>−</button>
              <span>Len {selected.lengthBeats.toFixed(2)}</span>
              <button aria-label="Longer note" onClick={() => mutateSelected((note) => ({ ...note, lengthBeats: Number((note.lengthBeats + step).toFixed(4)) }))}>＋</button>
            </div>
            <button
              className="danger"
              onClick={() => { onChange(notes.filter((note) => note.id !== selected.id)); setSelectedId(null); }}
            >Delete note</button>
          </>
        ) : <span>Tap a note to edit its exact pitch, start and length.</span>}
      </div>
    </div>
  );
}
