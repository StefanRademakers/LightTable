import { transformedBounds, type AffineMatrix, type Rect, type VectorId, type VectorPath } from '@lighttable/vector-core';

export interface VectorRevision {
  geometry: number;
  transform: number;
  style: number;
}

export interface VectorGeometryKey {
  pathId: VectorId;
  geometryRevision: number;
  /** Quantized document-space curve tolerance, never viewport pan. */
  toleranceBucket: number;
}

export interface VectorRenderContract<TResource> {
  pathId: VectorId;
  resource: TResource;
  localBounds: Rect | null;
  documentBounds: Rect | null;
  colorSpace: 'linear-srgb';
  alphaMode: 'premultiplied';
  revision: VectorRevision;
  /** Maps path-local coordinates into document coordinates. */
  transform: AffineMatrix;
}

export const vectorGeometryKey = (
  pathId: VectorId,
  geometryRevision: number,
  toleranceBucket: number
): VectorGeometryKey => ({ pathId, geometryRevision, toleranceBucket });

export const serializeVectorGeometryKey = (key: VectorGeometryKey) =>
  `${key.pathId}:${key.geometryRevision}:${key.toleranceBucket}`;

export const vectorRenderContract = <TResource>(
  path: VectorPath,
  resource: TResource,
  localBounds: Rect | null
): VectorRenderContract<TResource> => ({
  pathId: path.id,
  resource,
  localBounds,
  documentBounds: localBounds ? transformedBounds(path.transform, localBounds) : null,
  colorSpace: 'linear-srgb',
  alphaMode: 'premultiplied',
  revision: {
    geometry: path.geometryRevision,
    transform: path.transformRevision,
    style: path.styleRevision
  },
  transform: { ...path.transform }
});
