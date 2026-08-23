import type { CSSProperties, PointerEvent } from 'react';
import type { DrumCell } from './types';

interface DrumGeometryProps {
  names: string[];
  pattern: DrumCell[][];
  stepsPerBar: number;
  /** Steps between beat markers (e.g. 4 for x/4 meters at 1/16). */
  stepsPerBeat: number;
  onCycle: (row: number, step: number) => void;
}

const SIZE = 210;
const CENTER = SIZE / 2;
const RADIUS = 78;

function GeometryLane({ name, row, rowIndex, stepsPerBar, stepsPerBeat, onCycle }: {
  name: string;
  row: DrumCell[];
  rowIndex: number;
  stepsPerBar: number;
  stepsPerBeat: number;
  onCycle: DrumGeometryProps['onCycle'];
}) {
  const pointForStep = (step: number) => {
    const angle = (step / Math.max(1, stepsPerBar)) * Math.PI * 2 - Math.PI / 2;
    return {
      x: CENTER + Math.cos(angle) * RADIUS,
      y: CENTER + Math.sin(angle) * RADIUS,
    };
  };

  const active = row
    .map((cell, step) => ({ cell, step }))
    .filter(({ cell }) => cell > 0);
  let path = '';
  if (active.length > 1) {
    const points = active.map(({ step }) => {
      const { x, y } = pointForStep(step);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    if (active.length > 2) points.push(points[0]);
    path = points.join(' ');
  }

  const activeCount = active.length;
  const beatSteps = Array.from({ length: stepsPerBar }, (_, step) => step)
    .filter((step) => step % Math.max(1, stepsPerBeat) === 0);

  const handleStep = (event: PointerEvent<HTMLButtonElement>, step: number) => {
    event.preventDefault();
    event.stopPropagation();
    onCycle(rowIndex, step);
  };

  return (
    <section className="geometry-drum-card" aria-label={`${name} geometric sequencer`}>
      <div className="geometry-orbit" style={{ '--geometry-size': `${SIZE}px` } as CSSProperties}>
        <svg className="geometry-lines" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <circle cx={CENTER} cy={CENTER} r={RADIUS} className="geometry-ring" />
          <circle cx={CENTER} cy={CENTER} r={RADIUS * 0.52} className="geometry-inner-ring" />
          {beatSteps.length > 2 && (
            <polygon
              points={beatSteps.map(pointForStep).map(({ x, y }) => `${x},${y}`).join(' ')}
              className="geometry-quadrants"
            />
          )}
          {beatSteps.map((step) => {
            const point = pointForStep(step);
            return <line key={step} x1={CENTER} y1={CENTER} x2={point.x} y2={point.y} className="geometry-spoke" />;
          })}
          {path && <polyline points={path} className="geometry-pattern" />}
        </svg>

        <div className="geometry-center" aria-hidden="true">
          <strong>{name}</strong>
          <span>{activeCount} hit{activeCount === 1 ? '' : 's'}</span>
        </div>

        {row.map((cell, step) => {
          const point = pointForStep(step);
          return (
            <button
              key={step}
              type="button"
              className={`geometry-step level-${cell} ${step % Math.max(1, stepsPerBeat) === 0 ? 'quarter' : ''}`}
              style={{ left: `${(point.x / SIZE) * 100}%`, top: `${(point.y / SIZE) * 100}%` }}
              aria-label={`${name} step ${step + 1}${cell === 2 ? ', accent' : cell === 1 ? ', hit' : ', off'}`}
              aria-pressed={cell > 0}
              onPointerDown={(event) => handleStep(event, step)}
            >
              <span>{step + 1}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function DrumGeometry({ names, pattern, stepsPerBar, stepsPerBeat, onCycle }: DrumGeometryProps) {
  return (
    <div className="geometry-drum-bank" data-steps={stepsPerBar}>
      {names.map((name, rowIndex) => (
        <GeometryLane
          key={name}
          name={name}
          row={pattern[rowIndex] ?? []}
          rowIndex={rowIndex}
          stepsPerBar={stepsPerBar}
          stepsPerBeat={stepsPerBeat}
          onCycle={onCycle}
        />
      ))}
    </div>
  );
}
