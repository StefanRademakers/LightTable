import type {
  BezierPath,
  Color as PsdColor,
  LayerVectorMask,
  UnitsValue,
  VectorContent
} from 'ag-psd';
import {
  createAnchor,
  createSubpath,
  createVectorPath,
  type FillRule,
  type SolidPaint,
  type VectorPaint,
  type VectorElement,
  type VectorStroke,
  type VectorStyle
} from '@lighttable/vector-core';
import type { GradientPaintInstance } from '@lighttable/paint-core';

interface PsdVectorStrokeDescriptor {
  strokeEnabled?: boolean;
  fillEnabled?: boolean;
  lineWidth?: UnitsValue;
  lineDashOffset?: UnitsValue;
  miterLimit?: number;
  lineCapType?: VectorStroke['cap'];
  lineJoinType?: VectorStroke['join'];
  lineAlignment?: 'inside' | 'center' | 'outside';
  lineDashSet?: UnitsValue[];
  opacity?: number;
  content?: VectorContent;
  resolution?: number;
}

export interface PsdVectorShapeSource {
  sourceObjectId?: string;
  name: string;
  vectorFill: unknown | null;
  vectorMask: unknown | null;
  vectorStroke: unknown | null;
}

export interface PsdVectorShapeImportSuccess {
  status: 'native' | 'preview-backed';
  elements: VectorElement[];
  reason: string;
}

export interface PsdVectorShapeImportFailure {
  status: 'unsupported';
  reason: string;
}

export type PsdVectorShapeImport =
  | PsdVectorShapeImportSuccess
  | PsdVectorShapeImportFailure;

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

const srgbToLinear = (value: number) => value <= 0.04045
  ? value / 12.92
  : ((value + 0.055) / 1.055) ** 2.4;

const colorChannels = (color: PsdColor): [number, number, number, number] | null => {
  if ('r' in color && 'g' in color && 'b' in color) {
    const divisor = Math.max(color.r, color.g, color.b, 'a' in color ? color.a : 0) > 1
      ? 255
      : 1;
    return [
      clamp(color.r / divisor),
      clamp(color.g / divisor),
      clamp(color.b / divisor),
      clamp(('a' in color ? color.a : divisor) / divisor)
    ];
  }
  if ('fr' in color && 'fg' in color && 'fb' in color) {
    return [clamp(color.fr), clamp(color.fg), clamp(color.fb), 1];
  }
  if ('k' in color) {
    const gray = 1 - clamp(color.k / 255);
    return [gray, gray, gray, 1];
  }
  return null;
};

const solidPaint = (content: unknown): SolidPaint | null => {
  if (!content || typeof content !== 'object') return null;
  const candidate = content as { type?: unknown; color?: unknown };
  if (candidate.type !== 'color' || !candidate.color) return null;
  const channels = colorChannels(candidate.color as PsdColor);
  if (!channels) return null;
  return {
    type: 'solid',
    color: [
      srgbToLinear(channels[0]),
      srgbToLinear(channels[1]),
      srgbToLinear(channels[2]),
      channels[3]
    ]
  };
};

const normalizedPercent = (value: number | undefined, fallback = 0) => Number.isFinite(value)
  ? clamp(value! > 1 ? value! / 100 : value!, 0, 1)
  : fallback;
const signedPercent = (value: number | undefined) => Number.isFinite(value)
  ? clamp(Math.abs(value!) > 1 ? value! / 100 : value!, -1, 1)
  : 0;

