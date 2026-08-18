import type { ImageDocument } from '../../editor/document/documentTypes';
import type {
  ColorLookupAssetBlob,
  LayerAssetBlobs
} from '../../editor/persistence/layeredDocumentFormat';

export type PsdExportIntent = 'editable' | 'maximum-appearance';

export interface PsdExportCompatibilityFinding {
  readonly severity: 'degraded-editability' | 'blocking';
  readonly code:
    | 'affine-raster-unbaked'
    | 'attached-adjustment-baked'
    | 'face-warp-baked'
    | 'grade-unprojectable'
    | 'layer-style-pattern-resource'
    | 'native-adjustment-unprojectable'
    | 'smart-object-source-missing'
    | 'text-preserved-descriptor'
    | 'text-raster-backed'
    | 'vector-preserved-descriptor'
    | 'vector-raster-backed';
  readonly path: string;
  readonly message: string;
}

export interface PsdExportRequest {
  readonly requestId: number;
  readonly document: ImageDocument;
  readonly composite: Blob;
  readonly intent: PsdExportIntent;
  readonly layerAssets: readonly LayerAssetBlobs[];
  readonly colorLookupAssets: readonly ColorLookupAssetBlob[];
}

export type PsdExportResponse = {
  readonly requestId: number;
  readonly status: 'success';
  readonly bytes: Uint8Array;
  readonly findings: readonly PsdExportCompatibilityFinding[];
  readonly warnings: readonly string[];
  readonly blockingWarnings: readonly string[];
  readonly editableTextLayers: number;
  readonly editableVectorLayers: number;
} | {
  readonly requestId: number;
  readonly status: 'error';
  readonly message: string;
};
