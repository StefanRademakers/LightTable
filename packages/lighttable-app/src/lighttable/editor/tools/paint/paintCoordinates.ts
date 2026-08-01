import type { LayerNode } from '../../document/documentTypes';
import { identityAffineMatrix } from '../../rendering/renderContract';
import { invertMatrix, transformPoint, type TransformPoint } from '../transform/affine';
import type { AffineMatrix } from '../transform/transformTypes';
import type { PaintChannel } from '../../session/editorSession';

/**
 * Raster authoring textures and layer masks both use document-sized storage.
 * A non-destructive layer transform changes how raster pixels are projected by
 * the compositor; it must not move the mask or its paint coordinate system.
 * Keeping both paint targets in document space also makes painted mask pixels
 * line up exactly with selection-to-mask and mask-to-selection operations.
 */
export const paintTargetSourceToDocument = (
  _layer: LayerNode,
  _channel: PaintChannel
): AffineMatrix => identityAffineMatrix();

export const documentPointToPaintTarget = (
  point: TransformPoint,
  sourceToDocument: AffineMatrix
): TransformPoint | null => {
  const documentToSource = invertMatrix(sourceToDocument);
  return documentToSource ? transformPoint(documentToSource, point) : null;
};
