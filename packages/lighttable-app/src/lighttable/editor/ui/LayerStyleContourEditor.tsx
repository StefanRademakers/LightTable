import React, { useMemo, useRef } from 'react';
import type {
  LayerStyleContour,
  LayerStyleContourPoint
} from '../styles/layerStyleTypes';

const WIDTH = 300;
const HEIGHT = 132;
const PADDING = 10;
const MAX_POINTS = 8;
const MIN_GAP = 0.005;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const graphX = (value: number) => PADDING + value * (WIDTH - PADDING * 2);
const graphY = (value: number) => PADDING + (1 - value) * (HEIGHT - PADDING * 2);

const normalizePoints = (points: LayerStyleContourPoint[]) =>
  [...points]
    .map((point) => ({
      position: clamp01(point.position),
      value: clamp01(point.value)
    }))
    .sort((a, b) => a.position - b.position)
    .slice(0, MAX_POINTS);

const toGraphPoint = (event: React.PointerEvent<SVGSVGElement>) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    position: clamp01((event.clientX - rect.left - PADDING) / (rect.width - PADDING * 2)),
    value: clamp01(1 - (event.clientY - rect.top - PADDING) / (rect.height - PADDING * 2))
  };
};

export const LayerStyleContourEditor: React.FC<{
  value: LayerStyleContour;
  onChange: (value: LayerStyleContour) => void;
}> = ({ value, onChange }) => {
  const dragIndexRef = useRef<number | null>(null);
  const points = useMemo(() => normalizePoints(value.points), [value.points]);
  const path = points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${graphX(point.position).toFixed(2)} ${graphY(point.value).toFixed(2)}`
  ).join(' ');

  const publish = (next: LayerStyleContourPoint[]) => {
    onChange({ points: normalizePoints(next) });
  };

  const addPoint = (event: React.PointerEvent<SVGRectElement>) => {
    if (event.button !== 0 || points.length >= MAX_POINTS) return;
    event.preventDefault();
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const point = {
      position: clamp01((event.clientX - rect.left - PADDING) / (rect.width - PADDING * 2)),
      value: clamp01(1 - (event.clientY - rect.top - PADDING) / (rect.height - PADDING * 2))
    };
    const next = normalizePoints([...points, point]);
    dragIndexRef.current = next.findIndex((candidate) =>
      Math.abs(candidate.position - point.position) < 1e-5
    );
    svg.setPointerCapture(event.pointerId);
    publish(next);
  };

  const startDrag = (event: React.PointerEvent<SVGCircleElement>, index: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragIndexRef.current = index;
    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
  };

  const movePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const index = dragIndexRef.current;
    if (index === null) return;
    const point = toGraphPoint(event);
    const next = points.map((candidate) => ({ ...candidate }));
    const minimum = index === 0 ? 0 : next[index - 1].position + MIN_GAP;
    const maximum = index === next.length - 1 ? 1 : next[index + 1].position - MIN_GAP;
    next[index] = {
      position: Math.max(minimum, Math.min(maximum, point.position)),
      value: point.value
    };
    publish(next);
  };

  const endDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragIndexRef.current === null) return;
    dragIndexRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const removePoint = (event: React.MouseEvent<SVGCircleElement>, index: number) => {
    if (index === 0 || index === points.length - 1) return;
    event.preventDefault();
    event.stopPropagation();
    publish(points.filter((_, pointIndex) => pointIndex !== index));
  };

  return (
    <div className="lighttable-style-contour">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="application"
        aria-label="Layer style contour"
        onPointerMove={movePoint}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <rect
          className="lighttable-style-contour__hit"
          x={PADDING}
          y={PADDING}
          width={WIDTH - PADDING * 2}
          height={HEIGHT - PADDING * 2}
          onPointerDown={addPoint}
        />
        {[0.25, 0.5, 0.75].map((position) => (
          <React.Fragment key={position}>
            <line className="lighttable-style-contour__grid"
              x1={graphX(position)} y1={graphY(0)} x2={graphX(position)} y2={graphY(1)} />
            <line className="lighttable-style-contour__grid"
              x1={graphX(0)} y1={graphY(position)} x2={graphX(1)} y2={graphY(position)} />
          </React.Fragment>
        ))}
        <path className="lighttable-style-contour__line-shadow" d={path} />
        <path className="lighttable-style-contour__line" d={path} />
        {points.map((point, index) => (
          <circle
            key={`${index}-${point.position.toFixed(4)}`}
            className="lighttable-style-contour__point"
            cx={graphX(point.position)}
            cy={graphY(point.value)}
            r="4.5"
            onPointerDown={(event) => startDrag(event, index)}
            onContextMenu={(event) => removePoint(event, index)}
          />
        ))}
      </svg>
      <small>Click to add · drag to shape · right-click to remove</small>
    </div>
  );
};
