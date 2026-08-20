import { cloneVectorPath, type VectorPath } from '@lighttable/vector-core';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';

export interface VectorPathMutationCommit {
  readonly layerId: LayerId;
  readonly pathId: string;
  readonly path: VectorPath | null;
}

export const committedVectorPath = (
  document: ImageDocument | null,
  layerId: LayerId,
  pathId: string
): VectorPathMutationCommit => {
  const layer = document ? findDocumentLayer(document, layerId) : null;
  const path = layer?.type === 'vector'
    ? layer.elements.find((element): element is VectorPath => (
        element.type === 'path' && element.id === pathId
      ))
    : null;
  return { layerId, pathId, path: path ? cloneVectorPath(path) : null };
};
