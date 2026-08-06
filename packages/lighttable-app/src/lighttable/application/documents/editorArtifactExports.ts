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
  const [composite, assets] = await Promise.all([
    renderer.exportPng(),
    renderer.exportPsdLayerAssets(document)
  ]);
  return (await exportPsdDocument(
    document,
    composite,
    assets.filter((asset) => 'layerId' in asset),
    sourceName
  )).file;
};
