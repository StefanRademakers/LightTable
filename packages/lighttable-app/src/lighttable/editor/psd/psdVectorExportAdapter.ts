import type { BezierPath, LayerVectorMask, VectorContent } from 'ag-psd';
import {
  multiplyMatrices,
  realizeLiveShape,
  transformPoint,
  type AffineMatrix,
  type VectorElement,
  type VectorPaint,
  type VectorStyle
} from '@lighttable/vector-core';
import type { GradientPaintInstance } from '@lighttable/paint-core';
import { linearChannelToSrgb } from '../../colorMath';

const rgba = (value: readonly [number, number, number, number], opacity = 1) => ({
  r: Math.round(Math.min(1, Math.max(0, linearChannelToSrgb(value[0]))) * 255),
  g: Math.round(Math.min(1, Math.max(0, linearChannelToSrgb(value[1]))) * 255),
  b: Math.round(Math.min(1, Math.max(0, linearChannelToSrgb(value[2]))) * 255),
  a: Math.round(Math.min(1, Math.max(0, value[3] * opacity)) * 255)
});

const photoshopGradientGeometry = (paint: GradientPaintInstance) => {
  if (paint.coordinateSpace !== 'object-bounds' || (paint.spread ?? 'pad') !== 'pad') return null;
  const { a, b, c, d, tx, ty } = paint.transform;
  const extent = Math.hypot(a, b);
  const tolerance = Math.max(1, extent) * 1e-6;
  if (extent < 1e-9 || Math.abs(c + b) > tolerance || Math.abs(d - a) > tolerance) return null;
  const radial = paint.shape !== 'linear';
  const scale = (radial ? extent * 2 : extent) * 100;
  const offsetX = (tx - 0.5 + (radial ? 0 : a * 0.5)) * 200;
  const offsetY = (ty - 0.5 + (radial ? 0 : b * 0.5)) * 200;
  return {
    angle: Math.atan2(-b, a) * 180 / Math.PI,
    scale,
    offset: { x: offsetX, y: offsetY }
  };
};

const gradient = (paint: GradientPaintInstance, opacity = 1): VectorContent => paint.asset.type === 'noise'
  ? ({
    name: paint.asset.name,
    type: 'noise',
    roughness: paint.asset.roughness,
    randomSeed: paint.asset.seed,
    colorModel: 'rgb' as const,
    min: [0, 0, 0, 0], max: [1, 1, 1, 1],
    style: paint.shape, reverse: paint.reverse, dither: paint.dither,
    interpolationMethod: paint.interpolation,
    ...photoshopGradientGeometry(paint)
  })
  : ({
    name: paint.asset.name,
    type: 'solid',
    smoothness: paint.asset.smoothness,
    colorStops: paint.asset.colorStops.map((stop) => ({
      color: { r: Math.round(stop.color.r * 255), g: Math.round(stop.color.g * 255),
        b: Math.round(stop.color.b * 255), a: Math.round(stop.color.a * 255) },
      location: stop.position, midpoint: stop.midpoint
    })),
    opacityStops: paint.asset.opacityStops.map((stop) => ({
      opacity: stop.opacity * opacity, location: stop.position, midpoint: stop.midpoint
    })),
    style: paint.shape, reverse: paint.reverse, dither: paint.dither,
    interpolationMethod: paint.interpolation,
    ...photoshopGradientGeometry(paint)
  });

const content = (paint: VectorPaint, opacity = 1): VectorContent => {
  if ('type' in paint) return { type: 'color', color: rgba(paint.color, opacity) };
  return gradient(paint, opacity);
};

export interface PsdVectorProjection {
  vectorMask: LayerVectorMask;
  vectorFill?: VectorContent;
  vectorStroke: {
    strokeEnabled: boolean;
    fillEnabled: boolean;
    lineWidth?: { units: 'Pixels'; value: number };
    lineDashOffset?: { units: 'Pixels'; value: number };
    miterLimit?: number;
    lineCapType?: 'butt' | 'round' | 'square';
    lineJoinType?: 'miter' | 'round' | 'bevel';
    lineAlignment?: 'inside' | 'center' | 'outside';
    lineDashSet?: { units: 'Pixels'; value: number }[];
    scaleLock?: boolean;
    strokeAdjust?: boolean;
    blendMode: 'normal';
    opacity: number;
    content?: VectorContent;
    resolution: number;
  };
}

