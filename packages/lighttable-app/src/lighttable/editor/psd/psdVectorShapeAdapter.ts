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
  type VectorElement,
  type VectorStroke,
  type VectorStyle
} from '@lighttable/vector-core';

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
  status: 'native';
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
  fillPaint: SolidPaint | null
): { stroke: VectorStroke | null; opacity: number } | null => {
  if (!descriptor?.strokeEnabled) return { stroke: null, opacity: 1 };
  if (descriptor.lineAlignment && descriptor.lineAlignment !== 'center') return null;
  const paint = solidPaint(descriptor.content);
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
  const fill = fillEnabled ? solidPaint(source.vectorFill) : null;
  if (fillEnabled && source.vectorFill && !fill) {
    return {
      status: 'unsupported',
      reason: 'Gradient and pattern Photoshop shape fills are preserved through the raster preview.'
    };
  }
  const mappedStroke = vectorStroke(strokeDescriptor, fill);
  if (!mappedStroke) {
    return {
      status: 'unsupported',
      reason: 'The Photoshop stroke uses alignment, paint or opacity semantics not native yet.'
    };
  }
  if (!fill && !mappedStroke.stroke) {
    return { status: 'unsupported', reason: 'The Photoshop vector shape has no visible fill or stroke.' };
  }

  const elements: VectorElement[] = [];
  const idPrefix = source.sourceObjectId?.trim() || 'psd-shape';
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
      stroke: mappedStroke.stroke,
      opacity: mappedStroke.opacity
    };
    path.fillRule = fillRule;
    path.style = style;
    elements.push(path);
  });
  if (elements.length === 0) {
    return { status: 'unsupported', reason: 'The Photoshop vector shape contains no drawable paths.' };
  }
  return {
    status: 'native',
    elements,
    reason: 'Solid Photoshop Bézier shape paths are mapped to editable LightTable vector paths.'
  };
};
