import React from 'react';
import type {
  SelectionOperation,
  SelectionShape
} from './selectionTypes';

export interface SelectionOverlayProps {
  operations: SelectionOperation[];
  draft: SelectionShape | null;
  imageRect: { x: number; y: number; width: number; height: number };
  scale: number;
  width: number;
  height: number;
}

export const isDirectVectorSelection = (
  operations: readonly SelectionOperation[]
): boolean => (
  operations.length === 1
  && operations[0].mode === 'replace'
);

interface RasterViewportSnapshot {
  imageX: number;
  imageY: number;
  scale: number;
  width: number;
  height: number;
}

const sameRasterViewport = (
  left: RasterViewportSnapshot,
  right: RasterViewportSnapshot
) => (
  left.imageX === right.imageX
  && left.imageY === right.imageY
  && left.scale === right.scale
  && left.width === right.width
  && left.height === right.height
);

export const createRasterViewportTransform = (
  source: Pick<RasterViewportSnapshot, 'imageX' | 'imageY' | 'scale'>,
  target: Pick<RasterViewportSnapshot, 'imageX' | 'imageY' | 'scale'>
): string => {
  const ratio = target.scale / Math.max(source.scale, 1e-6);
  const translateX = target.imageX - source.imageX * ratio;
  const translateY = target.imageY - source.imageY * ratio;
  return `translate(${translateX}px, ${translateY}px) scale(${ratio})`;
};

export const createVectorViewportTransform = (
  imageRect: { x: number; y: number },
  scale: number
): string => `translate(${imageRect.x}px, ${imageRect.y}px) scale(${scale})`;

interface PrimitiveSelectionBounds {
  kind: 'rectangle' | 'ellipse';
  left: number;
  top: number;
  width: number;
  height: number;
}

export const getPrimitiveSelectionBounds = (
  shape: SelectionShape | null
): PrimitiveSelectionBounds | null => {
  if (!shape || (shape.kind !== 'rectangle' && shape.kind !== 'ellipse')) return null;
  if (shape.points.length < 2) return null;
  const first = shape.points[0];
  const second = shape.points[1];
  return {
    kind: shape.kind,
    left: Math.min(first.x, second.x),
    top: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y)
  };
};

export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({
  draft,
  imageRect,
  scale,
  width,
  height
}) => {
  const renderDraftDimensions = (shape: SelectionShape) => {
    if ((shape.kind !== 'rectangle' && shape.kind !== 'ellipse') || shape.points.length < 2) {
      return null;
    }
    const first = shape.points[0];
    const second = shape.points[1];
    const selectionX = Math.min(first.x, second.x);
    const selectionY = Math.min(first.y, second.y);
    const selectionWidth = Math.abs(second.x - first.x);
    const selectionHeight = Math.abs(second.y - first.y);
    const right = imageRect.x + Math.max(first.x, second.x) * scale;
    const bottom = imageRect.y + Math.max(first.y, second.y) * scale;
    const labelWidth = 82;
    const labelHeight = 60;
    const x = Math.max(4, Math.min(right + 8, width - labelWidth - 4));
    const y = Math.max(4, Math.min(bottom - labelHeight, height - labelHeight - 4));
    return (
      <g
        className="lighttable-selection__dimensions"
        transform={`translate(${x} ${y})`}
      >
        <rect width={labelWidth} height={labelHeight} rx="3" />
        <text x="7" y="14">W: {Math.round(selectionWidth)} px</text>
        <text x="7" y="27">H: {Math.round(selectionHeight)} px</text>
        <text x="7" y="40">X: {Math.round(selectionX)} px</text>
        <text x="7" y="53">Y: {Math.round(selectionY)} px</text>
      </g>
    );
  };

  return (
    draft ? (
        <svg
          className="lighttable-selection"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {renderDraftDimensions(draft)}
        </svg>
      ) : null
  );
};
