import type { ImageDocument } from '../../editor/document/documentTypes';
import type {
  ColorLookupAssetBlob,
  LayerAssetBlobs
} from '../../editor/persistence/layeredDocumentFormat';

export interface PsdExportRequest {
  readonly requestId: number;
  readonly document: ImageDocument;
  readonly composite: Blob;
  readonly layerAssets: readonly LayerAssetBlobs[];
  readonly colorLookupAssets: readonly ColorLookupAssetBlob[];
}

export type PsdExportResponse = {
  readonly requestId: number;
  readonly status: 'success';
  readonly bytes: Uint8Array;
  readonly warnings: readonly string[];
  readonly editableTextLayers: number;
  readonly editableVectorLayers: number;
} | {
  readonly requestId: number;
  readonly status: 'error';
  readonly message: string;
};
