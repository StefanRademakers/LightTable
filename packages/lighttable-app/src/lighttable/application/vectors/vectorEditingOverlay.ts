import {
  buildVectorEditingOverlay,
  type VectorEditingOverlay
} from '@lighttable/vector-rendering';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { VectorEditorSelection } from '../../editor/session/editorSession';
import { vectorPathsTopmostFirst } from './vectorSceneQueries';

export interface VectorDocumentEditingOverlay extends VectorEditingOverlay {
  layerId: string;
}

const samePath = (
  reference: { layerId: string; pathId: string },
  layerId: string,
  pathId: string
) => reference.layerId === layerId && reference.pathId === pathId;

/**
 * Projects scene-scoped editor selection into renderer-neutral overlays.
 *
 * The function only reads the current document and transient session state.
 * It neither realizes raster geometry nor mutates document revisions, keeping
 * selection and viewport feedback outside the expensive artwork cache.
 */
export const buildVectorDocumentEditingOverlays = (
  document: Pick<ImageDocument, 'layers'>,
  selection: VectorEditorSelection
): VectorDocumentEditingOverlay[] => vectorPathsTopmostFirst(document)
  .filter(({ layerId, pathId }) => selection.paths.some(
    (reference) => samePath(reference, layerId, pathId)
  ) || selection.anchors.some(
    (reference) => samePath(reference, layerId, pathId)
  ))
  .map(({ layerId, pathId, documentPath }) => {
    const anchors = selection.anchors
      .filter((reference) => samePath(reference, layerId, pathId))
      .map(({ subpathId, anchorId }) => ({ subpathId, anchorId }));
    const active = selection.active;
    const activeAnchor = active
      && samePath(active, layerId, pathId)
      && (active.target.kind === 'anchor'
        || active.target.kind === 'handle-in'
        || active.target.kind === 'handle-out')
      ? {
          subpathId: active.target.subpathId,
          anchorId: active.target.anchorId
        }
      : null;
    return {
      layerId,
      ...buildVectorEditingOverlay(documentPath, {
        selection: { anchors, activeAnchor }
      })
    };
  });
