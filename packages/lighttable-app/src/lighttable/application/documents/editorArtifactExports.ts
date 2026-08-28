import type { ImageDocument } from '../../editor/document/documentTypes';
import type { DocumentRendererPort } from '../../infrastructure/rendering/webGpuDocumentRenderer';
import type { DocumentPixelRegion } from '../../editor/geometry/documentRegionPreview';
import { exportPsdDocument, type ExportedPsdDocument } from './PsdExportClient';
import type { RendererBindingToken } from '../rendering/rendererBindingToken';
import type { LightTablePreviewEncoding } from '../commands/lightTableCommandContract';

const exportFileName = (sourceName: string, suffix: string): string =>
  `${sourceName.replace(/\.[^.]+$/, '') || 'image'}-${suffix}`;

export const exportEditorPngArtifact = async (
  renderer: DocumentRendererPort | null,
  document: ImageDocument | null,
  sourceName: string,
  binding?: RendererBindingToken<DocumentRendererPort>
): Promise<File> => {
  if (!renderer || !document) throw new Error('The document renderer is not ready.');
  renderer.synchronizeDocumentForExport(document);
  const pixels = await renderer.exportPng();
  binding?.assertCurrent('PNG export');
  return new File(
    [pixels],
    exportFileName(sourceName, 'lighttable.png'),
    { type: 'image/png' }
  );
};

export const exportEditorPreviewArtifact = async (
  renderer: DocumentRendererPort | null,
  document: ImageDocument | null,
  sourceName: string,
  maxEdge: number,
  encoding: LightTablePreviewEncoding = { format: 'png' },
  region?: DocumentPixelRegion,
  binding?: RendererBindingToken<DocumentRendererPort>
): Promise<File> => {
  if (!renderer || !document) throw new Error('The document renderer is not ready.');
  renderer.synchronizeDocumentForExport(document);
  const pixels = await (region
    ? renderer.exportRegionThumbnailImage(region, maxEdge, encoding)
    : renderer.exportThumbnailImage(maxEdge, encoding));
  binding?.assertCurrent('Preview export');
  const extension = encoding.format;
  return new File(
    [pixels],
    exportFileName(sourceName, `${region ? 'region-' : ''}preview-${maxEdge}.${extension}`),
    { type: encoding.format === 'webp' ? 'image/webp' : 'image/png' }
  );
};

export const exportEditorPsdArtifact = async (
  renderer: DocumentRendererPort | null,
  document: ImageDocument | null,
  sourceName: string,
  binding?: RendererBindingToken<DocumentRendererPort>,
  signal?: AbortSignal
): Promise<ExportedPsdDocument> => {
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('PSD export was canceled.', 'AbortError');
  };
  throwIfAborted();
  if (!renderer || !document) throw new Error('The document renderer is not ready.');
  // Automation may request an export in the same event turn as a committed
  // document transaction. Cross that state into the renderer explicitly;
  // waiting on an older renderer generation can otherwise report readiness
  // while omitting newly-authored semantic layers.
  renderer.synchronizeDocumentForExport(document);
  if (!await renderer.waitForTextSourcesForExport()) {
    throw new Error('Text sources changed or could not be prepared for PSD export.');
  }
  throwIfAborted();
  binding?.assertCurrent('PSD export');
  // Final-output text preparation and interactive-quality settlement mutate
  // renderer caches. Keep PSD layer readback behind the authoritative
  // composite so both observe one stable generation rather than racing.
  const composite = await renderer.exportPng();
  throwIfAborted();
  binding?.assertCurrent('PSD export');
  if (!await renderer.waitForTextSourcesForExport()) {
    throw new Error('Exact text sources could not be retained for PSD layer export.');
  }
  const assets = await renderer.exportPsdLayerAssets(document);
  throwIfAborted();
  binding?.assertCurrent('PSD export');
  return exportPsdDocument(
    document,
    composite,
    assets.filter((asset) => 'layerId' in asset),
    assets.filter((asset) => 'lutId' in asset),
    sourceName,
    'editable',
    signal
  );
};
