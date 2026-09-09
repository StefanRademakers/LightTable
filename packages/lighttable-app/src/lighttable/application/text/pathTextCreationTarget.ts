import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findLayerNode } from '../../editor/document/layerTree';
import type { VectorEditorSelection } from '../../editor/session/editorSession';
import { hitTestVectorDocument } from '../vectors/vectorSceneQueries';

export interface PathTextCreationTarget {
  readonly pathLayerId: LayerId;
  readonly pathElementId: string;
  readonly pathSubpathId: string;
}

export interface PathTextLayoutOptions {
  readonly startOffset: number;
  readonly side: 'left' | 'right';
  readonly upright: boolean;
  readonly direction: 'forward' | 'reverse';
}

export type PathTextCreationTargetResolution =
  | { readonly kind: 'resolved'; readonly target: PathTextCreationTarget }
  | { readonly kind: 'none' | 'ambiguous' | 'live-shape' | 'ambiguous-subpath' };

/** Resolves only explicit native path selection; it never guesses among siblings. */
export const resolvePathTextCreationTarget = (
  document: ImageDocument,
  selection: VectorEditorSelection
): PathTextCreationTargetResolution => {
  const references = new Map<string, { layerId: LayerId; elementId: string }>();
  selection.elements.forEach(({ layerId, elementId }) => {
    references.set(`${layerId}\0${elementId}`, { layerId, elementId });
  });
  selection.paths.forEach(({ layerId, pathId }) => {
    references.set(`${layerId}\0${pathId}`, { layerId, elementId: pathId });
  });
  if (selection.active) {
    references.set(`${selection.active.layerId}\0${selection.active.pathId}`, {
      layerId: selection.active.layerId,
      elementId: selection.active.pathId
    });
  }
  if (references.size === 0) {
    if (!document.activeLayerId) return { kind: 'none' };
    const activeLayer = findLayerNode(document.layers, document.activeLayerId)?.node;
    if (!activeLayer || activeLayer.type !== 'vector') return { kind: 'none' };
    if (activeLayer.elements.length !== 1) return { kind: 'ambiguous' };
    references.set(`${activeLayer.id}\0${activeLayer.elements[0]!.id}`, {
      layerId: activeLayer.id,
      elementId: activeLayer.elements[0]!.id
    });
  }
  if (references.size !== 1) return { kind: 'ambiguous' };
  const reference = [...references.values()][0]!;
  const layer = findLayerNode(document.layers, reference.layerId)?.node;
  if (!layer || layer.type !== 'vector') return { kind: 'none' };
  const element = layer.elements.find(({ id }) => id === reference.elementId);
  if (!element) return { kind: 'none' };
  if (element.type !== 'path') return { kind: 'live-shape' };
  const selectedSubpaths = new Set<string>();
  selection.anchors
    .filter(({ layerId, pathId }) => layerId === layer.id && pathId === element.id)
    .forEach(({ subpathId }) => selectedSubpaths.add(subpathId));
  const activeTarget = selection.active?.layerId === layer.id
    && selection.active.pathId === element.id ? selection.active.target : null;
  if (activeTarget && activeTarget.kind !== 'fill') selectedSubpaths.add(activeTarget.subpathId);
  let subpathId: string | null = null;
  if (selectedSubpaths.size === 1) subpathId = [...selectedSubpaths][0]!;
  else if (selectedSubpaths.size > 1) return { kind: 'ambiguous-subpath' };
  else if (element.subpaths.length === 1) subpathId = element.subpaths[0]!.id;
  else return { kind: 'ambiguous-subpath' };
  if (!element.subpaths.some(({ id }) => id === subpathId)) return { kind: 'none' };
  return {
    kind: 'resolved',
    target: { pathLayerId: layer.id, pathElementId: element.id, pathSubpathId: subpathId }
  };
};

/** Resolve the contour under the Path Text cursor before using retained selection. */
export const resolvePathTextCreationTargetAtPoint = (
  document: ImageDocument,
  selection: VectorEditorSelection,
  point: { readonly x: number; readonly y: number },
  radius: number
): PathTextCreationTargetResolution => {
  const hit = hitTestVectorDocument(document, {
    documentPoint: point, radius, includeHandles: false, includeFill: false
  });
  return hit && hit.target.kind !== 'fill' ? {
    kind: 'resolved',
    target: {
      pathLayerId: hit.layerId,
      pathElementId: hit.pathId,
      pathSubpathId: hit.target.subpathId
    }
  } : resolvePathTextCreationTarget(document, selection);
};
