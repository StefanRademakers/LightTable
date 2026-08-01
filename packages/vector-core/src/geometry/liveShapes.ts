import { createAnchor, createSubpath, createVectorPath } from '../model/factories';
import { cloneVectorStyle } from '../model/clone';
import type {
  RectangleShapeGeometry,
  VectorAnchor,
  VectorLiveShape,
  VectorPath
} from '../model/types';
import type { Vec2 } from '../math/vector';

// Exact cubic approximation commonly used for a quarter circle.
const KAPPA = 0.5522847498307936;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/**
 * Resolves over-constrained corner radii proportionally, matching the useful
 * part of the CSS border-radius algorithm. No edge can contain overlapping
 * corners, while the user's relative radii remain intact.
 */
export const resolvedRectangleCornerRadii = (
  geometry: RectangleShapeGeometry
): [number, number, number, number] => {
  const width = Math.max(0, geometry.width);
  const height = Math.max(0, geometry.height);
  const radii = geometry.cornerRadii.map((radius) => Math.max(0, radius)) as [number, number, number, number];
  const ratios = [
    width / Math.max(Number.EPSILON, radii[0] + radii[1]),
    height / Math.max(Number.EPSILON, radii[1] + radii[2]),
    width / Math.max(Number.EPSILON, radii[2] + radii[3]),
    height / Math.max(Number.EPSILON, radii[3] + radii[0])
  ];
  const scale = clamp(Math.min(1, ...ratios), 0, 1);
  return radii.map((radius) => radius * scale) as [number, number, number, number];
};

const roundedRectangleAnchors = (geometry: RectangleShapeGeometry, id: string): VectorAnchor[] => {
  const width = Math.max(0, geometry.width);
  const height = Math.max(0, geometry.height);
  const [topLeft, topRight, bottomRight, bottomLeft] = resolvedRectangleCornerRadii(geometry);
  const anchors: VectorAnchor[] = [];
  const addCorner = (
    key: string,
    first: { x: number; y: number },
    second: { x: number; y: number },
    firstHandleOut: { x: number; y: number },
    secondHandleIn: { x: number; y: number }
  ) => {
    anchors.push(createAnchor(`${id}:${key}:start`, first, { handleOut: firstHandleOut, mode: 'smooth' }));
    anchors.push(createAnchor(`${id}:${key}:end`, second, { handleIn: secondHandleIn, mode: 'smooth' }));
  };

  addCorner('tr', { x: width - topRight, y: 0 }, { x: width, y: topRight },
    { x: width - topRight + topRight * KAPPA, y: 0 }, { x: width, y: topRight - topRight * KAPPA });
  addCorner('br', { x: width, y: height - bottomRight }, { x: width - bottomRight, y: height },
    { x: width, y: height - bottomRight + bottomRight * KAPPA }, { x: width - bottomRight + bottomRight * KAPPA, y: height });
  addCorner('bl', { x: bottomLeft, y: height }, { x: 0, y: height - bottomLeft },
    { x: bottomLeft - bottomLeft * KAPPA, y: height }, { x: 0, y: height - bottomLeft + bottomLeft * KAPPA });
  addCorner('tl', { x: 0, y: topLeft }, { x: topLeft, y: 0 },
    { x: 0, y: topLeft - topLeft * KAPPA }, { x: topLeft - topLeft * KAPPA, y: 0 });
  // A zero-radius corner creates two coincident construction anchors. They are
  // useful while constructing the generic rounded outline but not in canonical
  // path geometry (and would be surprising after Convert to Path).
  return anchors.filter((anchor, index) => {
    if (index === 0) return true;
    const previous = anchors[index - 1];
    return anchor.position.x !== previous.position.x || anchor.position.y !== previous.position.y;
  });
};

const ellipseAnchors = (width: number, height: number, id: string): VectorAnchor[] => {
  const radiusX = Math.max(0, width) / 2;
  const radiusY = Math.max(0, height) / 2;
  const center = { x: radiusX, y: radiusY };
  return [
    createAnchor(`${id}:top`, { x: center.x, y: 0 }, {
      handleIn: { x: center.x - radiusX * KAPPA, y: 0 },
      handleOut: { x: center.x + radiusX * KAPPA, y: 0 }, mode: 'smooth'
    }),
    createAnchor(`${id}:right`, { x: width, y: center.y }, {
      handleIn: { x: width, y: center.y - radiusY * KAPPA },
      handleOut: { x: width, y: center.y + radiusY * KAPPA }, mode: 'smooth'
    }),
    createAnchor(`${id}:bottom`, { x: center.x, y: height }, {
      handleIn: { x: center.x + radiusX * KAPPA, y: height },
      handleOut: { x: center.x - radiusX * KAPPA, y: height }, mode: 'smooth'
    }),
    createAnchor(`${id}:left`, { x: 0, y: center.y }, {
      handleIn: { x: 0, y: center.y + radiusY * KAPPA },
      handleOut: { x: 0, y: center.y - radiusY * KAPPA }, mode: 'smooth'
    })
  ];
};

const distance = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);
const toward = (from: Vec2, to: Vec2, amount: number): Vec2 => {
  const length = distance(from, to);
  if (length <= Number.EPSILON) return { ...from };
  const scale = amount / length;
  return { x: from.x + (to.x - from.x) * scale, y: from.y + (to.y - from.y) * scale };
};

/**
 * Creates a smooth, bounded corner using a cubic form of a quadratic fillet.
 * Radius is the edge trim distance; it is clamped independently per vertex so
 * malformed or extreme live parameters cannot invert an adjacent edge.
 */
