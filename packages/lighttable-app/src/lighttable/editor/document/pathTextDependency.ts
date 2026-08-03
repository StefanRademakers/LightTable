import type { AffineMatrix, VectorPath, VectorSubpath } from '@lighttable/vector-core';
import type { ImageDocument, LayerId, TextLayer, VectorLayer } from './documentTypes';
import { findDocumentLayer } from './layerTree';
import { buildSceneTransformIndex, requireSceneTransform } from './sceneTransformGraph';

export type PathTextDependencyResolution =
  | { readonly kind: 'not-path-text'; readonly revision: 0 }
  | { readonly kind: 'missing-layer'; readonly revision: 0; readonly layerId: string }
  | { readonly kind: 'incompatible-layer'; readonly revision: 0; readonly layerId: string }
  | { readonly kind: 'missing-element'; readonly revision: 0; readonly layerId: string; readonly elementId: string | null }
  | { readonly kind: 'ambiguous-legacy-reference'; readonly revision: 0; readonly layerId: string }
  | { readonly kind: 'missing-subpath'; readonly revision: 0; readonly layerId: string; readonly elementId: string; readonly subpathId: string | null }
  | { readonly kind: 'ambiguous-legacy-subpath'; readonly revision: 0; readonly layerId: string; readonly elementId: string }
  | {
    readonly kind: 'resolved';
    readonly revision: number;
    readonly layer: VectorLayer;
    readonly layerToDocument: AffineMatrix;
    readonly path: VectorPath;
    readonly subpath: VectorSubpath;
  };

const hashDependency = (values: readonly (string | number)[]) => {
  let hash = 0x811c9dc5;
  for (const character of values.join('|')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
};

const dependencyRevision = (
  layer: VectorLayer,
  layerToDocument: AffineMatrix,
  path: VectorPath,
  subpath: VectorSubpath
) => hashDependency([
  layer.id,
  layerToDocument.a, layerToDocument.b, layerToDocument.c,
  layerToDocument.d, layerToDocument.tx, layerToDocument.ty,
  path.id, subpath.id, path.geometryRevision, path.transformRevision,
  path.transform.a, path.transform.b, path.transform.c,
  path.transform.d, path.transform.tx, path.transform.ty
]);

/** Resolves a stable path-text target without silently choosing among siblings. */
export const resolvePathTextDependency = (
  document: ImageDocument,
  textLayer: TextLayer
): PathTextDependencyResolution => {
  const source = textLayer.text.source;
  if (source.kind !== 'flow' || source.layout.mode !== 'path') {
    return { kind: 'not-path-text', revision: 0 };
  }
  const { pathLayerId, pathElementId, pathSubpathId } = source.layout;
  const target = findDocumentLayer(document, pathLayerId as LayerId);
  if (!target) return { kind: 'missing-layer', revision: 0, layerId: pathLayerId };
  if (target.type !== 'vector') {
    return { kind: 'incompatible-layer', revision: 0, layerId: pathLayerId };
  }
  const paths = target.elements.filter((element): element is VectorPath => element.type === 'path');
  let path: VectorPath;
  if (pathElementId) {
    const exact = paths.find(({ id }) => id === pathElementId);
    if (!exact) return {
        kind: 'missing-element', revision: 0,
        layerId: pathLayerId, elementId: pathElementId
      };
    path = exact;
  } else {
    if (paths.length !== 1) {
      return paths.length === 0
        ? { kind: 'missing-element', revision: 0, layerId: pathLayerId, elementId: null }
        : { kind: 'ambiguous-legacy-reference', revision: 0, layerId: pathLayerId };
    }
    path = paths[0]!;
  }
  let subpath: VectorSubpath;
  if (pathSubpathId) {
    const exact = path.subpaths.find(({ id }) => id === pathSubpathId);
    if (!exact) return {
      kind: 'missing-subpath', revision: 0, layerId: pathLayerId,
      elementId: path.id, subpathId: pathSubpathId
    };
    subpath = exact;
  } else {
    if (path.subpaths.length !== 1) {
      return path.subpaths.length === 0
        ? {
          kind: 'missing-subpath', revision: 0, layerId: pathLayerId,
          elementId: path.id, subpathId: null
        }
        : {
          kind: 'ambiguous-legacy-subpath', revision: 0,
          layerId: pathLayerId, elementId: path.id
        };
    }
    subpath = path.subpaths[0]!;
  }
  const layerToDocument = requireSceneTransform(
    buildSceneTransformIndex(document),
    target.id
  ).localToDocument;
  return {
    kind: 'resolved', revision: dependencyRevision(target, layerToDocument, path, subpath),
    layer: target, layerToDocument, path, subpath
  };
};
