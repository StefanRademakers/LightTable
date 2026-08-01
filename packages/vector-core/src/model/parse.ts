import type { AffineMatrix } from '../math/affine';
import type { Vec2 } from '../math/vector';
import type {
  AnchorMode,
  FillRule,
  LiveShapeGeometry,
  SolidPaint,
  VectorAnchor,
  VectorElement,
  VectorLiveShape,
  VectorPath,
  VectorStroke,
  VectorStyle,
  VectorSubpath
} from './types';
import { validateVectorLiveShape, validateVectorPath } from './validation';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const finiteNumber = (value: unknown, location: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${location} must be a finite number.`);
  }
  return value;
};

const nonNegativeInteger = (value: unknown, location: string): number => {
  const number = finiteNumber(value, location);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${location} must be a non-negative integer.`);
  }
  return number;
};

const stringValue = (value: unknown, location: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${location} must be a non-empty string.`);
  }
  return value;
};

const parseVec2 = (value: unknown, location: string): Vec2 => {
  if (!isRecord(value)) throw new Error(`${location} must be a point.`);
  return {
    x: finiteNumber(value.x, `${location}.x`),
    y: finiteNumber(value.y, `${location}.y`)
  };
};

const parseAffineMatrix = (value: unknown, location: string): AffineMatrix => {
  if (!isRecord(value)) throw new Error(`${location} must be an affine matrix.`);
  return {
    a: finiteNumber(value.a, `${location}.a`),
    b: finiteNumber(value.b, `${location}.b`),
    c: finiteNumber(value.c, `${location}.c`),
    d: finiteNumber(value.d, `${location}.d`),
    tx: finiteNumber(value.tx, `${location}.tx`),
    ty: finiteNumber(value.ty, `${location}.ty`)
  };
};

const parseSolidPaint = (value: unknown, location: string): SolidPaint => {
  if (!isRecord(value) || value.type !== 'solid' || !Array.isArray(value.color) || value.color.length !== 4) {
    throw new Error(`${location} must be a solid RGBA paint.`);
  }
  const color = value.color.map((channel, index) => finiteNumber(channel, `${location}.color[${index}]`));
  return { type: 'solid', color: [color[0], color[1], color[2], color[3]] };
};

const parseStroke = (value: unknown, location: string): VectorStroke => {
  if (!isRecord(value)) throw new Error(`${location} must be a stroke.`);
  if (value.cap !== 'butt' && value.cap !== 'round' && value.cap !== 'square') {
    throw new Error(`${location}.cap is invalid.`);
  }
  if (value.join !== 'miter' && value.join !== 'round' && value.join !== 'bevel') {
    throw new Error(`${location}.join is invalid.`);
  }
  if (!Array.isArray(value.dash)) throw new Error(`${location}.dash must be an array.`);
  const width = finiteNumber(value.width, `${location}.width`);
  const miterLimit = finiteNumber(value.miterLimit, `${location}.miterLimit`);
  const dash = value.dash.map((part, index) => finiteNumber(part, `${location}.dash[${index}]`));
  if (width < 0 || miterLimit < 0 || dash.some((part) => part < 0)) {
    throw new Error(`${location} dimensions must not be negative.`);
  }
  return {
    paint: parseSolidPaint(value.paint, `${location}.paint`),
    width,
    cap: value.cap,
    join: value.join,
    miterLimit,
    dash,
    dashOffset: finiteNumber(value.dashOffset, `${location}.dashOffset`)
  };
};

const parseStyle = (value: unknown, location: string): VectorStyle => {
  if (!isRecord(value)) throw new Error(`${location} must be a vector style.`);
  const opacity = finiteNumber(value.opacity, `${location}.opacity`);
  if (opacity < 0 || opacity > 1) throw new Error(`${location}.opacity must be between 0 and 1.`);
  return {
    fill: value.fill === null ? null : parseSolidPaint(value.fill, `${location}.fill`),
    stroke: value.stroke === null ? null : parseStroke(value.stroke, `${location}.stroke`),
    opacity
  };
};

const parseAnchor = (value: unknown, location: string): VectorAnchor => {
  if (!isRecord(value)) throw new Error(`${location} must be an anchor.`);
  if (value.mode !== 'corner' && value.mode !== 'smooth' && value.mode !== 'symmetric') {
    throw new Error(`${location}.mode is invalid.`);
  }
  return {
    id: stringValue(value.id, `${location}.id`),
    position: parseVec2(value.position, `${location}.position`),
    handleIn: value.handleIn === null ? null : parseVec2(value.handleIn, `${location}.handleIn`),
    handleOut: value.handleOut === null ? null : parseVec2(value.handleOut, `${location}.handleOut`),
    mode: value.mode as AnchorMode
  };
};

const parseSubpath = (value: unknown, location: string): VectorSubpath => {
  if (!isRecord(value) || typeof value.closed !== 'boolean' || !Array.isArray(value.anchors)) {
    throw new Error(`${location} must be a vector subpath.`);
  }
  return {
    id: stringValue(value.id, `${location}.id`),
    closed: value.closed,
    anchors: value.anchors.map((anchor, index) => parseAnchor(anchor, `${location}.anchors[${index}]`))
  };
};

/**
 * Decodes an untrusted serialized vector path into the canonical model.
 *
 * This is intentionally strict while the file format is pre-release: invalid
 * or stale shapes fail at the persistence boundary instead of leaking partial
 * geometry into editors and GPU backends.
 */
export const parseVectorPath = (value: unknown, location = 'path'): VectorPath => {
  if (!isRecord(value) || value.type !== 'path' || !Array.isArray(value.subpaths)) {
    throw new Error(`${location} must be a vector path.`);
  }
  if (value.fillRule !== 'nonzero' && value.fillRule !== 'evenodd') {
    throw new Error(`${location}.fillRule is invalid.`);
  }
  const path: VectorPath = {
    id: stringValue(value.id, `${location}.id`),
    type: 'path',
    name: stringValue(value.name, `${location}.name`),
    subpaths: value.subpaths.map((subpath, index) => parseSubpath(subpath, `${location}.subpaths[${index}]`)),
    fillRule: value.fillRule as FillRule,
    transform: parseAffineMatrix(value.transform, `${location}.transform`),
    style: parseStyle(value.style, `${location}.style`),
    geometryRevision: nonNegativeInteger(value.geometryRevision, `${location}.geometryRevision`),
    transformRevision: nonNegativeInteger(value.transformRevision, `${location}.transformRevision`),
    styleRevision: nonNegativeInteger(value.styleRevision, `${location}.styleRevision`)
  };
  const issues = validateVectorPath(path);
  if (issues.length > 0) {
    throw new Error(`${location} is invalid: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  }
  return path;
};