type PreservedStrokeMetadata = {
  readonly resolution?: number;
  readonly scaleLock?: boolean;
  readonly strokeAdjust?: boolean;
};

const projectPath = (element: VectorElement, layerTransform: AffineMatrix): {
  paths: BezierPath[]; style: VectorStyle;
} => {
  const path = element.type === 'path' ? element : realizeLiveShape(element);
  const matrix = multiplyMatrices(layerTransform, path.transform);
  return {
    style: path.style,
    paths: path.subpaths.map((subpath) => ({
      open: !subpath.closed,
      operation: 'combine',
      fillRule: path.fillRule === 'evenodd' ? 'even-odd' : 'non-zero',
      knots: subpath.anchors.map((anchor) => {
        const position = transformPoint(matrix, anchor.position);
        const handleIn = transformPoint(matrix, anchor.handleIn ?? anchor.position);
        const handleOut = transformPoint(matrix, anchor.handleOut ?? anchor.position);
        return {
          linked: anchor.mode !== 'corner',
          points: [handleIn.x, handleIn.y, position.x, position.y, handleOut.x, handleOut.y]
        };
      })
    }))
  };
};

/** Exports a vector layer when its elements share one Photoshop fill/stroke style. */
export const exportVectorLayerToPsd = (
  elements: readonly VectorElement[],
  layerTransform: AffineMatrix,
  inactiveFill?: VectorContent | null,
  preservedStroke?: PreservedStrokeMetadata | null
): PsdVectorProjection | undefined => {
  if (elements.length === 0) return undefined;
  const projected = elements.map((element) => projectPath(element, layerTransform));
  const signature = (style: VectorStyle) => JSON.stringify(style);
  if (projected.some((entry) => signature(entry.style) !== signature(projected[0]!.style))) {
    return undefined;
  }
  const style = projected[0]!.style;
  const gradientPaints = [style.fill, style.stroke?.paint].filter(
    (paint): paint is GradientPaintInstance => Boolean(paint && 'kind' in paint)
  );
  // PSD gradients are object-relative, clamped and similarity-transformed.
  // Refuse native projection when SVG/PDF semantics cannot round-trip; the
  // document exporter can then choose an explicit raster fallback.
  if (gradientPaints.some((paint) => !photoshopGradientGeometry(paint))) return undefined;
  return {
    vectorMask: {
      fillStartsWithAllPixels: false,
      paths: projected.flatMap((entry) => entry.paths)
    },
    // Photoshop still models a stroke-only shape as a solid-fill content layer
    // whose fill is disabled in `vstk`. Keeping a dormant fill descriptor makes
    // the path remain a fully editable Shape layer and lets Fill be enabled later.
    vectorFill: style.fill
      ? content(style.fill, style.opacity)
      : inactiveFill ?? { type: 'color', color: { r: 0, g: 0, b: 0, a: 255 } },
    vectorStroke: {
      strokeEnabled: Boolean(style.stroke),
      fillEnabled: Boolean(style.fill),
      ...(style.stroke ? {
        lineWidth: { units: 'Pixels', value: style.stroke.width },
        lineDashOffset: { units: 'Pixels', value: style.stroke.dashOffset },
        miterLimit: style.stroke.miterLimit,
        lineCapType: style.stroke.cap,
        lineJoinType: style.stroke.join,
        lineAlignment: style.stroke.alignment ?? 'center',
        lineDashSet: style.stroke.dash.map((value) => ({ units: 'Pixels', value })),
        scaleLock: preservedStroke?.scaleLock,
        strokeAdjust: preservedStroke?.strokeAdjust,
        content: content(style.stroke.paint)
      } : {}),
      blendMode: 'normal', opacity: style.opacity * (style.stroke?.opacity ?? 1),
      resolution: preservedStroke?.resolution ?? 72
    }
  };
};
