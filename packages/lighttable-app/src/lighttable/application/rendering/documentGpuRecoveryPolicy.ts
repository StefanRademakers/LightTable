import type { ImageDocument, LayerNode } from '../../editor/document/documentTypes';

export interface AutomaticGpuRecovery {
  readonly mode: 'automatic';
}

export interface CheckpointRequiredGpuRecovery {
  readonly mode: 'checkpoint-required';
  readonly reasons: readonly string[];
}

export type DocumentGpuRecoveryPolicy =
  | AutomaticGpuRecovery
  | CheckpointRequiredGpuRecovery;

const inspectLayer = (layer: LayerNode, reasons: Set<string>): void => {
  if (layer.type === 'raster') reasons.add('raster pixels');
  if (layer.mask) reasons.add('raster masks');
  if (layer.type === 'group') layer.children.forEach((child) => inspectLayer(child, reasons));
};

/**
 * Decides whether a canonical document is sufficient to rebuild a renderer on
 * a replacement GPUDevice.
 *
 * Vector, text and ordinary adjustment payloads are canonical CPU data. Raster
 * pixels, masks, patterns and LUT bytes currently live in device-scoped stores
 * (or separate binary-asset stores), so silently rebinding them to an empty
 * repository would present a partial document as recovered. Those documents
 * must stay failed until a durable checkpoint/source hydration path restores
 * every resource.
 */
export const resolveDocumentGpuRecoveryPolicy = (
  document: ImageDocument
): DocumentGpuRecoveryPolicy => {
  const reasons = new Set<string>();
  document.layers.forEach((layer) => inspectLayer(layer, reasons));
  if (document.assets.patterns.length > 0) reasons.add('pattern pixels');
  if (document.assets.colorLookups.length > 0) reasons.add('color lookup data');
  return reasons.size === 0
    ? { mode: 'automatic' }
    : { mode: 'checkpoint-required', reasons: [...reasons] };
};