const polygonAnchors = (vertices: readonly Vec2[], cornerRadius: number, id: string): VectorAnchor[] => {
  if (cornerRadius <= 0) {
    return vertices.map((point, index) => createAnchor(`${id}:vertex:${index}`, point));
  }
  const anchors: VectorAnchor[] = [];
  vertices.forEach((vertex, index) => {
    const previous = vertices[(index - 1 + vertices.length) % vertices.length];
    const next = vertices[(index + 1) % vertices.length];
    const trim = Math.min(cornerRadius, distance(vertex, previous) / 2, distance(vertex, next) / 2);
    const entry = toward(vertex, previous, trim);
    const exit = toward(vertex, next, trim);
    const controlScale = 2 / 3;
    anchors.push(createAnchor(`${id}:vertex:${index}:entry`, entry, {
      handleOut: {
        x: entry.x + (vertex.x - entry.x) * controlScale,
        y: entry.y + (vertex.y - entry.y) * controlScale
      },
      mode: 'smooth'
    }));
    anchors.push(createAnchor(`${id}:vertex:${index}:exit`, exit, {
      handleIn: {
        x: exit.x + (vertex.x - exit.x) * controlScale,
        y: exit.y + (vertex.y - exit.y) * controlScale
      },
      mode: 'smooth'
    }));
  });
  return anchors;
};

const regularVertices = (count: number, radiusAt: (index: number) => number, rotation: number): Vec2[] =>
  Array.from({ length: count }, (_, index) => {
    const angle = rotation + index * Math.PI * 2 / count;
    const radius = radiusAt(index);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });

const arrowheadAnchors = (
  id: string,
  tip: Vec2,
  shaftPoint: Vec2,
  arrow: { width: number; length: number; concavity: number }
): VectorAnchor[] => {
  const shaftLength = distance(tip, shaftPoint);
  if (shaftLength <= Number.EPSILON) return [];
  const direction = { x: (tip.x - shaftPoint.x) / shaftLength, y: (tip.y - shaftPoint.y) / shaftLength };
  const normal = { x: -direction.y, y: direction.x };
  const base = { x: tip.x - direction.x * arrow.length, y: tip.y - direction.y * arrow.length };
  const halfWidth = arrow.width / 2;
  const notch = {
    x: base.x + direction.x * arrow.length * clamp(arrow.concavity, -1, 1) * 0.5,
    y: base.y + direction.y * arrow.length * clamp(arrow.concavity, -1, 1) * 0.5
  };
  return [
    createAnchor(`${id}:tip`, tip),
    createAnchor(`${id}:left`, { x: base.x + normal.x * halfWidth, y: base.y + normal.y * halfWidth }),
    createAnchor(`${id}:notch`, notch),
    createAnchor(`${id}:right`, { x: base.x - normal.x * halfWidth, y: base.y - normal.y * halfWidth })
  ];
};

/** Produces disposable canonical cubic geometry without losing live parameters. */
export const realizeLiveShape = (shape: VectorLiveShape): VectorPath => {
  const geometry = shape.geometry;
  const subpaths = geometry.kind === 'rectangle'
    ? [createSubpath(`${shape.id}:outline`, roundedRectangleAnchors(geometry, shape.id), true)]
    : geometry.kind === 'ellipse'
      ? [createSubpath(`${shape.id}:outline`, ellipseAnchors(geometry.width, geometry.height, shape.id), true)]
      : geometry.kind === 'triangle'
        ? [createSubpath(`${shape.id}:outline`, polygonAnchors([
            { x: geometry.width / 2, y: 0 },
            { x: geometry.width, y: geometry.height },
            { x: 0, y: geometry.height }
          ], geometry.cornerRadius, shape.id), true)]
        : geometry.kind === 'polygon'
          ? [createSubpath(`${shape.id}:outline`, polygonAnchors(
              regularVertices(Math.max(3, Math.round(geometry.sides)), () => geometry.radius, geometry.rotationRadians),
              geometry.cornerRadius,
              shape.id
            ), true)]
          : geometry.kind === 'star'
            ? [createSubpath(`${shape.id}:outline`, polygonAnchors(
                regularVertices(
                  Math.max(3, Math.round(geometry.points)) * 2,
                  (index) => index % 2 === 0 ? geometry.outerRadius : geometry.innerRadius,
                  geometry.rotationRadians
                ),
                geometry.cornerRadius,
                shape.id
              ), true)]
            : [
                createSubpath(`${shape.id}:shaft`, [
                  createAnchor(`${shape.id}:start`, geometry.start),
                  createAnchor(`${shape.id}:end`, geometry.end)
                ], false),
                ...(geometry.startArrow ? [createSubpath(
                  `${shape.id}:start-arrow`,
                  arrowheadAnchors(`${shape.id}:start-arrow`, geometry.start, geometry.end, geometry.startArrow),
                  true
                )] : []),
                ...(geometry.endArrow ? [createSubpath(
                  `${shape.id}:end-arrow`,
                  arrowheadAnchors(`${shape.id}:end-arrow`, geometry.end, geometry.start, geometry.endArrow),
                  true
                )] : [])
              ];
  const path = createVectorPath(`${shape.id}:realized`, shape.name, subpaths);
  path.transform = { ...shape.transform };
  path.style = cloneVectorStyle(shape.style);
  path.geometryRevision = shape.geometryRevision;
  path.transformRevision = shape.transformRevision;
  path.styleRevision = shape.styleRevision;
  return path;
};
