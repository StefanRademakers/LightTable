import type { PdfTextExportPlan } from '@lighttable/pdf-core';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import {
  collectPdfVisibleLeaves,
  pdfVectorElementHasVisiblePaint,
  pdfVectorLayerNativeReason
} from './planHybridPdfVectorPageExport';

export type HybridPdfNativePageExportReason =
  | 'no-native-content'
  | 'native-content-not-topmost'
  | 'stale-native-text-layer'
  | 'vector-content-unsupported'
  | 'document-processing-active';

export type HybridPdfNativePageExportPlan =
  | {
    readonly kind: 'ready';
    readonly nativeTextLayerIds: ReadonlySet<LayerId>;
    readonly nativeVectorLayerIds: ReadonlySet<LayerId>;
    /** Exact PDF content-stream order, from the bottom layer to the top layer. */
    readonly nativeLayerOrder: readonly LayerId[];
  }
  | {
    readonly kind: 'flattened-only';
    readonly reasons: readonly HybridPdfNativePageExportReason[];
  };

export interface HybridPdfNativePageExportInput {
  readonly document: ImageDocument;
  readonly textPlan: PdfTextExportPlan;
  readonly documentProcessingActive: boolean;
}

/**
 * Authorizes one raster underlay followed by an ordered native text/vector
 * suffix. Content outside that suffix remains in the GPU-rendered underlay.
 */
export const planHybridPdfNativePageExport = ({
  document,
  textPlan,
  documentProcessingActive
}: HybridPdfNativePageExportInput): HybridPdfNativePageExportPlan => {
  const reasons = new Set<HybridPdfNativePageExportReason>();
  if (documentProcessingActive) reasons.add('document-processing-active');

  const leaves = collectPdfVisibleLeaves(document.layers);
  const textPlanIds = new Set(textPlan.layers
    .filter(layer => layer.disposition === 'text')
    .map(layer => layer.layerId as LayerId));
  const visibleIds = new Set(leaves.map(({ layer }) => layer.id));
  if ([...textPlanIds].some(id => !visibleIds.has(id))) reasons.add('stale-native-text-layer');

  const nativeTextLayerIds = new Set<LayerId>();
  const nativeVectorLayerIds = new Set<LayerId>();
  let hasUnsupportedVector = false;
  leaves.forEach(({ layer, ancestorEffects }) => {
    if (layer.type === 'text' && textPlanIds.has(layer.id)) {
      nativeTextLayerIds.add(layer.id);
      return;
    }
    if (layer.type !== 'vector' || !layer.elements.some(pdfVectorElementHasVisiblePaint)) return;
    if (pdfVectorLayerNativeReason(layer, ancestorEffects)) hasUnsupportedVector = true;
    else nativeVectorLayerIds.add(layer.id);
  });

  const isNative = (id: LayerId) => nativeTextLayerIds.has(id) || nativeVectorLayerIds.has(id);
  const firstNative = leaves.findIndex(({ layer }) => isNative(layer.id));
  if (firstNative < 0) reasons.add('no-native-content');
  else if (leaves.slice(firstNative).some(({ layer }) => !isNative(layer.id))) {
    reasons.add('native-content-not-topmost');
  }
  if (hasUnsupportedVector && firstNative >= 0
    && leaves.slice(firstNative).some(({ layer }) => layer.type === 'vector'
      && layer.elements.some(pdfVectorElementHasVisiblePaint)
      && !nativeVectorLayerIds.has(layer.id))) {
    reasons.add('vector-content-unsupported');
  }

  if (reasons.size > 0) return { kind: 'flattened-only', reasons: [...reasons] };
  return {
    kind: 'ready',
    nativeTextLayerIds,
    nativeVectorLayerIds,
    nativeLayerOrder: leaves.slice(firstNative).map(({ layer }) => layer.id)
  };
};