const gradientPaint = (content: unknown, idPrefix: string): GradientPaintInstance | null => {
  if (!content || typeof content !== 'object') return null;
  const source = content as Partial<Extract<VectorContent, { type: 'solid' }>>;
  if (source.type !== 'solid' || !Array.isArray(source.colorStops) || !Array.isArray(source.opacityStops)
    || source.colorStops.length === 0 || source.opacityStops.length === 0) return null;
  const colors = source.colorStops.map((stop, index) => {
    const channels = colorChannels(stop.color);
    return channels ? {
      id: `${idPrefix}:color:${index}`,
      position: clamp(stop.location > 1 ? stop.location / 4096 : stop.location),
      midpoint: normalizedPercent(stop.midpoint, 0.5),
      color: { r: channels[0], g: channels[1], b: channels[2], a: channels[3] }
    } : null;
  });
  if (colors.some((stop) => stop === null)) return null;
  const opacity = source.opacityStops.map((stop, index) => ({
    id: `${idPrefix}:opacity:${index}`,
    position: clamp(stop.location > 1 ? stop.location / 4096 : stop.location),
    midpoint: normalizedPercent(stop.midpoint, 0.5),
    opacity: normalizedPercent(stop.opacity, 1)
  }));
  const shape = source.style ?? 'linear';
  const angle = (source.angle ?? 0) * Math.PI / 180;
  const direction = { x: Math.cos(angle), y: -Math.sin(angle) };
  const scale = Number.isFinite(source.scale)
    ? Math.max(0.01, source.scale! > 10 ? source.scale! / 100 : source.scale!) : 1;
  const radial = shape !== 'linear';
  const extent = scale * (radial ? 0.5 : 1);
  const columnX = { x: direction.x * extent, y: direction.y * extent };
  const columnY = { x: -direction.y * extent, y: direction.x * extent };
  const offsetX = signedPercent(source.offset?.x) * 0.5;
  const offsetY = signedPercent(source.offset?.y) * 0.5;
  return {
    kind: 'gradient',
    asset: {
      id: `${idPrefix}:asset`, name: source.name || 'Photoshop Gradient', type: 'solid',
      smoothness: normalizedPercent(source.smoothness, 1),
      colorStops: colors as NonNullable<(typeof colors)[number]>[], opacityStops: opacity,
      roughness: 0, seed: 0
    },
    shape,
    coordinateSpace: 'object-bounds',
    transform: {
      a: columnX.x, b: columnX.y, c: columnY.x, d: columnY.y,
      tx: 0.5 + offsetX - (radial ? 0 : columnX.x * 0.5),
      ty: 0.5 + offsetY - (radial ? 0 : columnX.y * 0.5)
    },
    reverse: source.reverse ?? false,
    dither: source.dither ?? false,
    interpolation: source.interpolationMethod ?? 'perceptual'
  };
};

const vectorPaint = (content: unknown, idPrefix: string): VectorPaint | null =>
  solidPaint(content) ?? gradientPaint(content, idPrefix);

const isVectorMask = (value: unknown): value is LayerVectorMask => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LayerVectorMask>;
  return Array.isArray(candidate.paths) && candidate.paths.every((path) => (
    path
    && typeof path === 'object'
    && Array.isArray(path.knots)
    && (path.fillRule === 'even-odd' || path.fillRule === 'non-zero')
  ));
};

const unitPixels = (value: UnitsValue | undefined, resolution = 72): number | null => {
  if (!value) return 0;
  switch (value.units) {
    case 'Pixels':
    case 'None': return value.value;
    case 'Points': return value.value * resolution / 72;
    case 'Picas': return value.value * 12 * resolution / 72;
    case 'Inches': return value.value * resolution;
    case 'Millimeters': return value.value * resolution / 25.4;
    case 'Centimeters': return value.value * resolution / 2.54;
    default: return null;
  }
};

const vectorStroke = (
  descriptor: PsdVectorStrokeDescriptor | null,
  fillPaint: VectorPaint | null,
  idPrefix: string
): { stroke: VectorStroke | null; opacity: number } | null => {
  if (!descriptor?.strokeEnabled) return { stroke: null, opacity: 1 };
  const paint = vectorPaint(descriptor.content, `${idPrefix}:stroke-gradient`);
  const width = unitPixels(descriptor.lineWidth, descriptor.resolution ?? 72);
  const dashOffset = unitPixels(descriptor.lineDashOffset, descriptor.resolution ?? 72);
  if (!paint || width === null || dashOffset === null) return null;
  const dash = (descriptor.lineDashSet ?? []).map((entry) =>
    unitPixels(entry, descriptor.resolution ?? 72));
  if (dash.some((entry) => entry === null)) return null;
  const sourceOpacity = descriptor.opacity ?? 1;
  // ag-psd exposes modern Photoshop stroke opacity as a normalized 0..1
  // value, while older descriptors can still contain a 0..100 percentage.
  const opacity = clamp(sourceOpacity > 1 ? sourceOpacity / 100 : sourceOpacity);
  // LightTable currently has one opacity for the complete vector style. A
  // differently translucent stroke and fill would require two semantic nodes.
  if (fillPaint && opacity < 1) return null;
  return {
    stroke: {
      paint,
      width: Math.max(0, width),
      alignment: descriptor.lineAlignment ?? 'center',
      cap: descriptor.lineCapType ?? 'butt',
      join: descriptor.lineJoinType ?? 'miter',
      miterLimit: Math.max(1, descriptor.miterLimit ?? 4),
      dash: dash.map((entry) => Math.max(0, entry!)),
      dashOffset
    },
    opacity
  };
};

const pointEquals = (a: readonly number[], ax: number, ay: number) =>
  Math.abs((a[ax] ?? 0) - (a[2] ?? 0)) < 1e-5
  && Math.abs((a[ay] ?? 0) - (a[3] ?? 0)) < 1e-5;

