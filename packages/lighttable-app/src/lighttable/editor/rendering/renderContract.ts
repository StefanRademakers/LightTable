import type { LayerId, RasterLayer, Rect } from '../document/documentTypes';
import type { AffineMatrix } from '../geometry/affine';
export type { AffineMatrix } from '../geometry/affine';
export {
  identityAffineMatrix,
  isFiniteAffineMatrix,
  isIdentityAffineMatrix
} from '../geometry/affine';
import { identityAffineMatrix } from '../geometry/affine';

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
