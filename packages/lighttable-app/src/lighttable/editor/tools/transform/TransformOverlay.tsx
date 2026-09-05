import React, { useMemo, useRef } from 'react';
import type { Rect } from '../../document/documentTypes';
import {
  aroundPoint,
  multiplyMatrices,
  rectCorners,
  rotationMatrix,
  scaleMatrix,
  transformPoint,
  type TransformPoint
} from './affine';
import type { AffineMatrix, TransformHandle, TransformQuad, TransformSessionState } from './transformTypes';
import { transformCornerRotationTargets } from './transformEditingFrame';
import type { SnapFeature, SnapMatch } from '../../../application/tools/snapping/snapEngine';
import { snapAffineTranslation, snapProjectiveTranslation } from './snapTransformTranslation';
import {
  appendTransformFrameOperation,
  pointInTransformFrame,
  transformSessionFrame,
  type TransformFrameMode,
  type TransformSessionFrame
} from './transformSessionFrame';

interface TransformOverlayProps {
  state: TransformSessionState;
  interactive?: boolean;
  imageRect: Rect;
  scale: number;
  width: number;
  height: number;
  onChange: (matrix: AffineMatrix) => void;
  onProjectiveChange: (quad: TransformQuad) => void;
  onCommitGesture: () => void;
  onDuplicateChange: (duplicate: boolean) => void;
  frameMode?: TransformFrameMode;
  frameOverride?: TransformSessionFrame | null;
  onPickLayer?: (point: TransformPoint, extend: boolean) => void;
  /** Builds immutable snap geometry once at gesture start, never per pointer move. */
  getSnapTargets?: () => readonly SnapFeature[];
  snapEnabled?: boolean;
  onSnapMatches?: (matches: readonly SnapMatch[]) => void;
}

interface DragState {
  pointerId: number;
  handle: TransformHandle;
  sourcePoints: readonly TransformPoint[];
  matrix: AffineMatrix;
  frameMatrix: AffineMatrix;
  start: TransformPoint;
  anchor: TransformPoint;
  handlePoint: TransformPoint;
  pivot: TransformPoint;
  angle: number;
  projectiveQuad: TransformQuad | null;
  projectiveCorner: number | null;
  snapTargets: readonly SnapFeature[];
  snapMatches: readonly SnapMatch[];
  changed: boolean;
}

const midpoint = (first: TransformPoint, second: TransformPoint): TransformPoint => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2
});

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <path d="M8 13a9 9 0 1 1 1 9" fill="none" stroke="white" stroke-width="5" stroke-linecap="round"/>
    <path d="M8 13 4 8m4 5 6-1" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8 13a9 9 0 1 1 1 9" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M8 13 4 8m4 5 6-1" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`)}") 16 16, crosshair`;

const resizeCursorCache = new Map<number, string>();
const resizeCursorFor = (from: TransformPoint, opposite: TransformPoint) => {
  const rawDegrees = Math.atan2(from.y - opposite.y, from.x - opposite.x) * 180 / Math.PI;
  // A resize axis is bidirectional. Quantizing only limits unique browser
  // cursor resources; it is visually sub-degree at cursor size.
  const degrees = Math.round(((rawDegrees % 180) + 180) % 180);
  const cached = resizeCursorCache.get(degrees);
  if (cached) return cached;
  const cursor = `url("data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <g transform="rotate(${degrees} 16 16)" fill="white" stroke="#111" stroke-width="1.5" stroke-linejoin="round">
        <path d="M3 16 10 10v4h12v-4l7 6-7 6v-4H10v4z"/>
      </g>
    </svg>`)}") 16 16, crosshair`;
  resizeCursorCache.set(degrees, cursor);
  return cursor;
};

