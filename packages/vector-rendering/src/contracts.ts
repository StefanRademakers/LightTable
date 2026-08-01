import type { AffineMatrix, Rect, VectorId } from '@lighttable/vector-core';

export interface VectorRevision {
  geometry: number;
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
