import type { RealizedTextLayout } from '@lighttable/text-core';
import type { LayerId } from '../../editor/document/documentTypes';
import type { PdfExportPreflightRequest } from '../../editor/pdf/PdfExportPreflightDialog';
import type { DocumentRendererPort } from '../../infrastructure/rendering/webGpuDocumentRenderer';
import type { DocumentFontRegistry } from '../../text/fonts/DocumentFontRegistry';
import type { DocumentSession } from '../documents/documentSession';
import { buildPdfTextExportPreflight } from './pdfTextExportPreflight';
import { buildPdfNativeTextPage } from './buildPdfNativeTextPage';
import { buildPdfNativeVectorLayerPage, buildPdfNativeVectorExportPage } from './buildPdfNativeVectorPage';
import { pdfDocumentProcessingActive, planHybridPdfPageExport } from './planHybridPdfPageExport';
import { planHybridPdfVectorPageExport } from './planHybridPdfVectorPageExport';
import { planHybridPdfNativePageExport } from './planHybridPdfNativePageExport';
import { hybridPdfReasonLabel, hybridPdfVectorReasonLabel, hybridPdfNativeReasonLabel } from './pdfExportReasonLabels';
import type { PdfExportServices } from './PdfExportServices';

export interface PdfExportPreflightSource {
  readonly session: DocumentSession;
  readonly renderer: Pick<DocumentRendererPort, 'exportPng' | 'textEditingLayout'>;
  readonly fonts: Pick<DocumentFontRegistry, 'availableAssets' | 'bytes'>;
  readonly fileName: string;
  /** Exact opening session, renderer/lifecycle generation, font registry and dialog intent. */
  isCurrent(): boolean;
  /** Reuses the existing file prerequisite owner, outside the semantic command queue. */
  prepareExport(): Promise<void>;
  deliver(file: File): Promise<void>;
}

const retired = () => new DOMException('The PDF export document was retired.', 'AbortError');

