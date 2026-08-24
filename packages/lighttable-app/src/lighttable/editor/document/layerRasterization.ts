import { isIdentityAffineMatrix } from '@lighttable/vector-core';
import { layerIsLocked, type LayerNode } from './documentTypes';

/**
 * True when rasterization would collapse live layer semantics into pixels.
 *
 * A plain raster layer is already rasterized. Re-projecting it would only
 * allocate another full-canvas GPU resource, replace its stable layer ID and
 * add a meaningless history entry. Outer stack relationships (opacity, blend
 * mode and clipping) deliberately remain live and therefore do not make a
 * raster layer eligible by themselves.
 */
export const layerCanBeRasterized = (layer: LayerNode): boolean => {
  if (layerIsLocked(layer, 'pixels')) return false;

  if (layer.type === 'adjustment') {
    // A standalone adjustment has no intrinsic pixels. It needs Merge Down or
    // attachment to a raster owner so its input is explicit.
    return false;
  }

  if (layer.type !== 'raster') return true;

  return layer.adjustmentStack !== null
    || Boolean(layer.attachedAdjustments?.length)
    || layer.mask !== null
    || layer.styleStack.effects.length > 0
    || !isIdentityAffineMatrix(layer.transform);
};
