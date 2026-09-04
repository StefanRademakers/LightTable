import { decodeNativeImage } from '../../image-io/NativeImageDecoder';
import type { AdvancedDecodedImage, NativeDecodedImage } from '../../image-io/types';
import type { PsdDecodeSuccess } from '../../image-io/psdProtocol';
import type { PdfRasterPreview } from '../../image-io/PdfRasterDecoder';
import {
  importPsdDocument,
  type PsdDocumentImport
} from '../../editor/psd/psdDocumentAdapter';
import {
  parseLayeredDocumentFile,
  type ParsedLayeredDocument
} from '../../editor/persistence/layeredDocumentFormat';
import {
  probeDocumentSource,
  type DocumentOpenMode,
  type DocumentSourceProbe
} from './documentSourceProbe';
import type { DocumentStartupTimeline } from '../telemetry/documentStartupTimeline';

export interface PreparedDocumentOpenTimings {
  readonly probeMs: number;
  readonly sourceDecodeMs: number;
}

/**
 * Renderer-independent half of opening a document.
 *
 * This object owns decoded CPU resources until the renderer consumes them.
 * `dispose` is deliberately idempotent so cancellation can remain centralized
 * in the document-open controller without knowing which codec was selected.
 */
export interface PreparedDocumentOpenSource {
  readonly blob: Blob;
  readonly probe: DocumentSourceProbe;
  readonly layered: ParsedLayeredDocument | null;
  readonly photoshopDecode: PsdDecodeSuccess | null;
  readonly photoshopImport: PsdDocumentImport | null;
  readonly pdfPreview: PdfRasterPreview | null;
  readonly timings: PreparedDocumentOpenTimings;
  consumeNativeImage(): NativeDecodedImage | null;
  consumeAdvancedImage(): AdvancedDecodedImage | null;
  dispose(): void;
}

export interface PrepareDocumentOpenSourceRequest {
  readonly blob: Blob;
  readonly name: string;
  readonly decodeMode: DocumentOpenMode;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly startupTimeline?: DocumentStartupTimeline | null;
}

const abortError = () => new DOMException('The image load was cancelled.', 'AbortError');

const assertActive = (signal: AbortSignal | undefined) => {
  if (signal?.aborted) throw abortError();
};

/**
 * Probes and prepares only work that does not require a GPU device.
 *
 * Ordinary browser-native bitmaps are decoded here; PSD/PDF/native LightTable
 * parsing also happens here. SVG intentionally remains in loadDocumentSource
 * because its isolated transient preview is coupled to the presentation
 * renderer and must not regress while this boundary is extracted.
 */
export const prepareDocumentOpenSource = async ({
  blob,
  name,
  decodeMode,
  signal,
  now = () => performance.now(),
  startupTimeline
}: PrepareDocumentOpenSourceRequest): Promise<PreparedDocumentOpenSource> => {
  assertActive(signal);
  startupTimeline?.mark('source-probe-begin');
  const probeStartedAt = now();
  const probe = await probeDocumentSource(blob, decodeMode);
  const probeMs = now() - probeStartedAt;
  startupTimeline?.mark('source-probe-end', { codec: probe.codec });
  assertActive(signal);

  if (probe.codec === 'unsupported') {
    throw new Error(
      'This file signature is not supported. LightTable currently opens '
      + 'layered LightTable documents, SVG, PSD/PSB, PDF, PNG, JPEG, WebP, and TIFF.'
    );
  }

  let nativeImage: NativeDecodedImage | null = null;
  let advancedImage: AdvancedDecodedImage | null = null;
  let layered: ParsedLayeredDocument | null = null;
  let photoshopDecode: PsdDecodeSuccess | null = null;
  let photoshopImport: PsdDocumentImport | null = null;
  let pdfPreview: PdfRasterPreview | null = null;
  startupTimeline?.mark('source-decode-begin', { codec: probe.codec });
  const decodeStartedAt = now();

  try {
    switch (probe.codec) {
      case 'browser-native':
        break;
      case 'lighttable':
        layered = await parseLayeredDocumentFile(blob);
        if (!layered) throw new Error('The LightTable document footer or manifest is invalid.');
        break;
      case 'photoshop': {
        const { PsdDecoder } = await import('../../image-io/PsdDecoder');
        const decoder = new PsdDecoder();
        try {
          photoshopDecode = await decoder.decode(blob, signal);
        } finally {
          decoder.destroy();
        }
        photoshopImport = importPsdDocument(photoshopDecode, name);
        break;
      }
      case 'pdf-raster': {
        const { decodePdfRasterPreview } = await import('../../image-io/PdfRasterDecoder');
        pdfPreview = await decodePdfRasterPreview(blob, signal);
        break;
      }
      case 'wasm-vips': {
        const { WasmVipsDecoder } = await import('../../image-io/WasmVipsDecoder');
        const decoder = new WasmVipsDecoder();
        try {
          advancedImage = await decoder.decode(blob, signal);
        } finally {
          decoder.destroy();
        }
        break;
      }
      default:
        // SVG needs its renderer-coupled transient preview. Precision raster
        // decoding remains owned by the GPU source loader for now.
        break;
    }
    const previewBlob = photoshopDecode?.preview
      ?? pdfPreview?.preview
      ?? (layered?.previewKind === 'placeholder' ? null : layered?.preview)
      ?? (probe.codec === 'browser-native' ? blob : null);
    if (previewBlob) nativeImage = await decodeNativeImage(previewBlob);
    assertActive(signal);
    startupTimeline?.mark('source-decode-end', { codec: probe.codec });
  } catch (reason) {
    nativeImage?.close();
    throw reason;
  }

  let disposed = false;
  return {
    blob,
    probe,
    layered,
    photoshopDecode,
    photoshopImport,
    pdfPreview,
    timings: {
      probeMs,
      sourceDecodeMs: now() - decodeStartedAt
    },
    consumeNativeImage: () => {
      if (disposed) return null;
      const decoded = nativeImage;
      nativeImage = null;
      return decoded;
    },
    consumeAdvancedImage: () => {
      if (disposed) return null;
      const decoded = advancedImage;
      advancedImage = null;
      return decoded;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      nativeImage?.close();
      nativeImage = null;
      advancedImage = null;
    }
  };
};