export const TransformOverlay: React.FC<TransformOverlayProps> = ({
  state,
  interactive = true,
  imageRect,
  scale,
  width,
  height,
  onChange,
  onProjectiveChange,
  onCommitGesture,
  onDuplicateChange,
  frameMode = 'document',
  frameOverride = null,
  onPickLayer,
  getSnapTargets = () => [],
  snapEnabled = true,
  onSnapMatches
}) => {
  const dragRef = useRef<DragState | null>(null);
  const scheduleAffine = (matrix: AffineMatrix, matches: readonly SnapMatch[] = []) => {
    // The renderer already coalesces dirty presentation to the next frame.
    // Another rAF here adds a complete frame of avoidable input latency.
    onSnapMatches?.(matches);
    onChange(matrix);
  };
  const scheduleProjective = (quad: TransformQuad, matches: readonly SnapMatch[] = []) => {
    onSnapMatches?.(matches);
    onProjectiveChange(quad);
  };
  const toScreen = (point: TransformPoint) => ({
    x: imageRect.x + point.x * scale,
    y: imageRect.y + point.y * scale
  });
  const toDocument = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - imageRect.x) / Math.max(scale, 1e-6),
      y: (event.clientY - bounds.top - imageRect.y) / Math.max(scale, 1e-6)
    };
  };
  const geometry = useMemo(() => {
    const frame = frameOverride ?? transformSessionFrame(state, frameMode);
    const localSource = rectCorners(frame.bounds);
    const source = localSource.map((point) => transformPoint(frame.matrix, point));
    const affineCorners: TransformQuad = [
      transformPoint(state.matrix, source[0]),
      transformPoint(state.matrix, source[1]),
      transformPoint(state.matrix, source[2]),
      transformPoint(state.matrix, source[3])
    ];
    const corners = state.projectiveQuad ?? affineCorners;
    const center = midpoint(corners[0], corners[2]);
    const top = midpoint(corners[0], corners[1]);
    const topLength = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
    const normal = topLength > 1e-6
      ? { x: (corners[1].y - corners[0].y) / topLength, y: -(corners[1].x - corners[0].x) / topLength }
      : { x: 0, y: -1 };
    return {
      source,
      frameMatrix: frame.matrix,
      localSource,
      sourceCenter: midpoint(localSource[0], localSource[2]),
      corners,
      center,
      rotation: { x: top.x + normal.x * 28 / Math.max(scale, 1e-6), y: top.y + normal.y * 28 / Math.max(scale, 1e-6) },
      handles: [
        ['north-west', localSource[0], localSource[2], corners[0], corners[2]],
        ['north', midpoint(localSource[0], localSource[1]), midpoint(localSource[2], localSource[3]), midpoint(corners[0], corners[1]), midpoint(corners[2], corners[3])],
        ['north-east', localSource[1], localSource[3], corners[1], corners[3]],
        ['east', midpoint(localSource[1], localSource[2]), midpoint(localSource[3], localSource[0]), midpoint(corners[1], corners[2]), midpoint(corners[3], corners[0])],
        ['south-east', localSource[2], localSource[0], corners[2], corners[0]],
        ['south', midpoint(localSource[2], localSource[3]), midpoint(localSource[0], localSource[1]), midpoint(corners[2], corners[3]), midpoint(corners[0], corners[1])],
        ['south-west', localSource[3], localSource[1], corners[3], corners[1]],
        ['west', midpoint(localSource[3], localSource[0]), midpoint(localSource[1], localSource[2]), midpoint(corners[3], corners[0]), midpoint(corners[1], corners[2])]
      ] as Array<[TransformHandle, TransformPoint, TransformPoint, TransformPoint, TransformPoint]>
    };
  }, [frameMode, frameOverride, scale, state.matrix, state.projectiveQuad, state.sourceBounds, state.sourceContentBounds, state.sourceMatrix]);

  const begin = (
    event: React.PointerEvent<SVGElement>,
    handle: TransformHandle,
    handlePoint = geometry.center,
    anchor = geometry.center
  ) => {
    if (event.button !== 0) return;
    if (handle === 'body' && state.sourceKind === 'selection') {
      onDuplicateChange(event.altKey);
    }
    const svg = event.currentTarget.ownerSVGElement ?? event.currentTarget as SVGSVGElement;
    const bounds = svg.getBoundingClientRect();
    const start = {
      x: (event.clientX - bounds.left - imageRect.x) / Math.max(scale, 1e-6),
      y: (event.clientY - bounds.top - imageRect.y) / Math.max(scale, 1e-6)
    };
    const cornerIndex = ['north-west', 'north-east', 'south-east', 'south-west'].indexOf(handle);
    const projectiveCorner = cornerIndex >= 0 && (event.ctrlKey || event.metaKey || state.projectiveQuad)
      ? cornerIndex
      : null;
    dragRef.current = {
      pointerId: event.pointerId,
      handle,
      sourcePoints: geometry.source.map((point) => ({ ...point })),
      matrix: state.matrix,
      frameMatrix: geometry.frameMatrix,
      start,
      anchor: event.altKey ? geometry.sourceCenter : anchor,
      handlePoint,
      pivot: geometry.center,
      angle: Math.atan2(start.y - geometry.center.y, start.x - geometry.center.x),
      projectiveQuad: [
        { ...geometry.corners[0] },
        { ...geometry.corners[1] },
        { ...geometry.corners[2] },
        { ...geometry.corners[3] }
      ],
      projectiveCorner,
      snapTargets: getSnapTargets(),
      snapMatches: [],
      changed: false
    };
    onSnapMatches?.([]);
    svg.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = toDocument(event);
    if (drag.projectiveCorner !== null && drag.projectiveQuad) {
      const next = drag.projectiveQuad.map((point, index) => (
        index === drag.projectiveCorner ? current : { ...point }
      )) as unknown as TransformQuad;
      drag.changed = true;
      scheduleProjective(next);
    } else if (state.projectiveQuad && drag.handle === 'body' && drag.projectiveQuad) {
      const dx = current.x - drag.start.x;
      const dy = current.y - drag.start.y;
      const snapped = snapProjectiveTranslation(
        drag.projectiveQuad,
        { x: dx, y: dy },
        drag.snapTargets,
        scale,
        snapEnabled,
        drag.snapMatches
      );
      drag.snapMatches = snapped.matches;
      drag.changed = true;
      scheduleProjective(snapped.value, snapped.matches);
    } else if (drag.handle === 'body') {
      const snapped = snapAffineTranslation(
        drag.sourcePoints,
        drag.matrix,
        { x: current.x - drag.start.x, y: current.y - drag.start.y },
        drag.snapTargets,
        scale,
        snapEnabled,
        drag.snapMatches
      );
      drag.snapMatches = snapped.matches;
      drag.changed = true;
      scheduleAffine(snapped.value, snapped.matches);
    } else if (drag.handle === 'rotate' && !state.projectiveQuad) {
      const angle = Math.atan2(current.y - drag.pivot.y, current.x - drag.pivot.x);
      let delta = angle - drag.angle;
      if (event.shiftKey) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
      drag.changed = true;
      scheduleAffine(multiplyMatrices(
        aroundPoint(rotationMatrix(delta), drag.pivot), drag.matrix
      ));
    } else if (!state.projectiveQuad) {
      const local = pointInTransformFrame(drag.matrix, drag.frameMatrix, current);
      if (!local) return;
      const horizontal = !['north', 'south'].includes(drag.handle);
      const vertical = !['east', 'west'].includes(drag.handle);
      const denominatorX = drag.handlePoint.x - drag.anchor.x;
      const denominatorY = drag.handlePoint.y - drag.anchor.y;
      const sideHandle = ['north', 'east', 'south', 'west'].includes(drag.handle);
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && sideHandle) {
        const horizontalSide = drag.handle === 'north' || drag.handle === 'south';
        const shear = horizontalSide
          ? {
              a: 1, b: 0,
              c: Math.max(-10, Math.min(10, (local.x - drag.handlePoint.x) / Math.max(1e-6, Math.abs(denominatorY)))),
              d: 1, tx: 0, ty: 0
            }
          : {
              a: 1,
              b: Math.max(-10, Math.min(10, (local.y - drag.handlePoint.y) / Math.max(1e-6, Math.abs(denominatorX)))),
              c: 0, d: 1, tx: 0, ty: 0
            };
        drag.changed = true;
        const next = appendTransformFrameOperation(
          drag.matrix,
          drag.frameMatrix,
          aroundPoint(shear, drag.anchor)
        );
        if (next) scheduleAffine(next);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      let scaleX = horizontal && Math.abs(denominatorX) > 1e-6 ? (local.x - drag.anchor.x) / denominatorX : 1;
      let scaleY = vertical && Math.abs(denominatorY) > 1e-6 ? (local.y - drag.anchor.y) / denominatorY : 1;
      // Photoshop's current Free Transform keeps corner proportions by
      // default; Shift explicitly opts into independent axes.
      if (!event.shiftKey && horizontal && vertical) {
        const uniform = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
        scaleX = uniform;
        scaleY = uniform;
      }
      scaleX = Math.abs(scaleX) < 0.01 ? Math.sign(scaleX || 1) * 0.01 : scaleX;
      scaleY = Math.abs(scaleY) < 0.01 ? Math.sign(scaleY || 1) * 0.01 : scaleY;
      drag.changed = true;
      const next = appendTransformFrameOperation(
        drag.matrix,
        drag.frameMatrix,
        aroundPoint(scaleMatrix(scaleX, scaleY), drag.anchor)
      );
      if (next) scheduleAffine(next);
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const end = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (!drag.changed && drag.handle === 'body' && onPickLayer) {
      const point = toDocument(event);
      const movedPixels = Math.hypot(point.x - drag.start.x, point.y - drag.start.y) * scale;
      if (movedPixels <= 3) onPickLayer(point, event.shiftKey);
    }
    dragRef.current = null;
    onSnapMatches?.([]);
    event.currentTarget.releasePointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    // Pointer-up ends only this gesture and synchronizes the gizmo. The renderer
    // keeps the original source alive until Enter, repeating the transform-tool
    // shortcut, or switching tools confirms the complete transform session.
    if (drag.changed) onCommitGesture();
  };

  const screenCorners = geometry.corners.map(toScreen);
  const rotation = toScreen(geometry.rotation);
  const top = toScreen(midpoint(geometry.corners[0], geometry.corners[1]));
  const cornerRotationTargets = transformCornerRotationTargets(
    geometry.corners,
    geometry.center,
    scale
  ).map(toScreen);
  return (
    <svg
      className="lighttable-transform"
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      aria-label="Transform controls"
    >
      <polygon
        className="lighttable-transform__body"
        style={{ fill: 'transparent', stroke: 'none', cursor: 'move' }}
        points={screenCorners.map(({ x, y }) => `${x},${y}`).join(' ')}
        onPointerDown={(event) => begin(event, 'body')}
      />
      <line style={{ visibility: 'hidden' }} x1={top.x} y1={top.y} x2={rotation.x} y2={rotation.y} />
      <circle
        style={{ fill: 'transparent', stroke: 'none', cursor: ROTATE_CURSOR, pointerEvents: state.projectiveQuad ? 'none' : 'all' }}
        cx={rotation.x}
        cy={rotation.y}
        r="12"
        onPointerDown={(event) => begin(event, 'rotate')}
      />
      {!state.projectiveQuad && cornerRotationTargets.map((target, index) => (
        <circle
          key={`corner-rotate-${index}`}
          className="lighttable-transform__corner-rotation-target"
          style={{ cursor: ROTATE_CURSOR }}
          cx={target.x}
          cy={target.y}
          r="12"
          onPointerDown={(event) => begin(event, 'rotate')}
        />
      ))}
      {geometry.handles.map(([handle, sourcePoint, anchor, point, opposite]) => {
        const screen = toScreen(point);
        return (
          <rect
            key={handle}
            style={{
              fill: 'transparent',
              stroke: 'none',
              pointerEvents: state.projectiveQuad && !['north-west', 'north-east', 'south-east', 'south-west'].includes(handle) ? 'none' : 'all',
              cursor: resizeCursorFor(point, opposite)
            }}
            x={screen.x - 12}
            y={screen.y - 12}
            width="24"
            height="24"
            onPointerDown={(event) => begin(event, handle, sourcePoint, anchor)}
          />
        );
      })}
    </svg>
  );
};
