import type { VectorElement } from '@lighttable/vector-core';
import type { EditableVectorQueryResult } from './lightTableCommandContract';
import type { LayerId, VectorLayer } from '../../editor/document/documentTypes';

const anchorCount = (element: VectorElement) => element.type === 'path'
  ? element.subpaths.reduce((sum, subpath) => sum + subpath.anchors.length, 0) : 0;

/** Bounded full-fidelity projection: at most 128 elements and 8192 path anchors. */
export const projectEditableVectorQuery = (
  layer: VectorLayer, layerId: LayerId
): EditableVectorQueryResult => {
  const elements: VectorElement[] = []; let remainingAnchors = 8192;
  for (const element of layer.elements.slice(0, 128)) {
    const required = anchorCount(element);
    if (required > remainingAnchors) break;
    elements.push(structuredClone(element)); remainingAnchors -= required;
  }
  return { layerId, revision: layer.revision, totalElements: layer.elements.length,
    truncated: elements.length < layer.elements.length, elements };
};
