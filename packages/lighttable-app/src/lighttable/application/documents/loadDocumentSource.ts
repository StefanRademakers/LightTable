import type { AdjustmentStack } from '../../processing/adjustmentStack';
import {
  createImageDocument,
  type ImageDocument
} from '../../editor/document/documentTypes';
import {
  parseLayeredDocumentFile,
  type DocumentAssetBlob,
  type ParsedLayeredDocument
} from '../../editor/persistence/layeredDocumentFormat';
import {
  importPsdDocument,
  type PsdDocumentImport,
  type PsdImportCompatibilityEntry
} from '../../editor/psd/psdDocumentAdapter';
import {
  isPhotoshopDocument,
  isSupportedImageFile
} from '../../image-io/supportedImageFormats';
import type { PsdDecodeSuccess } from '../../image-io/psdProtocol';
import type { LightTableImageMetadata } from '../../types';
import type {
  LightTableImageDecodeMode,
  LightTableLoadImageOptions
} from '../rendering/rendererTypes';

export interface DocumentSourceRenderer {
  loadImage(
    blob: Blob,
    name: string,
    options?: LightTableLoadImageOptions
  ): Promise<LightTableImageMetadata>;
  setDocument(document: ImageDocument): void;
  loadLayerAssets(assets: DocumentAssetBlob[]): Promise<void>;
}

export interface DocumentSourceLoadTimings {
  readonly layeredProbeMs: number;
  readonly decodeAndUploadMs: number;
  readonly documentInitMs: number;
}

export interface LoadedDocumentSource {
  readonly document: ImageDocument;
  readonly metadata: LightTableImageMetadata;
  readonly imageBlob: Blob;
  readonly layeredAdjustmentStack: AdjustmentStack | null;
  readonly psdImport: PsdDecodeSuccess | null;
  readonly psdWarnings: readonly string[];
  readonly psdCompatibility: readonly PsdImportCompatibilityEntry[];
  readonly timings: DocumentSourceLoadTimings;
}

interface DocumentSourceLoaderDependencies {
  parseLayered(blob: Blob): Promise<ParsedLayeredDocument | null>;
  isPhotoshop(blob: Blob, name: string): boolean;
  decodePhotoshop(blob: Blob, signal?: AbortSignal): Promise<PsdDecodeSuccess>;
  importPhotoshop(decoded: PsdDecodeSuccess, name: string): PsdDocumentImport;
  supportsImage(blob: Blob, name: string, mode: LightTableImageDecodeMode): boolean;
  now(): number;
}

const defaultDependencies: DocumentSourceLoaderDependencies = {
  parseLayered: parseLayeredDocumentFile,
  isPhotoshop: isPhotoshopDocument,
  decodePhotoshop: async (blob, signal) => {
    const { PsdDecoder } = await import('../../image-io/PsdDecoder');
    const decoder = new PsdDecoder();
    try {
      return await decoder.decode(blob, signal);
    } finally {
      decoder.destroy();
    }
  },
  importPhotoshop: importPsdDocument,
  supportsImage: isSupportedImageFile,
  now: () => performance.now()
};

export interface LoadDocumentSourceRequest {
  readonly renderer: DocumentSourceRenderer;
  readonly blob: Blob;
  readonly name: string;
  readonly cacheKey: string;
  readonly decodeMode: LightTableImageDecodeMode;
  readonly signal?: AbortSignal;
  readonly isCanceled?: () => boolean;
  /** Test seam; production callers use the default import adapters. */
  readonly dependencies?: Partial<DocumentSourceLoaderDependencies>;
}

const canceled = (request: LoadDocumentSourceRequest) =>
  request.signal?.aborted || request.isCanceled?.() === true;

/**
 * Imports one external source into the native LightTable document model and
 * hydrates the renderer with its canonical layer assets.
 *
 * Host/UI state deliberately stays outside this service. The same workflow is
 * therefore usable by web, Electron and future batch/document hosts.
 */
export const loadDocumentSource = async (
  request: LoadDocumentSourceRequest
): Promise<LoadedDocumentSource | null> => {
  const dependencies = { ...defaultDependencies, ...request.dependencies };

  const probeStartedAt = dependencies.now();
  const layered = await dependencies.parseLayered(request.blob);
  const layeredProbeMs = dependencies.now() - probeStartedAt;
  if (canceled(request)) return null;

  let psdImport: PsdDecodeSuccess | null = null;
  if (!layered && dependencies.isPhotoshop(request.blob, request.name)) {
    psdImport = await dependencies.decodePhotoshop(request.blob, request.signal);
  }
  if (canceled(request)) return null;

  const imageBlob = psdImport?.preview ?? layered?.preview ?? request.blob;
  const semanticPsd = psdImport
    ? dependencies.importPhotoshop(psdImport, request.name)
    : null;
  if (!dependencies.supportsImage(imageBlob, request.name, request.decodeMode)) {
    throw new Error(request.decodeMode === 'preserve-precision'
      ? 'Precision-preserving import currently supports PNG, TIFF, JPEG, and WebP.'
      : 'LightTable supports JPEG, PNG, WebP, PSD, and layered LightTable images.');
  }

  const decodeStartedAt = dependencies.now();
  const loadedMetadata = await request.renderer.loadImage(imageBlob, request.name, {
    decodeMode: psdImport ? 'fast' : request.decodeMode,
    signal: request.signal
  });
  const metadata: LightTableImageMetadata = psdImport
    ? {
        ...loadedMetadata,
        decoder: 'ag-psd',
        sourceBitDepth: psdImport.bitsPerChannel,
        sourceFormat: 'PSD',
        sourceInterpretation: psdImport.colorMode
      }
    : loadedMetadata;
  const decodeAndUploadMs = dependencies.now() - decodeStartedAt;
  if (canceled(request)) return null;

  const documentStartedAt = dependencies.now();
  const document = layered?.document ?? semanticPsd?.document ?? createImageDocument(
    request.name,
    metadata.width,
    metadata.height,
    request.cacheKey,
    {
      decoder: metadata.decoder ?? 'browser',
      sourceBitDepth: metadata.sourceBitDepth ?? null,
      sourceFormat: metadata.sourceFormat ?? null,
      sourceInterpretation: metadata.sourceInterpretation ?? null,
      sourceProfile: metadata.sourceProfile ?? null,
      normalizedColorSpace: 'linear-srgb'
    }
  );
  if (document.width !== metadata.width || document.height !== metadata.height) {
    throw new Error('The layered LightTable preview does not match its document dimensions.');
  }

  request.renderer.setDocument(document);
  if (layered) {
    await request.renderer.loadLayerAssets([...layered.assets, ...layered.patternAssets]);
  }
  if (semanticPsd) await request.renderer.loadLayerAssets(semanticPsd.assets);
  const documentInitMs = dependencies.now() - documentStartedAt;
  if (canceled(request)) return null;

  return {
    document,
    metadata,
    imageBlob,
    layeredAdjustmentStack: layered?.adjustmentStack ?? null,
    psdImport,
    psdWarnings: semanticPsd?.warnings ?? [],
    psdCompatibility:
      semanticPsd?.compatibility
      ?? document.photoshopImportReport?.compatibility
      ?? [],
    timings: {
      layeredProbeMs,
      decodeAndUploadMs,
      documentInitMs
    }
  };
};
