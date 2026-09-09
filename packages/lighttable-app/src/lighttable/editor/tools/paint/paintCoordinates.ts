import type { ImageDocument, LayerNode } from '../../document/documentTypes';
import { buildSceneTransformIndex } from '../../document/sceneTransformGraph';
import { identityAffineMatrix } from '../../rendering/renderContract';
import { invertMatrix, transformPoint, type TransformPoint } from '../transform/affine';
import type { AffineMatrix } from '../transform/transformTypes';
import type { PaintChannel } from '../../session/editorSession';

/**
 * Resolves the one source-to-document matrix used by every raster authoring
 * command. Raster pixels include their complete ancestor chain; masks use the
 * mask's own persisted transform, matching compositor and mask hit testing.
 */
export const paintTargetSourceToDocument = (
  document: Pick<ImageDocument, 'layers'>,
  layer: LayerNode,
  channel: PaintChannel
): AffineMatrix => {
  if (channel === 'mask') {
    return 'mask' in layer && layer.mask
      ? layer.mask.transform
      : identityAffineMatrix();
  }
  return layer.type === 'raster'
    ? buildSceneTransformIndex(document).get(layer.id)?.localToDocument ?? layer.transform
    : identityAffineMatrix();
};

export const documentPointToPaintTarget = (
  point: TransformPoint,
  sourceToDocument: AffineMatrix
): TransformPoint | null => {
  const documentToSource = invertMatrix(sourceToDocument);
  return documentToSource ? transformPoint(documentToSource, point) : null;
};
