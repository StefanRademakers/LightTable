import type { TextWorkerGlyphOutlineResult } from '@lighttable/text-core';
import {
  createAnchor,
  createSubpath,
  createVectorPath,
  type AffineMatrix,
  type Vec2,
  type VectorAnchor,
  type VectorPath,
  type VectorSubpath
} from '@lighttable/vector-core';

export interface GlyphVectorPlacement {
  readonly fontSize: number;
  readonly origin: Vec2;
}

export interface GlyphOutlineVectorPathOptions {
  readonly id: string;
  readonly name?: string;
  readonly placement?: GlyphVectorPlacement;
}

const coordinateArity = [2, 2, 4, 6, 0] as const;

const samePoint = (left: Vec2, right: Vec2) => left.x === right.x && left.y === right.y;

const assertFinitePoint = (x: number, y: number): Vec2 => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('Glyph outline coordinates must be finite.');
  }
  return { x, y };
};

export const createGlyphPlacementTransform = (
  unitsPerEm: number,
  placement: GlyphVectorPlacement
): AffineMatrix => {
  if (!Number.isFinite(unitsPerEm) || unitsPerEm <= 0) {
    throw new Error('Glyph outline unitsPerEm must be a positive finite number.');
  }
  if (!Number.isFinite(placement.fontSize) || placement.fontSize <= 0) {
    throw new Error('Glyph placement fontSize must be a positive finite number.');
  }
  if (!Number.isFinite(placement.origin.x) || !Number.isFinite(placement.origin.y)) {
    throw new Error('Glyph placement origin must be finite.');
  }
  const scale = placement.fontSize / unitsPerEm;
  return {
    a: scale,
    b: 0,
    c: 0,
    d: -scale,
    tx: placement.origin.x,
    ty: placement.origin.y
  };
};

/**
 * Projects scale-independent font outline commands into LightTable's canonical
 * cubic vector model. Viewport state is deliberately absent: placement is in
 * document coordinates and can be reused by both rendering and Convert to Shape.
 */
export const glyphOutlineToVectorPath = (
  outline: TextWorkerGlyphOutlineResult,
  options: GlyphOutlineVectorPathOptions
): VectorPath => {
  if (!Number.isFinite(outline.unitsPerEm) || outline.unitsPerEm <= 0) {
    throw new Error('Glyph outline unitsPerEm must be a positive finite number.');
  }

  let coordinateIndex = 0;
  let contourIndex = 0;
  let currentAnchors: VectorAnchor[] | null = null;
  const subpaths: VectorSubpath[] = [];

  const nextPoint = (): Vec2 => {
    if (coordinateIndex + 2 > outline.coordinates.length) {
      throw new Error('Glyph outline coordinates ended before the command stream.');
    }
    const point = assertFinitePoint(
      outline.coordinates[coordinateIndex]!,
      outline.coordinates[coordinateIndex + 1]!
    );
    coordinateIndex += 2;
    return point;
  };
  const currentAnchor = () => {
    const anchor = currentAnchors?.at(-1);
    if (!anchor) throw new Error('Glyph outline contour command must follow a move command.');
    return anchor;
  };
  const addAnchor = (position: Vec2, handleIn: Vec2 | null = null) => {
    if (!currentAnchors) throw new Error('Glyph outline contour command must follow a move command.');
    currentAnchors.push(createAnchor(
      `${options.id}:contour:${contourIndex}:anchor:${currentAnchors.length}`,
      position,
      { handleIn }
    ));
  };
  const finishContour = (closed: boolean) => {
    if (!currentAnchors) return;
    if (closed && currentAnchors.length > 1) {
      const first = currentAnchors[0]!;
      const last = currentAnchors.at(-1)!;
      if (samePoint(first.position, last.position)) {
        first.handleIn = last.handleIn;
        currentAnchors.pop();
      }
    }
    subpaths.push(createSubpath(
      `${options.id}:contour:${contourIndex}`,
      currentAnchors,
      closed
    ));
    contourIndex += 1;
    currentAnchors = null;
  };

  for (const verb of outline.verbs) {
    if (verb >= coordinateArity.length) throw new Error(`Unknown glyph outline verb ${verb}.`);
    if (coordinateIndex + coordinateArity[verb]! > outline.coordinates.length) {
      throw new Error('Glyph outline coordinates ended before the command stream.');
    }
    switch (verb) {
      case 0: {
        finishContour(false);
        currentAnchors = [];
        addAnchor(nextPoint());
        break;
      }
      case 1:
        currentAnchor();
        addAnchor(nextPoint());
        break;
      case 2: {
        const previous = currentAnchor();
        const control = nextPoint();
        const end = nextPoint();
        previous.handleOut = {
          x: previous.position.x + (control.x - previous.position.x) * 2 / 3,
          y: previous.position.y + (control.y - previous.position.y) * 2 / 3
        };
        addAnchor(end, {
          x: end.x + (control.x - end.x) * 2 / 3,
          y: end.y + (control.y - end.y) * 2 / 3
        });
        break;
      }
      case 3: {
        const previous = currentAnchor();
        previous.handleOut = nextPoint();
        const handleIn = nextPoint();
        addAnchor(nextPoint(), handleIn);
        break;
      }
      case 4:
        currentAnchor();
        finishContour(true);
        break;
    }
  }
  finishContour(false);
  if (coordinateIndex !== outline.coordinates.length) {
    throw new Error('Glyph outline contains unused coordinates.');
  }

  const path = createVectorPath(options.id, options.name ?? 'Glyph', subpaths);
  if (options.placement) {
    path.transform = createGlyphPlacementTransform(outline.unitsPerEm, options.placement);
    path.transformRevision = 1;
  }
  return path;
};
