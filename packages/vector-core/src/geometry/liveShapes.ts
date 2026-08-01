import { createAnchor, createSubpath, createVectorPath } from '../model/factories';
import { cloneVectorStyle } from '../model/clone';
import type {
  RectangleShapeGeometry,
  VectorAnchor,
  VectorLiveShape,
  VectorPath
} from '../model/types';

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

/** Produces disposable canonical cubic geometry without losing live parameters. */
export const realizeLiveShape = (shape: VectorLiveShape): VectorPath => {
  const path = createVectorPath(`${shape.id}:realized`, shape.name, [
    createSubpath(
      `${shape.id}:outline`,
      shape.geometry.kind === 'rectangle'
        ? roundedRectangleAnchors(shape.geometry, shape.id)
        : ellipseAnchors(shape.geometry.width, shape.geometry.height, shape.id),
      true
    )
  ]);
  path.transform = { ...shape.transform };
  path.style = cloneVectorStyle(shape.style);
  path.geometryRevision = shape.geometryRevision;
  path.transformRevision = shape.transformRevision;
  path.styleRevision = shape.styleRevision;
  return path;
};
