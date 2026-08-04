import React, { useMemo, useRef } from 'react';
import type { Rect } from '../../document/documentTypes';
import {
  aroundPoint,
  invertMatrix,
  multiplyMatrices,
  rectCorners,
  rotationMatrix,
  scaleMatrix,
  transformPoint,
  translationMatrix,
  type TransformPoint
} from './affine';
import type { AffineMatrix, TransformHandle, TransformQuad, TransformSessionState } from './transformTypes';
import { transformCornerRotationTargets } from './transformEditingFrame';

interface TransformOverlayProps {
  state: TransformSessionState;
  imageRect: Rect;
  scale: number;
  width: number;
  height: number;
  onChange: (matrix: AffineMatrix) => void;
  onProjectiveChange: (quad: TransformQuad) => void;
}

interface DragState {
  pointerId: number;
  handle: TransformHandle;
  matrix: AffineMatrix;
  start: TransformPoint;
  anchor: TransformPoint;
  handlePoint: TransformPoint;
  pivot: TransformPoint;
  angle: number;
  projectiveQuad: TransformQuad | null;
  projectiveCorner: number | null;
}

const midpoint = (first: TransformPoint, second: TransformPoint): TransformPoint => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2
});

export const TransformOverlay: React.FC<TransformOverlayProps> = ({
  state,
  imageRect,
  scale,
  width,
  height,
  onChange,
  onProjectiveChange
}) => {
  const dragRef = useRef<DragState | null>(null);
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
    const source = rectCorners(state.sourceContentBounds)
      .map((point) => transformPoint(state.sourceMatrix, point));
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
      sourceCenter: midpoint(source[0], source[2]),
      corners,
      center,
      rotation: { x: top.x + normal.x * 28 / Math.max(scale, 1e-6), y: top.y + normal.y * 28 / Math.max(scale, 1e-6) },
      handles: [
        ['north-west', source[0], source[2], corners[0]],
        ['north', midpoint(source[0], source[1]), midpoint(source[2], source[3]), midpoint(corners[0], corners[1])],
        ['north-east', source[1], source[3], corners[1]],
        ['east', midpoint(source[1], source[2]), midpoint(source[3], source[0]), midpoint(corners[1], corners[2])],
        ['south-east', source[2], source[0], corners[2]],
        ['south', midpoint(source[2], source[3]), midpoint(source[0], source[1]), midpoint(corners[2], corners[3])],
        ['south-west', source[3], source[1], corners[3]],
        ['west', midpoint(source[3], source[0]), midpoint(source[1], source[2]), midpoint(corners[3], corners[0])]
      ] as Array<[TransformHandle, TransformPoint, TransformPoint, TransformPoint]>
    };
  }, [scale, state.matrix, state.projectiveQuad, state.sourceContentBounds, state.sourceMatrix]);

  const begin = (
    event: React.PointerEvent<SVGElement>,
    handle: TransformHandle,
    handlePoint = geometry.center,
    anchor = geometry.center
  ) => {
    if (event.button !== 0) return;
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
      matrix: state.matrix,
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
      projectiveCorner
    };
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
      onProjectiveChange(next);
    } else if (state.projectiveQuad && drag.handle === 'body' && drag.projectiveQuad) {
      const dx = current.x - drag.start.x;
      const dy = current.y - drag.start.y;
      onProjectiveChange([
        { x: drag.projectiveQuad[0].x + dx, y: drag.projectiveQuad[0].y + dy },
        { x: drag.projectiveQuad[1].x + dx, y: drag.projectiveQuad[1].y + dy },
        { x: drag.projectiveQuad[2].x + dx, y: drag.projectiveQuad[2].y + dy },
        { x: drag.projectiveQuad[3].x + dx, y: drag.projectiveQuad[3].y + dy }
      ]);
    } else if (drag.handle === 'body') {
      onChange(multiplyMatrices(
        translationMatrix(current.x - drag.start.x, current.y - drag.start.y),
        drag.matrix
      ));
    } else if (drag.handle === 'rotate' && !state.projectiveQuad) {
      const angle = Math.atan2(current.y - drag.pivot.y, current.x - drag.pivot.x);
      let delta = angle - drag.angle;
      if (event.shiftKey) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
      onChange(multiplyMatrices(aroundPoint(rotationMatrix(delta), drag.pivot), drag.matrix));
    } else if (!state.projectiveQuad) {
      const inverse = invertMatrix(drag.matrix);
      if (!inverse) return;
      const local = transformPoint(inverse, current);
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
        onChange(multiplyMatrices(
          drag.matrix,
          aroundPoint(shear, drag.anchor)
        ));
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
      onChange(multiplyMatrices(
        drag.matrix,
        aroundPoint(scaleMatrix(scaleX, scaleY), drag.anchor)
      ));
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const end = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
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
        style={{ fill: 'transparent', stroke: 'none', cursor: 'grab', pointerEvents: state.projectiveQuad ? 'none' : 'all' }}
        cx={rotation.x}
        cy={rotation.y}
        r="12"
        onPointerDown={(event) => begin(event, 'rotate')}
      />
      {!state.projectiveQuad && cornerRotationTargets.map((target, index) => (
        <circle
          key={`corner-rotate-${index}`}
          className="lighttable-transform__corner-rotation-target"
          cx={target.x}
          cy={target.y}
          r="12"
          onPointerDown={(event) => begin(event, 'rotate')}
        />
      ))}
      {geometry.handles.map(([handle, sourcePoint, anchor, point]) => {
        const screen = toScreen(point);
        return (
          <rect
            key={handle}
            style={{
              fill: 'transparent',
              stroke: 'none',
              pointerEvents: state.projectiveQuad && !['north-west', 'north-east', 'south-east', 'south-west'].includes(handle) ? 'none' : 'all',
              cursor: handle === 'north' || handle === 'south' ? 'ns-resize'
                : handle === 'east' || handle === 'west' ? 'ew-resize'
                  : handle === 'north-west' || handle === 'south-east' ? 'nwse-resize'
                    : 'nesw-resize'
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
