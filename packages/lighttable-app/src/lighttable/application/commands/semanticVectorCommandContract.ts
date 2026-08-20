import type { AffineMatrix, ArrowheadGeometry, LiveShapeGeometry, VectorStyle,
  VectorSubpath } from '@lighttable/vector-core';
import { BLEND_MODES, type BlendMode } from '../../editor/document/blendModes';
import { validGradientPaintCommand } from './gradientPaintCommandContract';

export interface SemanticVectorPathAnchor {
  readonly id?: string;
  readonly x: number;
  readonly y: number;
  readonly handleIn?: { readonly x: number; readonly y: number } | null;
  readonly handleOut?: { readonly x: number; readonly y: number } | null;
  readonly mode?: 'corner' | 'smooth' | 'symmetric';
}
export interface SemanticVectorSubpath {
  readonly id?: string;
  readonly closed: boolean;
  readonly anchors: readonly SemanticVectorPathAnchor[];
}
export type SemanticVectorPrimitive =
  | { readonly kind: 'rectangle'; readonly x: number; readonly y: number; readonly width: number;
      readonly height: number; readonly cornerRadii?: readonly [number, number, number, number];
      readonly linkedCorners?: boolean }
  | { readonly kind: 'ellipse'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: 'triangle'; readonly x: number; readonly y: number; readonly width: number;
      readonly height: number; readonly cornerRadius?: number }
  | { readonly kind: 'star'; readonly cx: number; readonly cy: number; readonly points: number;
      readonly outerRadius: number; readonly innerRadius: number; readonly rotationRadians?: number;
      readonly cornerRadius?: number }
  | { readonly kind: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number;
      readonly startArrow?: ArrowheadGeometry | null; readonly endArrow?: ArrowheadGeometry | null };

export interface SemanticVectorStylePatch {
  readonly fill?: VectorStyle['fill'];
  readonly stroke?: VectorStyle['stroke'];
  readonly opacity?: number;
}

export type SemanticVectorCommand =
  | { readonly kind: 'create'; readonly layerId?: string; readonly layerName?: string; readonly name?: string;
      readonly layerRole?: 'artwork' | 'gradient-fill'; readonly layerOpacity?: number;
      readonly layerBlendMode?: BlendMode;
      readonly primitive?: SemanticVectorPrimitive; readonly subpaths?: readonly SemanticVectorSubpath[];
      readonly fillRule?: 'nonzero' | 'evenodd'; readonly style?: SemanticVectorStylePatch;
      readonly transform?: AffineMatrix }
  | { readonly kind: 'update'; readonly layerId: string; readonly elementId: string;
      readonly name?: string; readonly transform?: AffineMatrix; readonly style?: SemanticVectorStylePatch;
      readonly geometry?: LiveShapeGeometry; readonly subpaths?: readonly SemanticVectorSubpath[];
      readonly fillRule?: 'nonzero' | 'evenodd' }
  | { readonly kind: 'remove'; readonly layerId: string; readonly elementId: string };

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]) => (
  Object.keys(value).every((key) => allowed.includes(key))
);
const finite = (value: unknown, min = -10_000_000, max = 10_000_000): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
);
const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 255;
const blendMode = (value: unknown): value is BlendMode => BLEND_MODES.some(({ id }) => id === value);
const point = (value: unknown) => record(value) && exactKeys(value, ['x', 'y'])
  && finite(value.x) && finite(value.y);
const matrix = (value: unknown) => record(value)
  && ['a', 'b', 'c', 'd', 'tx', 'ty'].every((key) => finite(value[key]));

const validPaint = (value: unknown) => record(value) && (
  (value.type === 'solid' && exactKeys(value, ['type', 'color'])
    && Array.isArray(value.color) && value.color.length === 4
    && value.color.every((channel) => finite(channel, 0, 1))) || validGradientPaintCommand(value)
);
const validStyle = (value: unknown) => {
  if (value === undefined) return true;
  if (!record(value) || !exactKeys(value, ['fill', 'stroke', 'opacity'])
    || (value.opacity !== undefined && !finite(value.opacity, 0, 1))) return false;
  if (value.fill !== undefined && value.fill !== null && !validPaint(value.fill)) return false;
  if (value.stroke !== undefined && value.stroke !== null) {
    if (!record(value.stroke) || !exactKeys(value.stroke, [
      'paint', 'opacity', 'width', 'alignment', 'cap', 'join', 'miterLimit', 'dash', 'dashOffset'
    ]) || !validPaint(value.stroke.paint) || !finite(value.stroke.width, 0, 100_000)
      || (value.stroke.opacity !== undefined && !finite(value.stroke.opacity, 0, 1))
      || (value.stroke.alignment !== undefined
        && !['inside', 'center', 'outside'].includes(String(value.stroke.alignment)))
      || !['butt', 'round', 'square'].includes(String(value.stroke.cap))
      || !['miter', 'round', 'bevel'].includes(String(value.stroke.join))
      || !finite(value.stroke.miterLimit, 0, 100_000)
      || !finite(value.stroke.dashOffset, -100_000, 100_000)
      || !Array.isArray(value.stroke.dash) || value.stroke.dash.length > 64
      || !value.stroke.dash.every((part) => finite(part, 0, 100_000))) return false;
  }
  return true;
};
const validAnchor = (value: unknown) => record(value)
  && exactKeys(value, ['id', 'x', 'y', 'handleIn', 'handleOut', 'mode'])
  && finite(value.x) && finite(value.y)
  && (value.id === undefined || id(value.id))
  && (value.mode === undefined || ['corner', 'smooth', 'symmetric'].includes(String(value.mode)))
  && (value.handleIn === undefined || value.handleIn === null || point(value.handleIn))
  && (value.handleOut === undefined || value.handleOut === null || point(value.handleOut));
