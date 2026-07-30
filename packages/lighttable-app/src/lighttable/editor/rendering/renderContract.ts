import type { LayerId, RasterLayer, Rect } from '../document/documentTypes';

export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface RasterRenderContract<TTexture = GPUTexture> {
  layerId: LayerId;
  texture: TTexture;
  dimensions: { width: number; height: number };
  bounds: Rect;
  colorSpace: 'linear-srgb';
  alphaMode: 'premultiplied';
  revision: {
    source: number;
    geometry: number;
  };
  /** Maps layer/source pixels into document pixels. */
  transform: AffineMatrix;
}

export const identityAffineMatrix = (): AffineMatrix => ({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0
});

export const isFiniteAffineMatrix = (value: AffineMatrix) =>
  Number.isFinite(value.a)
  && Number.isFinite(value.b)
  && Number.isFinite(value.c)
  && Number.isFinite(value.d)
  && Number.isFinite(value.tx)
  && Number.isFinite(value.ty);

export const isIdentityAffineMatrix = (value: AffineMatrix, epsilon = 1e-6) =>
  Math.abs(value.a - 1) <= epsilon
  && Math.abs(value.b) <= epsilon
  && Math.abs(value.c) <= epsilon
  && Math.abs(value.d - 1) <= epsilon
  && Math.abs(value.tx) <= epsilon
  && Math.abs(value.ty) <= epsilon;

export const rasterRenderContract = <TTexture>(
  layer: RasterLayer,
  texture: TTexture
): RasterRenderContract<TTexture> => ({
  layerId: layer.id,
  texture,
  dimensions: { width: layer.width, height: layer.height },
  bounds: { x: 0, y: 0, width: layer.width, height: layer.height },
  colorSpace: 'linear-srgb',
  alphaMode: 'premultiplied',
  revision: {
    source: layer.pixelRevision,
    geometry: layer.geometryRevision
  },
  transform: layer.transform
});