/** One immutable preflight source. No document mutation, history or renderer ownership. */
export const createPdfExportPreflightSession = (
  source: PdfExportPreflightSource, services: PdfExportServices
): PdfExportPreflightRequest => {
  if (!source.isCurrent()) throw retired();
  const opening = source.session.getSnapshot();
  const document = opening.document;
  if (!document) throw new Error('LightTable is not ready yet.');
  const fonts = Object.freeze([...source.fonts.availableAssets]);
  // This is a conservative artifact invalidation stamp, never a rendered-frame proof.
  const assertCurrent = () => {
    if (!source.isCurrent()) throw retired();
    const current = source.session.getSnapshot();
    if (current.documentRevision !== opening.documentRevision || current.document !== document) {
      throw new Error('The document changed after PDF preflight. Open preflight again.');
    }
    const currentFonts = source.fonts.availableAssets;
    // Lazy system-font byte caching preserves these metadata identities. A registry
    // reset or changed resolution source does not, even if its asset IDs are equal.
    if (currentFonts.length !== fonts.length || fonts.some((font, index) => currentFonts[index] !== font)) {
      throw new Error('The fonts changed after PDF preflight. Open preflight again.');
    }
  };
  const layouts = new Map<LayerId, RealizedTextLayout | null>();
  const plan = buildPdfTextExportPreflight({ document, availableFonts: fonts,
    fontBytesAvailable: new Set(fonts.map(font => font.assetId)), realizedLayout: layerId => {
      const layout = source.renderer.textEditingLayout(layerId)?.layout ?? null;
      layouts.set(layerId, layout);
      return layout;
    } });
  const processingActive = pdfDocumentProcessingActive(opening.processing.adjustments);
  const hybridPlan = planHybridPdfPageExport({ document, textPlan: plan, documentProcessingActive: processingActive });
  const vectorPlan = planHybridPdfVectorPageExport(document, processingActive);
  const nativePlan = planHybridPdfNativePageExport({ document, textPlan: plan, documentProcessingActive: processingActive });
  const run = async <T>(operation: () => Promise<T>, prepare = true): Promise<T> => {
    try {
      assertCurrent();
      if (prepare) await source.prepareExport();
      assertCurrent();
      return await operation();
    } catch (error) {
      // Retired requests are cancellation, but current failures stay visible in the dialog.
      if (!source.isCurrent()) throw retired();
      throw error;
    }
  };
  const stage = async <T>(operation: () => Promise<T>): Promise<T> => {
    assertCurrent();
    const result = await operation();
    assertCurrent();
    return result;
  };
  const materializeFonts = () => stage(() => services.materializeFonts(plan, {
    fonts, loadFontBytes: assetId => stage(() => source.fonts.bytes(assetId))
  }));
  const raster = (excludedLayerIds: readonly LayerId[] = []) =>
    stage(() => source.renderer.exportPng({ excludedLayerIds }));
  const deliver = async (blob: Blob, suffix: string) => {
    assertCurrent();
    await source.deliver(new File([blob], `${source.fileName.replace(/\.pdf$/i, '')}${suffix}.pdf`,
      { type: 'application/pdf' }));
    assertCurrent();
  };
  const textPage = (nativeTextLayerIds: ReadonlySet<LayerId>) => buildPdfNativeTextPage({
    document, plan, nativeTextLayerIds, pixelsPerInch: 300,
    realizedLayout: layerId => layouts.get(layerId) ?? null
  });
  assertCurrent();
  return Object.freeze({
    plan,
    fontLabels: Object.freeze(Object.fromEntries(fonts.map(font => [font.assetId,
      `${font.familyNames[0] ?? font.postScriptName ?? font.assetId} ${font.styleName}`.trim()]))),
    validateFonts: plan.fonts.length > 0 ? () => run(async () => {
      const resources = await materializeFonts();
      return { embeddedFontCount: resources.embedded.length, totalEmbeddedBytes: resources.totalEmbeddedBytes };
    }, false) : undefined,
    exportNativeTextPage: hybridPlan.kind === 'ready' ? () => run(async () => {
      const resources = await materializeFonts();
      const page = textPage(hybridPlan.nativeTextLayerIds);
      const rasterUnderlayPng = await raster([...hybridPlan.nativeTextLayerIds]);
      const result = await stage(() => services.writeText({ page, fonts: resources.embedded,
        title: document.name, rasterUnderlayPng }));
      await deliver(result.blob, '-native');
      return { byteLength: result.blob.size,
        searchableLayerCount: plan.layers.filter(layer => layer.disposition === 'text').length };
    }) : undefined,
    nativeTextUnavailableReason: plan.layers.length > 0 && hybridPlan.kind === 'flattened-only'
      ? hybridPlan.reasons.map(reason => hybridPdfReasonLabel[reason]).join('; ') : undefined,
    nativeVectorLayerCount: vectorPlan.kind === 'ready' ? vectorPlan.nativeVectorLayerIds.size : 0,
    exportNativeVectorPage: vectorPlan.kind === 'ready' ? () => run(async () => {
      const nativeExport = buildPdfNativeVectorExportPage({ document,
        nativeVectorLayerIds: vectorPlan.nativeVectorLayerIds, transparencyGroups: vectorPlan.transparencyGroups,
        clippingPairs: vectorPlan.clippingPairs, pixelsPerInch: 300 });
      const rasterUnderlayPng = await raster([...vectorPlan.nativeVectorLayerIds]);
      const result = await stage(() => services.writeVector({ page: nativeExport.page, title: document.name,
        rasterUnderlayPng, transparencyGroups: nativeExport.transparencyGroups }));
      await deliver(result.blob, '-vectors');
      return { byteLength: result.blob.size, vectorLayerCount: vectorPlan.nativeVectorLayerIds.size };
    }) : undefined,
    nativeVectorUnavailableReason: vectorPlan.kind === 'flattened-only'
      && !vectorPlan.reasons.includes('no-native-vectors')
      ? vectorPlan.reasons.map(reason => hybridPdfVectorReasonLabel[reason]).join('; ') : undefined,
    nativeMixedLayerCount: nativePlan.kind === 'ready' ? nativePlan.nativeLayerOrder.length : 0,
    exportNativeMixedPage: nativePlan.kind === 'ready'
      && nativePlan.nativeTextLayerIds.size > 0 && nativePlan.nativeVectorLayerIds.size > 0 ? () => run(async () => {
        const resources = await materializeFonts();
        const page = textPage(nativePlan.nativeTextLayerIds);
        const nativeVectorPage = buildPdfNativeVectorLayerPage({ document,
          nativeVectorLayerIds: nativePlan.nativeVectorLayerIds, pixelsPerInch: 300 });
        const rasterUnderlayPng = await raster([...nativePlan.nativeTextLayerIds, ...nativePlan.nativeVectorLayerIds]);
        const result = await stage(() => services.writeText({ page, fonts: resources.embedded,
          title: document.name, rasterUnderlayPng, vectorLayers: nativeVectorPage.layers,
          nativeLayerOrder: nativePlan.nativeLayerOrder }));
        await deliver(result.blob, '-native-mixed');
        return { byteLength: result.blob.size, searchableLayerCount: nativePlan.nativeTextLayerIds.size,
          vectorLayerCount: nativePlan.nativeVectorLayerIds.size };
      }) : undefined,
    nativeMixedUnavailableReason: nativePlan.kind === 'flattened-only'
      && plan.layers.length > 0 && vectorPlan.kind === 'ready'
      ? nativePlan.reasons.map(reason => hybridPdfNativeReasonLabel[reason]).join('; ') : undefined,
    exportFlattenedPage: () => run(async () => {
      const png = await raster();
      const result = await stage(() => services.writeRaster({ png, widthPixels: document.width,
        heightPixels: document.height, pixelsPerInch: 300, title: document.name }));
      await deliver(result.blob, '');
      return { byteLength: result.blob.size };
    })
  });
};
