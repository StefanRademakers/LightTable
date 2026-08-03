import type { VectorPath } from '@lighttable/vector-core';
import type { ImageDocument, LayerId, TextLayer, VectorLayer } from './documentTypes';
import { findDocumentLayer } from './layerTree';

export type PathTextDependencyResolution =
  | { readonly kind: 'not-path-text'; readonly revision: 0 }
  | { readonly kind: 'missing-layer'; readonly revision: 0; readonly layerId: string }
  | { readonly kind: 'incompatible-layer'; readonly revision: 0; readonly layerId: string }
  | { readonly kind: 'missing-element'; readonly revision: 0; readonly layerId: string; readonly elementId: string | null }
  | { readonly kind: 'ambiguous-legacy-reference'; readonly revision: 0; readonly layerId: string }
  | {
    readonly kind: 'resolved';
    readonly revision: number;
    readonly layer: VectorLayer;
    readonly path: VectorPath;
  };

const hashDependency = (values: readonly (string | number)[]) => {
  let hash = 0x811c9dc5;
  for (const character of values.join('|')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
};

const dependencyRevision = (layer: VectorLayer, path: VectorPath) => hashDependency([
  layer.id,
  layer.transform.a, layer.transform.b, layer.transform.c,
  layer.transform.d, layer.transform.tx, layer.transform.ty,
  path.id, path.geometryRevision, path.transformRevision,
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
  const { pathLayerId, pathElementId } = source.layout;
  const target = findDocumentLayer(document, pathLayerId as LayerId);
  if (!target) return { kind: 'missing-layer', revision: 0, layerId: pathLayerId };
  if (target.type !== 'vector') {
    return { kind: 'incompatible-layer', revision: 0, layerId: pathLayerId };
  }
  const paths = target.elements.filter((element): element is VectorPath => element.type === 'path');
  if (pathElementId) {
    const path = paths.find(({ id }) => id === pathElementId);
    return path
      ? { kind: 'resolved', revision: dependencyRevision(target, path), layer: target, path }
      : {
        kind: 'missing-element', revision: 0,
        layerId: pathLayerId, elementId: pathElementId
      };
  }
  if (paths.length === 1) {
    return {
      kind: 'resolved', revision: dependencyRevision(target, paths[0]!),
      layer: target, path: paths[0]!
    };
  }
  return paths.length === 0
    ? { kind: 'missing-element', revision: 0, layerId: pathLayerId, elementId: null }
    : { kind: 'ambiguous-legacy-reference', revision: 0, layerId: pathLayerId };
};
