import type { VectorSelectionFrame } from '@lighttable/vector-rendering';
import type { SnapMatch, SnapRect } from '../../../application/tools/snapping/snapEngine';

const finite = (value: number) => Number.isFinite(value) ? value.toFixed(4) : 'invalid';

/** GPU-overlay projection of resolved snap matches; it never recomputes snapping. */
export const buildSmartGuideEditingFrame = (
  matches: readonly SnapMatch[],
  movingBounds: SnapRect,
  viewportScale: number
): VectorSelectionFrame | null => {
  if (matches.length === 0) return null;
  const padding = 28 / Math.max(1e-6, viewportScale);
  const edges = matches.map((match) => match.axis === 'x'
    ? {
        start: { x: match.target.position, y: movingBounds.y - padding },
        end: { x: match.target.position, y: movingBounds.y + movingBounds.height + padding }
      }
    : {
        start: { x: movingBounds.x - padding, y: match.target.position },
        end: { x: movingBounds.x + movingBounds.width + padding, y: match.target.position }
      });
  const xs = edges.flatMap(({ start, end }) => [start.x, end.x]);
  const ys = edges.flatMap(({ start, end }) => [start.y, end.y]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return {
    resourceKey: ['smart-guides', ...matches.flatMap((match) => [
      match.axis,
      match.moving.role,
      match.target.source,
      match.target.sourceId ?? '',
      match.target.role,
      finite(match.target.position)
    ]), finite(movingBounds.x), finite(movingBounds.y), finite(viewportScale)].join(':'),
    bounds: { x: left, y: top, width: right - left, height: bottom - top },
    pivot: { x: (left + right) / 2, y: (top + bottom) / 2 },
    edges,
    handles: []
  };
};
