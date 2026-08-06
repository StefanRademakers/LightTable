import type { ImageDocument } from '../../editor/document/documentTypes';
import type { DocumentRendererPort } from '../../infrastructure/rendering/webGpuDocumentRenderer';
import { exportPsdDocument } from './PsdExportClient';

const exportFileName = (sourceName: string, suffix: string): string =>
  `${sourceName.replace(/\.[^.]+$/, '') || 'image'}-${suffix}`;

export const exportEditorPngArtifact = async (
  renderer: DocumentRendererPort | null,
  document: ImageDocument | null,
  sourceName: string
): Promise<File> => {
  if (!renderer || !document) throw new Error('The document renderer is not ready.');
  renderer.synchronizeDocumentForExport(document);
  return new File(
    [await renderer.exportPng()],
    exportFileName(sourceName, 'lighttable.png'),
    { type: 'image/png' }
  );
};

export const exportEditorPsdArtifact = async (
  renderer: DocumentRendererPort | null,
  document: ImageDocument | null,
  sourceName: string
): Promise<File> => {
  if (!renderer || !document) throw new Error('The document renderer is not ready.');
  // Automation may request an export in the same event turn as a committed
  // document transaction. Cross that state into the renderer explicitly;
  // waiting on an older renderer generation can otherwise report readiness
  // while omitting newly-authored semantic layers.
  renderer.synchronizeDocumentForExport(document);
  if (!await renderer.waitForTextSourcesForExport()) {
    throw new Error('Text sources changed or could not be prepared for PSD export.');
  }
  // Final-output text preparation and interactive-quality settlement mutate
  // renderer caches. Keep PSD layer readback behind the authoritative
  // composite so both observe one stable generation rather than racing.
  const composite = await renderer.exportPng();
  if (!await renderer.waitForTextSourcesForExport()) {
    throw new Error('Exact text sources could not be retained for PSD layer export.');
  }
  const assets = await renderer.exportPsdLayerAssets(document);
  return (await exportPsdDocument(
    document,
    composite,
    assets.filter((asset) => 'layerId' in asset),
    sourceName
  )).file;
};
