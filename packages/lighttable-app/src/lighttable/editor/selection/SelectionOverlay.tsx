import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  SelectionOperation,
  SelectionShape
} from './selectionTypes';

export interface SelectionOverlayProps {
  operations: SelectionOperation[];
  draft: SelectionShape | null;
  imageRect: { x: number; y: number };
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

export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({
  operations,
  draft,
  imageRect,
  scale,
  width,
  height
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const directVectorSelection = isDirectVectorSelection(operations)
    ? operations[0].shape
    : null;
  const currentViewport = useMemo<RasterViewportSnapshot>(() => ({
    imageX: imageRect.x,
    imageY: imageRect.y,
    scale,
    width,
    height
  }), [height, imageRect.x, imageRect.y, scale, width]);
  const [rasterViewport, setRasterViewport] = useState(currentViewport);

  useEffect(() => {
    if (directVectorSelection || sameRasterViewport(rasterViewport, currentViewport)) return;
    // Keep the previous raster mask moving with the viewport while wheel/pan
    // input is active. Re-rasterize once the interaction settles so composite
    // and feathered outlines regain one-device-pixel sharpness without putting
    // getImageData plus a full pixel scan on every input event.
    const timeout = window.setTimeout(() => {
      setRasterViewport(currentViewport);
    }, 160);
    return () => window.clearTimeout(timeout);
  }, [currentViewport, directVectorSelection, rasterViewport]);

  useEffect(() => {
    // The common single-shape case is rendered as SVG below. In particular,
    // this keeps pan and zoom from rebuilding and reading back a viewport-sized
    // CPU mask merely to move an ellipse or rectangle outline.
    if (directVectorSelection) return;
    const canvas = canvasRef.current;
    if (!canvas || rasterViewport.width <= 0 || rasterViewport.height <= 0) return;
    canvas.width = Math.max(1, Math.round(rasterViewport.width));
    canvas.height = Math.max(1, Math.round(rasterViewport.height));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;

    const mask = document.createElement('canvas');
    mask.width = canvas.width;
    mask.height = canvas.height;
    const maskContext = mask.getContext('2d', { willReadFrequently: true });
    const shape = document.createElement('canvas');
    shape.width = canvas.width;
    shape.height = canvas.height;
    const shapeContext = shape.getContext('2d');
    if (!maskContext || !shapeContext) return;

    const traceShape = (selectionShape: SelectionShape) => {
      const points = selectionShape.points.map((point) => ({
        x: rasterViewport.imageX + point.x * rasterViewport.scale,
        y: rasterViewport.imageY + point.y * rasterViewport.scale
      }));
      if (!points.length) return false;
      shapeContext.beginPath();
      if (selectionShape.kind === 'free' || selectionShape.kind === 'polygon') {
        if (points.length < 3) return false;
        shapeContext.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach((point) => shapeContext.lineTo(point.x, point.y));
        shapeContext.closePath();
        return true;
      }
      if (points.length < 2) return false;
      const left = Math.min(points[0].x, points[1].x);
      const top = Math.min(points[0].y, points[1].y);
      const shapeWidth = Math.abs(points[1].x - points[0].x);
      const shapeHeight = Math.abs(points[1].y - points[0].y);
      if (selectionShape.kind === 'ellipse') {
        shapeContext.ellipse(
          left + shapeWidth / 2,
          top + shapeHeight / 2,
          shapeWidth / 2,
          shapeHeight / 2,
          0,
          0,
          Math.PI * 2
        );
      } else {
        shapeContext.rect(left, top, shapeWidth, shapeHeight);
      }
      return true;
    };

    operations.forEach((operation) => {
      if (operation.mode === 'feather') {
        const radius = Math.max(0, operation.amount ?? 0) * rasterViewport.scale;
        if (radius <= 0) return;
        shapeContext.clearRect(0, 0, shape.width, shape.height);
        shapeContext.filter = `blur(${radius}px)`;
        shapeContext.drawImage(mask, 0, 0);
        shapeContext.filter = 'none';
        maskContext.clearRect(0, 0, mask.width, mask.height);
        maskContext.drawImage(shape, 0, 0);
        return;
      }
      if (operation.mode === 'invert') {
        const pixels = maskContext.getImageData(0, 0, mask.width, mask.height);
        for (let index = 3; index < pixels.data.length; index += 4) {
          pixels.data[index] = 255 - pixels.data[index];
        }
        maskContext.putImageData(pixels, 0, 0);
        return;
      }

      shapeContext.clearRect(0, 0, shape.width, shape.height);
      shapeContext.fillStyle = '#fff';
      if (!traceShape(operation.shape)) return;
      shapeContext.fill();
      if (operation.mode === 'replace') {
        maskContext.clearRect(0, 0, mask.width, mask.height);
      }
      maskContext.globalCompositeOperation = operation.mode === 'subtract'
        ? 'destination-out'
        : operation.mode === 'intersect'
          ? 'destination-in'
          : 'source-over';
      maskContext.drawImage(shape, 0, 0);
      maskContext.globalCompositeOperation = 'source-over';
    });

    const maskPixels = maskContext.getImageData(0, 0, mask.width, mask.height);
    const output = context.createImageData(mask.width, mask.height);
    const isSelected = (x: number, y: number) => (
      x >= 0
      && y >= 0
      && x < mask.width
      && y < mask.height
      && maskPixels.data[(y * mask.width + x) * 4 + 3] >= 128
    );
    for (let y = 0; y < mask.height; y += 1) {
      for (let x = 0; x < mask.width; x += 1) {
        if (!isSelected(x, y)) continue;
        if (
          isSelected(x - 1, y)
          && isSelected(x + 1, y)
          && isSelected(x, y - 1)
          && isSelected(x, y + 1)
        ) continue;
        const outputIndex = (y * mask.width + x) * 4;
        const whiteDash = Math.floor((x + y) / 4) % 2 === 0;
        output.data[outputIndex] = whiteDash ? 255 : 18;
        output.data[outputIndex + 1] = whiteDash ? 255 : 18;
        output.data[outputIndex + 2] = whiteDash ? 255 : 18;
        output.data[outputIndex + 3] = 245;
      }
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.putImageData(output, 0, 0);
  }, [directVectorSelection, operations, rasterViewport]);

  const rasterTransform = useMemo(() => {
    return createRasterViewportTransform(rasterViewport, currentViewport);
  }, [currentViewport, rasterViewport]);

  const renderShape = (shape: SelectionShape, draftStyle: boolean) => {
    const points = shape.points.map((point) => ({
      x: imageRect.x + point.x * scale,
      y: imageRect.y + point.y * scale
    }));
    if (!points.length) return null;
    const className = `lighttable-selection__shape${draftStyle ? ' lighttable-selection__shape--draft' : ''}`;
    if (shape.kind === 'free' || shape.kind === 'polygon') {
      const path = points
        .map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`)
        .join(' ');
      return (
        <>
          <path
            className={className}
            d={shape.kind === 'free' && points.length > 2 ? `${path} Z` : path}
          />
          {draftStyle && shape.kind === 'polygon' && points.length ? (
            <circle
              className={`${className} lighttable-selection__polygon-origin`}
              cx={points[0].x}
              cy={points[0].y}
              r="4"
            />
          ) : null}
        </>
      );
    }
    if (points.length < 2) return null;
    const left = Math.min(points[0].x, points[1].x);
    const top = Math.min(points[0].y, points[1].y);
    const shapeWidth = Math.abs(points[1].x - points[0].x);
    const shapeHeight = Math.abs(points[1].y - points[0].y);
    if (shape.kind === 'ellipse') {
      return (
        <ellipse
          className={className}
          cx={left + shapeWidth / 2}
          cy={top + shapeHeight / 2}
          rx={shapeWidth / 2}
          ry={shapeHeight / 2}
        />
      );
    }
    return (
      <rect
        className={className}
        x={left}
        y={top}
        width={shapeWidth}
        height={shapeHeight}
      />
    );
  };

  const renderDraftDimensions = (shape: SelectionShape) => {
    if (shape.kind !== 'rectangle' || shape.points.length < 2) return null;
    const first = shape.points[0];
    const second = shape.points[1];
    const selectionWidth = Math.abs(second.x - first.x);
    const selectionHeight = Math.abs(second.y - first.y);
    const right = imageRect.x + Math.max(first.x, second.x) * scale;
    const bottom = imageRect.y + Math.max(first.y, second.y) * scale;
    const labelWidth = 76;
    const labelHeight = 34;
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
      </g>
    );
  };

  return (
    <>
      {directVectorSelection ? (
        <svg
          className="lighttable-selection"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {renderShape(directVectorSelection, false)}
        </svg>
      ) : (
        <canvas
          ref={canvasRef}
          className="lighttable-selection"
          style={{
            height: rasterViewport.height,
            transform: rasterTransform,
            transformOrigin: '0 0',
            width: rasterViewport.width
          }}
          aria-hidden="true"
        />
      )}
      {draft ? (
        <svg
          className="lighttable-selection"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {renderShape(draft, true)}
          {renderDraftDimensions(draft)}
        </svg>
      ) : null}
    </>
  );
};
