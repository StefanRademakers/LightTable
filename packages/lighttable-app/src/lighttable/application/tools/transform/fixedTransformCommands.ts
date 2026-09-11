import type { ImageDocument, Rect } from '../../../editor/document/documentTypes';
import { duplicateLayer, setLayerTransform } from '../../../editor/document/documentCommands';
import { findDocumentLayer } from '../../../editor/document/layerTree';
import type { AffineMatrix } from '../../../editor/tools/transform/transformTypes';
import {
  aroundPoint,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix
} from '../../../editor/tools/transform/affine';

export type FixedTransformOperation =
  | 'rotate-180' | 'rotate-clockwise-90' | 'rotate-counter-clockwise-90'
  | 'flip-horizontal' | 'flip-vertical';

export const fixedTransformDelta = (
  operation: FixedTransformOperation,
  bounds: Rect
): AffineMatrix => {
  const pivot = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  return aroundPoint(
    operation === 'rotate-180' ? rotationMatrix(Math.PI)
      : operation === 'rotate-clockwise-90' ? rotationMatrix(Math.PI / 2)
        : operation === 'rotate-counter-clockwise-90' ? rotationMatrix(-Math.PI / 2)
          : operation === 'flip-horizontal' ? scaleMatrix(-1, 1)
            : scaleMatrix(1, -1),
    pivot
  );
};

/** Pure canonical document transition for Transform Again. */
export const repeatLayerTransform = (
  before: ImageDocument,
  delta: AffineMatrix,
  duplicate: boolean
): ImageDocument => {
  if (!before.activeLayerId) return before;
  const withTarget = duplicate ? duplicateLayer(before, before.activeLayerId) : before;
  const target = findDocumentLayer(withTarget, withTarget.activeLayerId);
  if (!target) return before;
  return setLayerTransform(
    withTarget,
    target.id,
    multiplyMatrices(delta, target.transform)
  );
};
