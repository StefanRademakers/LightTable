import type { VectorElement } from '@lighttable/vector-core';
import type { ImageDocument, LayerId, LayerNode, VectorLayer } from '../../editor/document/documentTypes';
import { layerStyleStackIsActive } from '../../editor/styles/layerStyleDefaults';

export type HybridPdfVectorPageExportReason =
  | 'no-native-vectors'
  | 'native-vectors-not-topmost'
  | 'vector-effects-unsupported'
  | 'vector-stroke-alignment-unsupported'
  | 'document-processing-active';

export type HybridPdfVectorPageExportPlan =
  | { readonly kind: 'ready'; readonly nativeVectorLayerIds: ReadonlySet<LayerId> }
  | { readonly kind: 'flattened-only'; readonly reasons: readonly HybridPdfVectorPageExportReason[] };

interface VisibleLeaf {
  readonly layer: Exclude<LayerNode, { type: 'group' }>;
  readonly ancestorEffects: boolean;
}

const compositingEffects = (node: LayerNode) => node.clipping
  || node.mask !== null
  || node.blendMode !== 'normal'
  || layerStyleStackIsActive(node.styleStack)
  || (node.type === 'group' && (node.compositing === 'isolated'
    || node.opacity !== 1 || node.fillOpacity !== 1));

const visibleLeaves = (
  nodes: readonly LayerNode[],
  ancestorsVisible = true,
  ancestorEffects = false,
  result: VisibleLeaf[] = []
) => {
  for (const node of nodes) {
    const visible = ancestorsVisible && node.visible && node.opacity > 0;
    if (!visible) continue;
    const effects = ancestorEffects || compositingEffects(node);
    if (node.type === 'group') visibleLeaves(node.children, visible, effects, result);
    else result.push({ layer: node, ancestorEffects: effects });
  }
  return result;
};

const elementHasVisiblePaint = (element: VectorElement) => (
  element.style.opacity > 0
  && (Boolean(element.style.fill && element.style.fill.color[3] > 0)
    || Boolean(element.style.stroke && element.style.stroke.width > 0
      && element.style.stroke.paint.color[3] > 0))
);

const layerReason = (
  layer: VectorLayer,
  ancestorEffects: boolean
): HybridPdfVectorPageExportReason | null => {
  if (ancestorEffects) return 'vector-effects-unsupported';
  if (layer.elements.some(element => element.style.stroke
    && (element.style.stroke.alignment ?? 'center') !== 'center')) {
    return 'vector-stroke-alignment-unsupported';
  }
  return null;
};

/** Authorizes one raster underlay followed by a native vector-layer suffix. */
export const planHybridPdfVectorPageExport = (
  document: ImageDocument,
  documentProcessingActive: boolean
): HybridPdfVectorPageExportPlan => {
  const reasons = new Set<HybridPdfVectorPageExportReason>();
  if (documentProcessingActive) reasons.add('document-processing-active');
  const leaves = visibleLeaves(document.layers);
  const native = new Set<LayerId>();
  leaves.forEach(({ layer, ancestorEffects }) => {
    if (layer.type !== 'vector' || !layer.elements.some(elementHasVisiblePaint)) return;
    const reason = layerReason(layer, ancestorEffects);
    if (reason) reasons.add(reason);
    else native.add(layer.id);
  });
  if (native.size === 0) reasons.add('no-native-vectors');
  const firstNative = leaves.findIndex(({ layer }) => native.has(layer.id));
  if (firstNative >= 0 && leaves.slice(firstNative).some(({ layer }) => !native.has(layer.id))) {
    reasons.add('native-vectors-not-topmost');
  }
  return reasons.size > 0
    ? { kind: 'flattened-only', reasons: [...reasons] }
    : { kind: 'ready', nativeVectorLayerIds: native };
};