const mapPath = (path: BezierPath, pathIndex: number, idPrefix: string) => createSubpath(
  `${idPrefix}-subpath-${pathIndex}`,
  path.knots.map((knot, knotIndex) => createAnchor(
    `${idPrefix}-anchor-${pathIndex}-${knotIndex}`,
    { x: knot.points[2]!, y: knot.points[3]! },
    {
      handleIn: pointEquals(knot.points, 0, 1)
        ? null
        : { x: knot.points[0]!, y: knot.points[1]! },
      handleOut: pointEquals(knot.points, 4, 5)
        ? null
        : { x: knot.points[4]!, y: knot.points[5]! },
      mode: knot.linked ? 'smooth' : 'corner'
    }
  )),
  !path.open
);

const mapFillRule = (rule: BezierPath['fillRule']): FillRule =>
  rule === 'even-odd' ? 'evenodd' : 'nonzero';

export const importPsdVectorShape = (
  source: PsdVectorShapeSource
): PsdVectorShapeImport => {
  if (!isVectorMask(source.vectorMask)) {
    return { status: 'unsupported', reason: 'Photoshop vector path data is missing or malformed.' };
  }
  const mask = source.vectorMask;
  if (mask.disable) {
    return { status: 'unsupported', reason: 'The Photoshop vector mask is disabled.' };
  }
  if (mask.invert || mask.fillStartsWithAllPixels) {
    return {
      status: 'unsupported',
      reason: 'Inverse/full-canvas Photoshop vector masks require boolean canvas geometry.'
    };
  }
  if (mask.paths.some(({ operation }) => operation && operation !== 'combine')) {
    return {
      status: 'unsupported',
      reason: 'Subtract, intersect and exclude Photoshop path operations are not native yet.'
    };
  }
  const strokeDescriptor = source.vectorStroke && typeof source.vectorStroke === 'object'
    ? source.vectorStroke as PsdVectorStrokeDescriptor
    : null;
  const fillEnabled = strokeDescriptor?.fillEnabled !== false;
  const idPrefix = source.sourceObjectId?.trim() || 'psd-shape';
  const fill = fillEnabled ? vectorPaint(source.vectorFill, `${idPrefix}:fill-gradient`) : null;
  const unsupportedFill = Boolean(fillEnabled && source.vectorFill && !fill);
  const mappedStroke = vectorStroke(strokeDescriptor, fill, idPrefix);
  const unsupportedStroke = mappedStroke === null;

  const elements: VectorElement[] = [];
  const pathGroups = new Map<string, {
    fillRule: FillRule;
    open: boolean;
    paths: BezierPath[];
  }>();
  mask.paths.forEach((path) => {
    if (path.knots.length < (path.open ? 2 : 3)) return;
    const fillRule = mapFillRule(path.fillRule);
    const key = `${fillRule}:${path.open ? 'open' : 'closed'}`;
    const group = pathGroups.get(key) ?? { fillRule, open: path.open, paths: [] };
    group.paths.push(path);
    pathGroups.set(key, group);
  });
  let elementIndex = 0;
  pathGroups.forEach(({ paths, fillRule, open }) => {
    const currentElementIndex = elementIndex++;
    const path = createVectorPath(
      `${idPrefix}-vector-${currentElementIndex}`,
      pathGroups.size === 1 ? source.name : `${source.name} ${currentElementIndex + 1}`,
      paths.map((item, pathIndex) => mapPath(
        item,
        currentElementIndex * 1000 + pathIndex,
        idPrefix
      ))
    );
    const style: VectorStyle = {
      fill: open ? null : fill,
      stroke: mappedStroke?.stroke ?? null,
      opacity: mappedStroke?.opacity ?? 1
    };
    path.fillRule = fillRule;
    path.style = style;
    elements.push(path);
  });
  if (elements.length === 0) {
    return { status: 'unsupported', reason: 'The Photoshop vector shape contains no drawable paths.' };
  }
  return {
    status: unsupportedFill || unsupportedStroke ? 'preview-backed' : 'native',
    elements,
    reason: unsupportedFill || unsupportedStroke
      ? `${unsupportedFill ? 'Pattern or noise-gradient fill' : ''}${unsupportedFill && unsupportedStroke ? ' and ' : ''}${unsupportedStroke ? 'stroke paint/opacity' : ''} remains preview-backed while the Photoshop paths stay editable.`
      : 'Photoshop Bézier shape paths and fill/stroke state are mapped to editable LightTable vectors.'
  };
};
