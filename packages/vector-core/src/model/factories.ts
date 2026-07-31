import { identityAffineMatrix } from '../math/affine';
import type { Vec2 } from '../math/vector';
import type { AnchorMode, VectorAnchor, VectorPath, VectorStyle, VectorSubpath } from './types';

export const defaultVectorStyle = (): VectorStyle => ({
  fill: { type: 'solid', color: [0, 0, 0, 1] },
  stroke: null,
  opacity: 1
});

export const createAnchor = (
  id: string,
  position: Vec2,
  options: {
    handleIn?: Vec2 | null;
    handleOut?: Vec2 | null;
    mode?: AnchorMode;
  } = {}
): VectorAnchor => ({
  id,
  position: { ...position },
  handleIn: options.handleIn ? { ...options.handleIn } : null,
  handleOut: options.handleOut ? { ...options.handleOut } : null,
  mode: options.mode ?? 'corner'
});

export const createSubpath = (
  id: string,
  anchors: VectorAnchor[] = [],
  closed = false
): VectorSubpath => ({ id, anchors, closed });

export const createVectorPath = (
  id: string,
  name = 'Path',
  subpaths: VectorSubpath[] = []
): VectorPath => ({
  id,
  type: 'path',
  name,
  subpaths,
  fillRule: 'nonzero',
  transform: identityAffineMatrix(),
  style: defaultVectorStyle(),
  geometryRevision: 0,
  styleRevision: 0
});
