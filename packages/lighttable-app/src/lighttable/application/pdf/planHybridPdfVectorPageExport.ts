import type { VectorElement } from '@lighttable/vector-core';
import type { ImageDocument, LayerId, LayerNode, VectorLayer } from '../../editor/document/documentTypes';
import { layerStyleStackIsActive } from '../../editor/styles/layerStyleDefaults';
import { pdfLayerBlendMode } from './pdfLayerBlendMode';

export type HybridPdfVectorPageExportReason =
  | 'no-native-vectors'
  | 'native-vectors-not-topmost'
  | 'vector-effects-unsupported'
  | 'vector-blend-mode-unsupported'
  | 'vector-stroke-alignment-unsupported'
  | 'document-processing-active';

export type HybridPdfVectorPageExportPlan =
  | { readonly kind: 'ready'; readonly nativeVectorLayerIds: ReadonlySet<LayerId> }
  | { readonly kind: 'flattened-only'; readonly reasons: readonly HybridPdfVectorPageExportReason[] };

export interface PdfVisibleLeaf {
  readonly layer: Exclude<LayerNode, { type: 'group' }>;
  readonly ancestorEffects: boolean;
  readonly ancestorIsolation: boolean;
}

const ancestorCompositingEffects = (node: LayerNode) => node.type === 'group'
  && (node.clipping
    || node.mask !== null
    || node.blendMode !== 'normal'
    || layerStyleStackIsActive(node.styleStack)
    || node.opacity !== 1
    || node.fillOpacity !== 1);

export const collectPdfVisibleLeaves = (
  nodes: readonly LayerNode[],
  ancestorsVisible = true,
  ancestorEffects = false,
  ancestorIsolation = false,
  result: PdfVisibleLeaf[] = []
) => {
  for (const node of nodes) {
    const visible = ancestorsVisible && node.visible && node.opacity > 0;
    if (!visible) continue;
    const effects = ancestorEffects || ancestorCompositingEffects(node);
    const isolated = ancestorIsolation || (node.type === 'group' && node.compositing === 'isolated');
    if (node.type === 'group') {
      collectPdfVisibleLeaves(node.children, visible, effects, isolated, result);
    } else result.push({ layer: node, ancestorEffects: effects, ancestorIsolation: isolated });
  }
  return result;
};

export const pdfVectorElementHasVisiblePaint = (element: VectorElement) => (
  element.style.opacity > 0
  && (Boolean(element.style.fill && element.style.fill.color[3] > 0)
    || Boolean(element.style.stroke && element.style.stroke.width > 0
      && element.style.stroke.paint.color[3] > 0))
);

export const pdfVectorLayerNativeReason = (
  layer: VectorLayer,
  ancestorEffects: boolean,
  ancestorIsolation = false
): HybridPdfVectorPageExportReason | null => {
  if (ancestorEffects) return 'vector-effects-unsupported';
  if (layer.clipping || layer.mask !== null || layerStyleStackIsActive(layer.styleStack)) {
    return 'vector-effects-unsupported';
  }
  if (!pdfLayerBlendMode(layer.blendMode)) return 'vector-blend-mode-unsupported';
  if (ancestorIsolation && layer.blendMode !== 'normal') return 'vector-effects-unsupported';
  const paintedElements = layer.elements.filter(pdfVectorElementHasVisiblePaint).length;
  if ((layer.opacity !== 1 || layer.fillOpacity !== 1 || layer.blendMode !== 'normal')
    && paintedElements !== 1) return 'vector-effects-unsupported';
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
  const leaves = collectPdfVisibleLeaves(document.layers);
  const native = new Set<LayerId>();
  leaves.forEach(({ layer, ancestorEffects, ancestorIsolation }) => {
    if (layer.type !== 'vector' || !layer.elements.some(pdfVectorElementHasVisiblePaint)) return;
    const reason = pdfVectorLayerNativeReason(layer, ancestorEffects, ancestorIsolation);
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
