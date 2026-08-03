import type { PdfTextExportPlan } from '@lighttable/pdf-core';
import type { ImageDocument, LayerId, LayerNode } from '../../editor/document/documentTypes';

export type HybridPdfPageExportReason =
  | 'text-plan-blocked'
  | 'no-native-text'
  | 'stale-native-layer'
  | 'native-text-not-topmost'
  | 'document-processing-active';

export type HybridPdfPageExportPlan =
  | {
    readonly kind: 'ready';
    readonly nativeTextLayerIds: ReadonlySet<LayerId>;
  }
  | {
    readonly kind: 'flattened-only';
    readonly reasons: readonly HybridPdfPageExportReason[];
  };

export interface HybridPdfPageExportInput {
  readonly document: ImageDocument;
  readonly textPlan: PdfTextExportPlan;
  /** Native overlay text cannot reproduce a document-wide grade or Lens Fx yet. */
  readonly documentProcessingActive: boolean;
}

const visibleLeaves = (
  nodes: readonly LayerNode[],
  ancestorsVisible = true,
  result: LayerNode[] = []
) => {
  for (const node of nodes) {
    const visible = ancestorsVisible && node.visible && node.opacity > 0;
    if (!visible) continue;
    if (node.type === 'group') visibleLeaves(node.children, visible, result);
    else result.push(node);
  }
  return result;
};

/**
 * Authorizes the first hybrid writer topology: one raster underlay followed by
 * exact native text. More general interleaving belongs to the display-list
 * writer and must not be approximated by silently changing document z-order.
 */
export const planHybridPdfPageExport = ({
  document,
  textPlan,
  documentProcessingActive
}: HybridPdfPageExportInput): HybridPdfPageExportPlan => {
  const reasons = new Set<HybridPdfPageExportReason>();
  if (!textPlan.canExport) reasons.add('text-plan-blocked');
  if (documentProcessingActive) reasons.add('document-processing-active');

  const nativeIds = new Set(textPlan.layers
    .filter(layer => layer.disposition === 'text')
    .map(layer => layer.layerId as LayerId));
  if (nativeIds.size === 0) reasons.add('no-native-text');

  const leaves = visibleLeaves(document.layers);
  const byId = new Map(leaves.map(layer => [layer.id, layer]));
  if ([...nativeIds].some(id => byId.get(id)?.type !== 'text')) {
    reasons.add('stale-native-layer');
  }

  const firstNative = leaves.findIndex(layer => nativeIds.has(layer.id));
  if (firstNative >= 0 && leaves.slice(firstNative).some(layer => !nativeIds.has(layer.id))) {
    reasons.add('native-text-not-topmost');
  }

  return reasons.size > 0
    ? { kind: 'flattened-only', reasons: [...reasons] }
    : { kind: 'ready', nativeTextLayerIds: nativeIds };
};