const parseLiveShapeGeometry = (value: unknown, location: string): LiveShapeGeometry => {
  if (!isRecord(value)) throw new Error(`${location} must be live-shape geometry.`);
  const nonNegative = (input: unknown, field: string) => {
    const parsed = finiteNumber(input, `${location}.${field}`);
    if (parsed < 0) throw new Error(`${location}.${field} must not be negative.`);
    return parsed;
  };
  const pointCount = (input: unknown, field: string, maximum: number) => {
    const parsed = nonNegativeInteger(input, `${location}.${field}`);
    if (parsed < 3 || parsed > maximum) {
      throw new Error(`${location}.${field} must be between three and ${maximum}.`);
    }
    return parsed;
  };
  switch (value.kind) {
    case 'ellipse':
      return { kind: 'ellipse', width: nonNegative(value.width, 'width'), height: nonNegative(value.height, 'height') };
    case 'rectangle': {
      if (!Array.isArray(value.cornerRadii) || value.cornerRadii.length !== 4 || typeof value.linkedCorners !== 'boolean') {
        throw new Error(`${location} is not supported live-shape geometry.`);
      }
      const cornerRadii = value.cornerRadii.map((radius, index) => nonNegative(radius, `cornerRadii[${index}]`));
      return {
        kind: 'rectangle', width: nonNegative(value.width, 'width'), height: nonNegative(value.height, 'height'),
        cornerRadii: [cornerRadii[0], cornerRadii[1], cornerRadii[2], cornerRadii[3]],
        linkedCorners: value.linkedCorners
      };
    }
    case 'triangle':
      return {
        kind: 'triangle', width: nonNegative(value.width, 'width'), height: nonNegative(value.height, 'height'),
        cornerRadius: nonNegative(value.cornerRadius, 'cornerRadius')
      };
    case 'polygon':
      return {
        kind: 'polygon', sides: pointCount(value.sides, 'sides', 4096), radius: nonNegative(value.radius, 'radius'),
        rotationRadians: finiteNumber(value.rotationRadians, `${location}.rotationRadians`),
        cornerRadius: nonNegative(value.cornerRadius, 'cornerRadius')
      };
    case 'star':
      return {
        kind: 'star', points: pointCount(value.points, 'points', 2048),
        outerRadius: nonNegative(value.outerRadius, 'outerRadius'),
        innerRadius: nonNegative(value.innerRadius, 'innerRadius'),
        rotationRadians: finiteNumber(value.rotationRadians, `${location}.rotationRadians`),
        cornerRadius: nonNegative(value.cornerRadius, 'cornerRadius')
      };
    case 'line': {
      const parseArrow = (input: unknown, field: string) => {
        if (input === null) return null;
        if (!isRecord(input)) throw new Error(`${location}.${field} must be an arrowhead.`);
        const concavity = finiteNumber(input.concavity, `${location}.${field}.concavity`);
        if (concavity < -1 || concavity > 1) {
          throw new Error(`${location}.${field}.concavity must be between -1 and 1.`);
        }
        return {
          width: nonNegative(input.width, `${field}.width`),
          length: nonNegative(input.length, `${field}.length`),
          concavity
        };
      };
      return {
        kind: 'line', start: parseVec2(value.start, `${location}.start`), end: parseVec2(value.end, `${location}.end`),
        startArrow: parseArrow(value.startArrow, 'startArrow'),
        endArrow: parseArrow(value.endArrow, 'endArrow')
      };
    }
    default:
      throw new Error(`${location} is not supported live-shape geometry.`);
  }
};

