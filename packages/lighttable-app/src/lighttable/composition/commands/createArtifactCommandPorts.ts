import type { ImageDocument } from '../../editor/document/documentTypes';
import type { DocumentRendererPort } from '../../infrastructure/rendering/webGpuDocumentRenderer';
import { exportSvgDocument } from '../../application/vectors/svgDocumentCodec';
import type { DocumentLightTableCommandPorts } from '../../application/commands/lightTableCommandContract';

type ArtifactCommandPorts = Pick<DocumentLightTableCommandPorts,
  'exportNativeArtifact' | 'exportPngArtifact' | 'exportBitmapArtifact'
  | 'exportPreviewArtifact' | 'getDocumentPalette' | 'getLayerPalette'
  | 'exportLayerPreviewArtifact' | 'exportPsdArtifact' | 'exportSvgArtifact'>;

/** Host/render artifact adapters; no canonical mutation or artifact retention. */
export const createArtifactCommandPorts = ({
  getRenderer,
  getDocument,
  fileName,
  exportNativeArtifact,
  exportPngArtifact,
  exportBitmapArtifact,
  exportPreviewArtifact,
  getDocumentPalette,
  getLayerPalette,
  exportPsdArtifact
}: {
  readonly getRenderer: () => DocumentRendererPort | null;
  readonly getDocument: () => ImageDocument | null;
  readonly fileName: string;
  readonly exportNativeArtifact: ArtifactCommandPorts['exportNativeArtifact'];
  readonly exportPngArtifact: ArtifactCommandPorts['exportPngArtifact'];
  readonly exportBitmapArtifact: ArtifactCommandPorts['exportBitmapArtifact'];
  readonly exportPreviewArtifact: ArtifactCommandPorts['exportPreviewArtifact'];
  readonly getDocumentPalette: NonNullable<ArtifactCommandPorts['getDocumentPalette']>;
  readonly getLayerPalette: NonNullable<ArtifactCommandPorts['getLayerPalette']>;
  readonly exportPsdArtifact: ArtifactCommandPorts['exportPsdArtifact'];
}): ArtifactCommandPorts => ({
  exportNativeArtifact,
  exportPngArtifact,
  exportBitmapArtifact,
  exportPreviewArtifact,
  getDocumentPalette,
  getLayerPalette,
  exportLayerPreviewArtifact: async (layerId, channel, maxEdge, encoding) => {
    const preview = await getRenderer()?.exportLayerThumbnail(
      layerId,
      channel === 'mask',
      maxEdge,
      maxEdge,
      encoding
    );
    if (!preview) throw new Error(`Layer ${layerId} has no renderable ${channel} content.`);
    const mediaType = encoding.format === 'webp' ? 'image/webp' : 'image/png';
    return {
      file: new File([preview.blob], `layer-${channel}.${encoding.format}`, { type: mediaType }),
      width: preview.width,
      height: preview.height,
      sourceToOutput: preview.sourceToOutput
    };
  },
  exportPsdArtifact,
  exportSvgArtifact: () => {
    const document = getDocument();
    if (!document) throw new Error('The SVG export document is unavailable.');
    return exportSvgDocument(document, fileName);
  }
});
