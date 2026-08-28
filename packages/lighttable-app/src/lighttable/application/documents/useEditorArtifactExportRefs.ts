import { useRef } from 'react';
import type { LightTableBitmapExportFormat } from '../commands/lightTableCommandContract';
import type { DocumentPixelRegion } from '../../editor/geometry/documentRegionPreview';
import type { ExportedPsdDocument } from './PsdExportClient';
import type { LightTablePreviewEncoding } from '../commands/lightTableCommandContract';

/** Stable late-bound export ports shared by command registration and file UI. */
export const useEditorArtifactExportRefs = () => ({
  exportNativeArtifactRef: useRef<() => Promise<File>>(async () => {
    throw new Error('The native export controller is not ready.');
  }),
  exportPngArtifactRef: useRef<() => Promise<File>>(async () => {
    throw new Error('The PNG export controller is not ready.');
  }),
  exportBitmapArtifactRef: useRef<(format: LightTableBitmapExportFormat) => Promise<File>>(async () => {
    throw new Error('The bitmap export controller is not ready.');
  }),
  exportPreviewArtifactRef: useRef<(maxEdge: number, encoding: LightTablePreviewEncoding,
    region?: DocumentPixelRegion) => Promise<File>>(async () => {
    throw new Error('The preview export controller is not ready.');
  }),
  exportPsdArtifactRef: useRef<(signal?: AbortSignal) => Promise<ExportedPsdDocument>>(async () => {
    throw new Error('The PSD export controller is not ready.');
  })
});
