import type { ReactNode } from 'react';

export function Control({ label, value, min, max, step, onChange, suffix = '' }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <label className="touch-control">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <output>{Number(value).toFixed(step < 0.1 ? 2 : 0)}{suffix}</output>
    </label>
  );
}

/**
 * The common Scratch action strip shown in every track editor so Drums, Synth,
 * Bass and Audio all share one obvious songwriting workflow:
 * select track → new idea → edit/record it → place it at the playhead.
 */
export function ScratchActionStrip({ canDuplicate, placeDisabled, placeHint, onNew, onDuplicate, onPlace }: {
  canDuplicate: boolean;
  placeDisabled: boolean;
  placeHint?: string;
  onNew: () => void;
  onDuplicate?: () => void;
  onPlace: () => void;
}) {
  return (
    <div className="scratch-action-strip" role="group" aria-label="Scratch actions">
      <button className="primary-button strip-new" onClick={onNew}>＋ New Scratch</button>
      {canDuplicate && <button className="strip-duplicate" onClick={onDuplicate}>⧉ Duplicate Scratch</button>}
      <button onClick={onPlace} disabled={placeDisabled} title={placeDisabled ? placeHint : undefined} aria-label={placeDisabled ? placeHint : 'Place scratch at playhead'}>▶| Place @ Playhead</button>
    </div>
  );
}

export function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return <span className="field-label">{children}{hint && <small>{hint}</small>}</span>;
}
