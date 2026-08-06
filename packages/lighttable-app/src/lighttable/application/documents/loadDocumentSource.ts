import {
  adjustmentStackForScope,
  createAdjustmentStackFromBasicAdjustments,
  materializeBasicAdjustments,
  type AdjustmentStack
} from '../../processing/adjustmentStack';
import {
  createImageDocument,
  type DocumentAssetId,
  type DocumentCreationSettings,
  type ImageDocument
} from '../../editor/document/documentTypes';
import { setRasterLayerAdjustmentStack } from '../../editor/document/documentCommands';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  parseLayeredDocumentFile,
  type DocumentAssetBlob,
  type FontAssetBlob,
  type PreservedSourceAssetBlob,
  type ParsedLayeredDocument
} from '../../editor/persistence/layeredDocumentFormat';
import {
  importPsdDocument,
  type PsdDocumentImport,
  type PsdImportCompatibilityEntry
} from '../../editor/psd/psdDocumentAdapter';
import type { PsdDecodeSuccess } from '../../image-io/psdProtocol';
import type { PdfRasterPreview } from '../../image-io/PdfRasterDecoder';
import {
  createDefaultAdjustments,
  type BasicAdjustments,
  type LightTableImageMetadata
} from '../../types';
import type {
  LightTableImageDecodeMode,
  LightTableLoadImageOptions
} from '../rendering/rendererTypes';
import {
  probeDocumentSource,
  type DocumentOpenMode,
  type DocumentSourceProbe
} from './documentSourceProbe';

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
  readonly sourceDecodeMs: number;
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
  readonly fontAssets: readonly FontAssetBlob[];
  readonly preservedSourceAssets: readonly PreservedSourceAssetBlob[];
  readonly timings: DocumentSourceLoadTimings;
}

interface DocumentSourceLoaderDependencies {
  parseLayered(blob: Blob): Promise<ParsedLayeredDocument | null>;
  probe(blob: Blob, requestedMode: DocumentOpenMode): Promise<DocumentSourceProbe>;
  decodePhotoshop(blob: Blob, signal?: AbortSignal): Promise<PsdDecodeSuccess>;
  decodePdfPreview(blob: Blob, signal?: AbortSignal): Promise<PdfRasterPreview>;
  importPhotoshop(decoded: PsdDecodeSuccess, name: string): PsdDocumentImport;
  now(): number;
}

const defaultDependencies: DocumentSourceLoaderDependencies = {
  parseLayered: parseLayeredDocumentFile,
  probe: probeDocumentSource,
  decodePhotoshop: async (blob, signal) => {
    const { PsdDecoder } = await import('../../image-io/PsdDecoder');
    const decoder = new PsdDecoder();
    try {
      return await decoder.decode(blob, signal);
    } finally {
      decoder.destroy();
    }
  },
  decodePdfPreview: async (blob, signal) => {
    const { decodePdfRasterPreview } = await import('../../image-io/PdfRasterDecoder');
    return decodePdfRasterPreview(blob, signal);
  },
  importPhotoshop: importPsdDocument,
  now: () => performance.now()
};

export interface LoadDocumentSourceRequest {
  readonly renderer: DocumentSourceRenderer;
  readonly blob: Blob;
  readonly name: string;
  readonly cacheKey: string;
  readonly decodeMode: DocumentOpenMode;
  /**
   * A flat LightTable recipe belongs to the imported raster, never to an
   * implicit document-wide creative grade.
   */
  readonly initialAdjustments: BasicAdjustments;
  readonly creationSettings?: DocumentCreationSettings;
  readonly signal?: AbortSignal;
  readonly isCanceled?: () => boolean;
  /** Test seam; production callers use the default import adapters. */
  readonly dependencies?: Partial<DocumentSourceLoaderDependencies>;
}

const canceled = (request: LoadDocumentSourceRequest) =>
  request.signal?.aborted || request.isCanceled?.() === true;