const validSubpaths = (value: unknown): value is readonly SemanticVectorSubpath[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) return false;
  let anchors = 0;
  return value.every((subpath) => {
    if (!record(subpath) || !exactKeys(subpath, ['id', 'closed', 'anchors'])
      || typeof subpath.closed !== 'boolean' || !Array.isArray(subpath.anchors)
      || (subpath.id !== undefined && !id(subpath.id))) return false;
    anchors += subpath.anchors.length;
    return anchors <= 8192 && subpath.anchors.every(validAnchor);
  });
};
const validPrimitive = (value: unknown): value is SemanticVectorPrimitive => {
  if (!record(value)) return false;
  if (value.kind === 'rectangle') return exactKeys(value,
    ['kind', 'x', 'y', 'width', 'height', 'cornerRadii', 'linkedCorners'])
    && finite(value.x) && finite(value.y) && finite(value.width, 0)
    && finite(value.height, 0) && (value.cornerRadii === undefined || (Array.isArray(value.cornerRadii)
      && value.cornerRadii.length === 4 && value.cornerRadii.every((radius) => finite(radius, 0))))
    && (value.linkedCorners === undefined || typeof value.linkedCorners === 'boolean');
  if (value.kind === 'ellipse') return exactKeys(value, ['kind', 'x', 'y', 'width', 'height'])
    && finite(value.x) && finite(value.y)
    && finite(value.width, 0) && finite(value.height, 0);
  if (value.kind === 'triangle') return exactKeys(value,
    ['kind', 'x', 'y', 'width', 'height', 'cornerRadius']) && finite(value.x) && finite(value.y)
    && finite(value.width, 0) && finite(value.height, 0)
    && (value.cornerRadius === undefined || finite(value.cornerRadius, 0));
  if (value.kind === 'star') return exactKeys(value,
    ['kind', 'cx', 'cy', 'points', 'outerRadius', 'innerRadius', 'rotationRadians', 'cornerRadius'])
    && finite(value.cx) && finite(value.cy)
    && Number.isInteger(value.points) && Number(value.points) >= 3 && Number(value.points) <= 2048
    && finite(value.outerRadius, 0) && finite(value.innerRadius, 0)
    && (value.rotationRadians === undefined || finite(value.rotationRadians))
    && (value.cornerRadius === undefined || finite(value.cornerRadius, 0));
  const arrow = (entry: unknown) => entry === undefined || entry === null || (record(entry)
    && exactKeys(entry, ['width', 'length', 'concavity'])
    && finite(entry.width, 0) && finite(entry.length, 0) && finite(entry.concavity, 0, 1));
  return value.kind === 'line' && exactKeys(value,
    ['kind', 'x1', 'y1', 'x2', 'y2', 'startArrow', 'endArrow'])
    && finite(value.x1) && finite(value.y1) && finite(value.x2) && finite(value.y2)
    && arrow(value.startArrow) && arrow(value.endArrow);
};

