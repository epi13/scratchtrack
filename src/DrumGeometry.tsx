import type { CSSProperties, PointerEvent } from 'react';
import type { DrumCell } from './types';

interface DrumGeometryProps {
  names: string[];
  pattern: DrumCell[][];
  onCycle: (row: number, step: number) => void;
}

const SIZE = 210;
const CENTER = SIZE / 2;
const RADIUS = 78;

function pointForStep(step: number) {
  const angle = (step / 16) * Math.PI * 2 - Math.PI / 2;
  return {
    x: CENTER + Math.cos(angle) * RADIUS,
    y: CENTER + Math.sin(angle) * RADIUS,
  };
}

function pathForRow(row: DrumCell[]) {
  const active = row
    .map((cell, step) => ({ cell, step, ...pointForStep(step) }))
    .filter(({ cell }) => cell > 0);
  if (active.length < 2) return '';
  const points = active.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`);
  if (active.length > 2) points.push(points[0]);
  return points.join(' ');
}

function GeometryLane({ name, row, rowIndex, onCycle }: { name: string; row: DrumCell[]; rowIndex: number; onCycle: DrumGeometryProps['onCycle'] }) {
  const connectedPoints = pathForRow(row);
  const activeCount = row.filter(Boolean).length;
  const quarterPoints = [0, 4, 8, 12].map(pointForStep).map(({ x, y }) => `${x},${y}`).join(' ');

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
          <polygon points={quarterPoints} className="geometry-quadrants" />
          {[0, 4, 8, 12].map((step) => {
            const point = pointForStep(step);
            return <line key={step} x1={CENTER} y1={CENTER} x2={point.x} y2={point.y} className="geometry-spoke" />;
          })}
          {connectedPoints && <polyline points={connectedPoints} className="geometry-pattern" />}
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
              className={`geometry-step level-${cell} ${step % 4 === 0 ? 'quarter' : ''}`}
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

export default function DrumGeometry({ names, pattern, onCycle }: DrumGeometryProps) {
  return (
    <div className="geometry-drum-bank">
      {names.map((name, rowIndex) => (
        <GeometryLane key={name} name={name} row={pattern[rowIndex] ?? []} rowIndex={rowIndex} onCycle={onCycle} />
      ))}
    </div>
  );
}