const createInitialRasterGrade = (
  adjustments: BasicAdjustments
): AdjustmentStack | null => {
  const stack = adjustmentStackForScope(
    createAdjustmentStackFromBasicAdjustments(adjustments),
    'layer'
  );
  const defaults = materializeBasicAdjustments(
    adjustmentStackForScope(
      createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments()),
      'layer'
    ),
    undefined,
    'layer'
  );
  const current = materializeBasicAdjustments(stack, undefined, 'layer');
  return JSON.stringify(current) === JSON.stringify(defaults) ? null : stack;
};

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
  const sourceProbe = await dependencies.probe(
    request.blob,
    request.decodeMode
  );
  if (sourceProbe.codec === 'unsupported') {
    throw new Error(
      'This file signature is not supported. LightTable currently opens '
      + 'layered LightTable documents, PSD/PSB, PDF, PNG, JPEG, WebP, and TIFF.'
    );
  }
  const layered = sourceProbe.codec === 'lighttable'
    ? await dependencies.parseLayered(request.blob)
    : null;
  if (sourceProbe.codec === 'lighttable' && !layered) {
    throw new Error('The LightTable document footer or manifest is invalid.');
  }
  const layeredProbeMs = dependencies.now() - probeStartedAt;
  if (canceled(request)) return null;

  let psdImport: PsdDecodeSuccess | null = null;
  let pdfPreview: PdfRasterPreview | null = null;
  let sourceDecodeMs = 0;
  if (sourceProbe.codec === 'photoshop') {
    const sourceDecodeStartedAt = dependencies.now();
    psdImport = await dependencies.decodePhotoshop(request.blob, request.signal);
    sourceDecodeMs = dependencies.now() - sourceDecodeStartedAt;
  }
  if (sourceProbe.codec === 'pdf-raster') {
    const sourceDecodeStartedAt = dependencies.now();
    pdfPreview = await dependencies.decodePdfPreview(request.blob, request.signal);
    sourceDecodeMs = dependencies.now() - sourceDecodeStartedAt;
  }
  if (canceled(request)) return null;

  const imageBlob = psdImport?.preview ?? pdfPreview?.preview ?? layered?.preview ?? request.blob;
  const semanticPsd = psdImport
    ? dependencies.importPhotoshop(psdImport, request.name)
    : null;

  const decodeStartedAt = dependencies.now();
  const loadedMetadata = await request.renderer.loadImage(imageBlob, request.name, {
    decodeMode:
      psdImport || layered
        ? 'fast'
        : sourceProbe.decodeMode,
    signal: request.signal
  });
  const metadata: LightTableImageMetadata = psdImport
    ? {
        ...loadedMetadata,
        decoder: 'ag-psd',
        sourceBitDepth: psdImport.bitsPerChannel,
        sourceFormat: 'PSD',
        sourceInterpretation: psdImport.colorMode,
        sourceProfile: psdImport.colorProfile.disposition === 'embedded'
          ? 'embedded ICC -> sRGB'
          : 'no embedded ICC; assumed sRGB'
      }
    : pdfPreview
      ? {
          ...loadedMetadata,
          decoder: 'pdfjs',
          sourceBitDepth: 8,
          sourceFormat: 'PDF',
          sourceInterpretation:
            `Page ${pdfPreview.pageNumber} of ${pdfPreview.pageCount} at `
            + `${Math.round(pdfPreview.scalePixelsPerPoint * 72)} ppi preview`
        }
      : loadedMetadata;
  const decodeAndUploadMs = dependencies.now() - decodeStartedAt;
  if (canceled(request)) return null;

  const documentStartedAt = dependencies.now();
  let document = layered?.document ?? semanticPsd?.document ?? createImageDocument(
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
  if (request.creationSettings && !layered && !semanticPsd) {
    document = {
      ...document,
      resolutionPpi: request.creationSettings.resolutionPpi,
      colorSettings: {
        ...document.colorSettings,
        bitDepth: request.creationSettings.bitDepth,
        blendProfile: request.creationSettings.profile,
        profileState: 'assigned'
      }
    };
  }
  let pdfSourceId: DocumentAssetId | null = null;
  if (pdfPreview) {
    pdfSourceId = `pdf-source-${crypto.randomUUID()}` as DocumentAssetId;
    document = {
      ...document,
      assets: {
        ...document.assets,
        preservedSources: [
          ...document.assets.preservedSources,
          {
            id: pdfSourceId,
            kind: 'pdf-document',
            name: request.name,
            mediaType: 'application/pdf',
            byteLength: request.blob.size
          }
        ]
      }
    };
  }
  if (!layered && !semanticPsd) {
    const initialRasterGrade = createInitialRasterGrade(request.initialAdjustments);
    const background = findDocumentLayer(document, document.activeLayerId);
    if (initialRasterGrade && background?.type === 'raster') {
      document = setRasterLayerAdjustmentStack(
        document,
        background.id,
        initialRasterGrade
      );
    }
  }
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
    fontAssets: layered?.fontAssets ?? [],
    preservedSourceAssets: pdfSourceId
      ? [{ sourceId: pdfSourceId, source: request.blob }]
      : layered?.preservedSourceAssets ?? [],
    timings: {
      layeredProbeMs,
      sourceDecodeMs,
      decodeAndUploadMs,
      documentInitMs
    }
  };
};
