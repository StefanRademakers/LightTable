export interface DocumentGpuMemoryResourceSnapshot {
  readonly width: number;
  readonly height: number;
  readonly sourceBitDepth: number;
  readonly source: boolean;
  readonly corrected: boolean;
  readonly downsample: boolean;
  readonly blur: boolean;
  readonly creative: boolean;
  readonly display: boolean;
  readonly final: boolean;
  readonly curveLutBytes: number;
  readonly adjustmentLayerBytes: number;
  readonly layerDocumentBytes: number;
  readonly effectBytes: number;
}

/**
 * Estimates only LightTable-owned GPU texture memory.
 *
 * Browsers do not expose driver allocation totals. Keeping this calculation
 * pure gives the multi-document workspace a deterministic policy input without
 * coupling eviction decisions to the concrete renderer.
 */
export const estimateDocumentGpuBytes = (
  snapshot: DocumentGpuMemoryResourceSnapshot
): number => {
  const width = Math.max(0, Math.floor(snapshot.width));
  const height = Math.max(0, Math.floor(snapshot.height));
  const pixels = width * height;
  const reducedPixels = Math.ceil(width / 4) * Math.ceil(height / 4);
  let bytes = 0;

  if (snapshot.source) bytes += pixels * (snapshot.sourceBitDepth > 8 ? 8 : 4);
  if (snapshot.corrected) bytes += pixels * 8;
  if (snapshot.downsample) bytes += reducedPixels * 8;
  if (snapshot.blur) bytes += reducedPixels * 8;
  if (snapshot.creative) bytes += pixels * 8;
  if (snapshot.display) bytes += pixels * 8;
  if (snapshot.final) bytes += pixels * 4;

  return bytes
    + Math.max(0, snapshot.curveLutBytes)
    + Math.max(0, snapshot.adjustmentLayerBytes)
    + Math.max(0, snapshot.layerDocumentBytes)
    + Math.max(0, snapshot.effectBytes);
};