export const parseVectorLiveShape = (value: unknown, location = 'shape'): VectorLiveShape => {
  if (!isRecord(value) || value.type !== 'live-shape') {
    throw new Error(`${location} must be a vector live shape.`);
  }
  const shape: VectorLiveShape = {
    id: stringValue(value.id, `${location}.id`),
    type: 'live-shape',
    name: stringValue(value.name, `${location}.name`),
    geometry: parseLiveShapeGeometry(value.geometry, `${location}.geometry`),
    transform: parseAffineMatrix(value.transform, `${location}.transform`),
    style: parseStyle(value.style, `${location}.style`),
    geometryRevision: nonNegativeInteger(value.geometryRevision, `${location}.geometryRevision`),
    transformRevision: nonNegativeInteger(value.transformRevision, `${location}.transformRevision`),
    styleRevision: nonNegativeInteger(value.styleRevision, `${location}.styleRevision`)
  };
  const issues = validateVectorLiveShape(shape);
  if (issues.length > 0) {
    throw new Error(`${location} is invalid: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  }
  return shape;
};

export const parseVectorElement = (value: unknown, location = 'element'): VectorElement => {
  if (!isRecord(value)) throw new Error(`${location} must be a vector element.`);
  if (value.type === 'path') return parseVectorPath(value, location);
  if (value.type === 'live-shape') return parseVectorLiveShape(value, location);
  throw new Error(`${location}.type is not supported.`);
};
