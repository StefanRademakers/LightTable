import { filterDefinition, isFilterKind } from '@lighttable/filter-core';
import { layerIsLocked, type LayerNode } from './documentTypes';

const hasLiveLinearTransform = (layer: Extract<LayerNode, { type: 'raster' }>, epsilon = 1e-6) => (
  Math.abs(layer.transform.a - 1) > epsilon
  || Math.abs(layer.transform.b) > epsilon
  || Math.abs(layer.transform.c) > epsilon
  || Math.abs(layer.transform.d - 1) > epsilon
);

/**
 * True when rasterization would collapse live layer semantics into pixels.
 *
 * A plain raster layer is already rasterized. Re-projecting it would only
 * allocate another full-canvas GPU resource, replace its stable layer ID and
 * add a meaningless history entry. Outer stack relationships (opacity, blend
 * mode and clipping) deliberately remain live and therefore do not make a
 * raster layer eligible by themselves. Position is also ordinary pixel-layer
 * geometry: a bounded pasted bitmap uses transform.tx/ty to own its document
 * location and must not masquerade as an unrasterized live transform.
 */
export const layerCanBeRasterized = (layer: LayerNode): boolean => {
  if (layerIsLocked(layer, 'pixels')) return false;

  if (layer.type === 'adjustment') {
    // Render filters such as Clouds and Fibers generate their own pixels and
    // can be baked in isolation. Corrections that process the stack below
    // still need Merge Down so their input remains explicit.
    return Boolean(
      layer.adjustmentKind
      && isFilterKind(layer.adjustmentKind)
      && filterDefinition(layer.adjustmentKind).alphaBehavior === 'generate'
    );
  }

  if (layer.type !== 'raster') return true;

  return layer.adjustmentStack !== null
    || Boolean(layer.attachedAdjustments?.length)
    || layer.mask !== null
    || layer.styleStack.effects.length > 0
    || hasLiveLinearTransform(layer);
};