const validLiveGeometry = (value: unknown): value is LiveShapeGeometry => {
  if (!record(value)) return false;
  if (value.kind === 'rectangle') return exactKeys(value,
    ['kind', 'width', 'height', 'cornerRadii', 'linkedCorners'])
    && finite(value.width, 0) && finite(value.height, 0)
    && Array.isArray(value.cornerRadii) && value.cornerRadii.length === 4
    && value.cornerRadii.every((radius) => finite(radius, 0))
    && typeof value.linkedCorners === 'boolean';
  if (value.kind === 'ellipse') return exactKeys(value, ['kind', 'width', 'height'])
    && finite(value.width, 0) && finite(value.height, 0);
  if (value.kind === 'triangle') return exactKeys(value, ['kind', 'width', 'height', 'cornerRadius'])
    && finite(value.width, 0) && finite(value.height, 0) && finite(value.cornerRadius, 0);
  if (value.kind === 'polygon') return exactKeys(value,
    ['kind', 'sides', 'radius', 'rotationRadians', 'cornerRadius'])
    && Number.isInteger(value.sides) && Number(value.sides) >= 3 && Number(value.sides) <= 2048
    && finite(value.radius, 0) && finite(value.rotationRadians) && finite(value.cornerRadius, 0);
  if (value.kind === 'star') return exactKeys(value,
    ['kind', 'points', 'outerRadius', 'innerRadius', 'rotationRadians', 'cornerRadius'])
    && Number.isInteger(value.points) && Number(value.points) >= 3 && Number(value.points) <= 2048
    && finite(value.outerRadius, 0) && finite(value.innerRadius, 0)
    && finite(value.rotationRadians) && finite(value.cornerRadius, 0);
  const arrow = (entry: unknown) => entry === null || (record(entry)
    && exactKeys(entry, ['width', 'length', 'concavity'])
    && finite(entry.width, 0) && finite(entry.length, 0) && finite(entry.concavity, 0, 1));
  return value.kind === 'line' && exactKeys(value,
    ['kind', 'start', 'end', 'startArrow', 'endArrow'])
    && point(value.start) && point(value.end) && arrow(value.startArrow) && arrow(value.endArrow);
};

export const parseSemanticVectorCommand = (
  kind: SemanticVectorCommand['kind'], value: unknown
): SemanticVectorCommand | { readonly message: string } => {
  if (!record(value)) return { message: 'Vector command parameters must be an object.' };
  if (kind === 'create') {
    if (!exactKeys(value, ['layerId', 'layerName', 'name', 'layerRole', 'layerOpacity',
      'layerBlendMode', 'primitive', 'subpaths', 'fillRule', 'style', 'transform'])) {
      return { message: 'Vector creation parameters contain unsupported state.' };
    }
    const hasPrimitive = value.primitive !== undefined; const hasPath = value.subpaths !== undefined;
    if (hasPrimitive === hasPath || (hasPrimitive && !validPrimitive(value.primitive))
      || (hasPath && !validSubpaths(value.subpaths)) || !validStyle(value.style)
      || (value.layerId !== undefined && !id(value.layerId))
      || (value.layerName !== undefined && !id(value.layerName))
      || (value.layerRole !== undefined && value.layerRole !== 'artwork' && value.layerRole !== 'gradient-fill')
      || (value.layerOpacity !== undefined && !finite(value.layerOpacity, 0, 1))
      || (value.layerBlendMode !== undefined && !blendMode(value.layerBlendMode))
      || (value.layerId !== undefined && (value.layerRole !== undefined
        || value.layerOpacity !== undefined || value.layerBlendMode !== undefined))
      || (value.name !== undefined && !id(value.name))
      || (value.transform !== undefined && !matrix(value.transform))
      || (value.fillRule !== undefined && value.fillRule !== 'nonzero' && value.fillRule !== 'evenodd')) {
      return { message: 'Vector creation parameters are invalid or exceed the geometry limits.' };
    }
  } else if (!exactKeys(value, kind === 'update'
    ? ['layerId', 'elementId', 'name', 'transform', 'style', 'geometry', 'subpaths', 'fillRule']
    : ['layerId', 'elementId']) || !id(value.layerId) || !id(value.elementId)) {
    return { message: 'Vector edits require valid layerId and elementId values.' };
  } else if (kind === 'update' && ((value.name !== undefined && !id(value.name))
    || (value.transform !== undefined && !matrix(value.transform)) || !validStyle(value.style)
    || (value.subpaths !== undefined && !validSubpaths(value.subpaths))
    || (value.geometry !== undefined && !validLiveGeometry(value.geometry))
    || Object.keys(value).length < 3
    || (value.geometry !== undefined && (value.subpaths !== undefined || value.fillRule !== undefined))
    || (value.fillRule !== undefined && value.fillRule !== 'nonzero' && value.fillRule !== 'evenodd'))) {
    return { message: 'Vector update parameters are invalid or exceed the geometry limits.' };
  }
  return structuredClone({ ...value, kind }) as SemanticVectorCommand;
};

export const canonicalSubpathsFromSemantic = (
  subpaths: readonly SemanticVectorSubpath[], ids: (kind: string) => string
): VectorSubpath[] => subpaths.map((subpath) => ({
  id: subpath.id ?? ids('subpath'), closed: subpath.closed,
  anchors: subpath.anchors.map((anchor) => ({ id: anchor.id ?? ids('anchor'),
    position: { x: anchor.x, y: anchor.y }, handleIn: anchor.handleIn ? { ...anchor.handleIn } : null,
    handleOut: anchor.handleOut ? { ...anchor.handleOut } : null, mode: anchor.mode ?? 'corner' }))
}));
