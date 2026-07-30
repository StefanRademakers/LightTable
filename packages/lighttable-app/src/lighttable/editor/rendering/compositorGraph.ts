import type { GroupLayer, LayerNode } from '../document/documentTypes';
import { layerStyleStackIsActive } from '../styles/layerStyleDefaults';

export interface CompositorSequenceEntry {
  node: LayerNode;
  /** The node inherits alpha from the preceding unclipped base. */
  usesClippingBase: boolean;
  /** Malformed clipped nodes without a base must render transparent. */
  skipBecauseClippingBaseMissing: boolean;
  /** Render this node once in isolation to establish the following clip chain. */
  captureClippingBase: boolean;
}

/**
 * Resolves sibling clipping-chain semantics without allocating GPU resources.
 * Layer arrays are bottom-most first, matching both LightTable and PSD import.
 */
export const buildCompositorSequence = (
  nodes: readonly LayerNode[]
): readonly CompositorSequenceEntry[] => {
  let clippingBaseAvailable = false;
  return nodes.map((node, index) => {
    const usesClippingBase = node.clipping && clippingBaseAvailable;
    const skipBecauseClippingBaseMissing = node.clipping && !clippingBaseAvailable;
    const captureClippingBase = !node.clipping && Boolean(nodes[index + 1]?.clipping);

    if (!node.clipping) clippingBaseAvailable = captureClippingBase;

    return {
      node,
      usesClippingBase,
      skipBecauseClippingBaseMissing,
      captureClippingBase
    };
  });
};

export const collectVisibleLeafNodes = (
  nodes: readonly LayerNode[],
  result: LayerNode[] = []
): readonly LayerNode[] => {
  for (const node of nodes) {
    if (!node.visible) continue;
    if (node.type === 'group') collectVisibleLeafNodes(node.children, result);
    else result.push(node);
  }
  return result;
};

export const containsActiveLayerStyles = (nodes: readonly LayerNode[]): boolean =>
  nodes.some((node) => (
    node.visible
    && node.opacity > 0
    && (
      layerStyleStackIsActive(node.styleStack)
      || (node.type === 'group' && containsActiveLayerStyles(node.children))
    )
  ));

export const containsVisibleAdjustmentLayer = (
  nodes: readonly LayerNode[]
): boolean =>
  nodes.some((node) => (
    node.visible
    && node.opacity > 0
    && (
      node.type === 'adjustment'
      || (node.type === 'group' && containsVisibleAdjustmentLayer(node.children))
    )
  ));

/**
 * Pass-through groups only need an offscreen envelope when group-level
 * semantics can no longer participate directly in the parent stack.
 */
export const groupNeedsCompositingEnvelope = (
  group: GroupLayer,
  maskTextureAvailable: boolean
): boolean =>
  group.compositing === 'isolated'
  || group.clipping
  || group.opacity < 0.99999
  || group.blendMode !== 'normal'
  || layerStyleStackIsActive(group.styleStack)
  || Boolean(group.mask?.enabled && maskTextureAvailable);
