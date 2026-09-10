import { filterDefinition, isFilterKind } from '@lighttable/filter-core';
import {
  layerIsLocked,
  type ImageDocument,
  type LayerId,
  type LayerNode
} from './documentTypes';
import { findLayerNode, siblingLayers } from './layerTree';

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

export const hasBackdropThroughPassThroughAncestors = (
  document: ImageDocument,
  layerId: LayerId,
  siblingIndex: number
): boolean => {
  if (siblingIndex > 0) return true;
  let entry = findLayerNode(document.layers, layerId);
  while (entry?.parentId) {
    const parentEntry = findLayerNode(document.layers, entry.parentId);
    if (!parentEntry || parentEntry.node.type !== 'group') return false;
    if (parentEntry.node.compositing !== 'pass-through') return false;
    const parentSiblings = siblingLayers(document, parentEntry.node.id);
    const parentIndex = parentSiblings.findIndex(({ id }) => id === parentEntry.node.id);
    if (parentIndex > 0) return true;
    entry = parentEntry;
  }
  return false;
};

export type LayerRasterizationEligibility =
  | { readonly ok: true; readonly layer: LayerNode }
  | {
      readonly ok: false;
      readonly reason: 'missing' | 'no-live-semantics' | 'external-backdrop';
      readonly message: string;
    };

/**
 * Evaluates rasterization in document context. A pass-through group whose
 * result depends on pixels below its subtree cannot be rendered in isolation
 * without changing appearance; callers must use Merge/Flatten instead.
 */
export const getLayerRasterizationEligibility = (
  document: ImageDocument,
  layerId: LayerId
): LayerRasterizationEligibility => {
  const entry = findLayerNode(document.layers, layerId);
  if (!entry) {
    return { ok: false, reason: 'missing', message: 'The target layer does not exist.' };
  }
  if (!layerCanBeRasterized(entry.node)) {
    return {
      ok: false,
      reason: 'no-live-semantics',
      message: 'The target must contain live, unlocked layer semantics to rasterize.'
    };
  }
  if (entry.node.type === 'group' && entry.node.compositing === 'pass-through') {
    const siblings = siblingLayers(document, entry.node.id);
    const index = siblings.findIndex(({ id }) => id === entry.node.id);
    if (hasBackdropThroughPassThroughAncestors(document, entry.node.id, index)) {
      return {
        ok: false,
        reason: 'external-backdrop',
        message: 'This pass-through group depends on content below it and cannot be rasterized without changing appearance.'
      };
    }
  }
  return { ok: true, layer: entry.node };
};
