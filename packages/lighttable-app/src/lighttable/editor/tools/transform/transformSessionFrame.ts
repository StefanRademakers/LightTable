import {
  identityMatrix,
  invertMatrix,
  multiplyMatrices,
  transformPoint
} from './affine';
import type {
  AffineMatrix,
  TransformPoint,
  TransformSessionState
} from './transformTypes';
import type { Rect } from '../../document/documentTypes';

export type TransformFrameMode = 'document' | 'local';

export interface TransformSessionFrame {
  /** Axis-aligned source rectangle in the frame's own coordinate space. */
  readonly bounds: Rect;
  /** Maps frame coordinates into document space at session start. */
  readonly matrix: AffineMatrix;
}

/**
 * Defines the user-facing coordinate frame for a newly opened transform session.
 * Rendering remains based on `sourceMatrix`; this frame only controls the gizmo
 * and the coordinate system in which subsequent gestures are interpreted.
 */
export const transformSessionFrame = (
  state: TransformSessionState,
  mode: TransformFrameMode
): TransformSessionFrame => mode === 'local'
  ? {
      bounds: state.sourceContentBounds,
      matrix: state.sourceMatrix
    }
  : {
      bounds: state.sourceBounds,
      matrix: identityMatrix()
    };

export const pointInTransformFrame = (
  sessionMatrix: AffineMatrix,
  frameMatrix: AffineMatrix,
  point: TransformPoint
): TransformPoint | null => {
  const inverse = invertMatrix(multiplyMatrices(sessionMatrix, frameMatrix));
  return inverse ? transformPoint(inverse, point) : null;
};

/**
 * Appends an operation expressed in frame-local coordinates while returning the
 * document-space session delta expected by TransformController.
 */
export const appendTransformFrameOperation = (
  sessionMatrix: AffineMatrix,
  frameMatrix: AffineMatrix,
  operation: AffineMatrix
): AffineMatrix | null => {
  const inverseFrame = invertMatrix(frameMatrix);
  if (!inverseFrame) return null;
  return multiplyMatrices(
    multiplyMatrices(
      multiplyMatrices(sessionMatrix, frameMatrix),
      operation
    ),
    inverseFrame
  );
};

/** Aligns only the editable frame to document axes; rendered layer content is unchanged. */
export const alignTransformFrameToDocument = (
  state: TransformSessionState,
  frame: TransformSessionFrame
): TransformSessionFrame | null => {
  const inverseSession = invertMatrix(state.matrix);
  if (!inverseSession) return null;
  const frameToDocument = multiplyMatrices(state.matrix, frame.matrix);
  const corners = [
    { x: frame.bounds.x, y: frame.bounds.y },
    { x: frame.bounds.x + frame.bounds.width, y: frame.bounds.y },
    { x: frame.bounds.x + frame.bounds.width, y: frame.bounds.y + frame.bounds.height },
    { x: frame.bounds.x, y: frame.bounds.y + frame.bounds.height }
  ].map((point) => transformPoint(frameToDocument, point));
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    bounds: {
      x: left,
      y: top,
      width: Math.max(...xs) - left,
      height: Math.max(...ys) - top
    },
    // The session delta still renders the layer. Its inverse makes the new
    // document-space frame appear at identity without touching image content.
    matrix: inverseSession
  };
};
