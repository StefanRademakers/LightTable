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
  intent: PsdExportIntent = 'editable'
): Promise<ExportedPsdDocument> => {
  if (document.width > 30_000 || document.height > 30_000) {
    throw new Error('PSB export remains validation-gated; PSD supports at most 30,000 px per side.');
  }
  const worker = new Worker(new URL('./psdExport.worker.ts', import.meta.url), { type: 'module' });
  const requestId = ++sequence;
  try {
    const response = await new Promise<PsdExportResponse>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<PsdExportResponse>) => {
        if (event.data.requestId === requestId) resolve(event.data);
      };
      worker.onerror = (event) => reject(new Error(event.message || 'The PSD export worker failed.'));
      worker.postMessage({
        requestId, document, composite, layerAssets, colorLookupAssets, intent
      } satisfies PsdExportRequest);
    });
    if (response.status === 'error') throw new Error(response.message);
    if (response.blockingWarnings.length > 0) {
      throw new Error(
        `Photoshop export was stopped to prevent appearance loss:\n${response.blockingWarnings.join('\n')}`
      );
    }
    const base = fileNameBase.replace(/\.[^.]+$/, '') || 'document';
    const name = `${base}${intent === 'maximum-appearance' ? '-appearance' : ''}.psd`;
    return {
      file: new File([Uint8Array.from(response.bytes).buffer], name, { type: 'image/vnd.adobe.photoshop' }),
      findings: response.findings,
      warnings: response.warnings,
      editableTextLayers: response.editableTextLayers,
      editableVectorLayers: response.editableVectorLayers
    };
  } finally {
    worker.terminate();
  }
};
