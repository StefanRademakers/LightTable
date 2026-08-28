import type { ImageDocument } from '../../editor/document/documentTypes';
import type {
  ColorLookupAssetBlob,
  LayerAssetBlobs
} from '../../editor/persistence/layeredDocumentFormat';
import type {
  PsdExportCompatibilityFinding,
  PsdExportIntent,
  PsdExportRequest,
  PsdExportResponse
} from './psdExportProtocol';

export interface ExportedPsdDocument {
  readonly file: File;
  readonly findings: readonly PsdExportCompatibilityFinding[];
  readonly warnings: readonly string[];
  readonly editableTextLayers: number;
  readonly editableVectorLayers: number;
}

let sequence = 0;

export const exportPsdDocument = async (
  document: ImageDocument,
  composite: Blob,
  layerAssets: readonly LayerAssetBlobs[],
  colorLookupAssets: readonly ColorLookupAssetBlob[],
  fileNameBase: string,
  intent: PsdExportIntent = 'editable',
  signal?: AbortSignal
): Promise<ExportedPsdDocument> => {
  if (signal?.aborted) throw new DOMException('PSD export was canceled.', 'AbortError');
  if (document.width > 30_000 || document.height > 30_000) {
    throw new Error('PSB export remains validation-gated; PSD supports at most 30,000 px per side.');
  }
  const worker = new Worker(new URL('./psdExport.worker.ts', import.meta.url), { type: 'module' });
  const requestId = ++sequence;
  let detachAbort = () => {};
  try {
    const response = await new Promise<PsdExportResponse>((resolve, reject) => {
      const abort = () => {
        worker.terminate();
        reject(new DOMException('PSD export was canceled.', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      detachAbort = () => signal?.removeEventListener('abort', abort);
      worker.onmessage = (event: MessageEvent<PsdExportResponse>) => {
        if (event.data.requestId === requestId) resolve(event.data);
      };
      worker.onerror = (event) => reject(new Error(event.message || 'The PSD export worker failed.'));
      try {
        worker.postMessage({
          requestId, document, composite, layerAssets, colorLookupAssets, intent
        } satisfies PsdExportRequest);
      } catch (reason) {
        reject(reason instanceof Error ? reason : new Error('The PSD export worker failed to start.'));
      }
    });
    if (response.status === 'error') throw new Error(response.message);
    if (response.blockingWarnings.length > 0) {
      throw new Error(
        `Photoshop export was stopped to prevent appearance loss:\n${response.blockingWarnings.join('\n')}`
      );
    }
    const bitDepthFinding: PsdExportCompatibilityFinding | null =
      document.colorSettings.bitDepth > 8 ? {
        severity: 'degraded-fidelity',
        code: 'psd-8-bit-export',
        path: 'document.colorSettings.bitDepth',
        message: `The current PSD writer encodes 8 bits/channel; this ${document.colorSettings.bitDepth}-bit LightTable document is quantized only at the PSD boundary.`
      } : null;
    const findings = bitDepthFinding
      ? [bitDepthFinding, ...response.findings]
      : response.findings;
    const warnings = bitDepthFinding
      ? [`${bitDepthFinding.path}: ${bitDepthFinding.message}`, ...response.warnings]
      : response.warnings;
    const base = fileNameBase.replace(/\.[^.]+$/, '') || 'document';
    const name = `${base}${intent === 'maximum-appearance' ? '-appearance' : ''}.psd`;
    return {
      file: new File([Uint8Array.from(response.bytes).buffer], name, { type: 'image/vnd.adobe.photoshop' }),
      findings,
      warnings,
      editableTextLayers: response.editableTextLayers,
      editableVectorLayers: response.editableVectorLayers
    };
  } finally {
    detachAbort();
    worker.terminate();
  }
};
