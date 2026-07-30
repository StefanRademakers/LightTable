import type { LayerNode } from '../../document/documentTypes';
import { identityAffineMatrix } from '../../rendering/renderContract';
import { invertMatrix, transformPoint, type TransformPoint } from '../transform/affine';
import type { AffineMatrix } from '../transform/transformTypes';
import type { PaintChannel } from '../../session/editorSession';

/**
 * Raster pixels are currently editable only before a non-destructive layer
 * transform is applied. A layer mask is layer-local and follows that transform,
 * so document-space pointer input must be mapped back through the layer matrix.
 */
export const paintTargetSourceToDocument = (
  layer: LayerNode,
  channel: PaintChannel
): AffineMatrix => channel === 'mask' ? layer.transform : identityAffineMatrix();

export const documentPointToPaintTarget = (
  point: TransformPoint,
  sourceToDocument: AffineMatrix
): TransformPoint | null => {
  const documentToSource = invertMatrix(sourceToDocument);
  return documentToSource ? transformPoint(documentToSource, point) : null;
};
