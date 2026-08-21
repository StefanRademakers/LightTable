import { useCallback, useRef, type RefObject } from 'react';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type { DocumentRendererPort } from '../../infrastructure/rendering/webGpuDocumentRenderer';
import { DocumentPaletteExtractor } from './documentPalette';

/** Owns one lazy, revision-bound palette cache for a mounted editor document. */
export const useDocumentPalette = (
  rendererRef: RefObject<DocumentRendererPort | null>,
  documentRef: RefObject<ImageDocument | null>
) => {
  const extractorRef = useRef<DocumentPaletteExtractor | null>(null);
  extractorRef.current ??= new DocumentPaletteExtractor(async () => {
    const renderer = rendererRef.current;
    if (!renderer) throw new Error('The document renderer is not ready.');
    return renderer.exportPaletteSamples();
  });
  return useCallback(async (colorCount: number) => {
    const openingRevision = documentRef.current?.revision;
    if (openingRevision === undefined) throw new Error('The document is not ready.');
    const result = await extractorRef.current!.getPalette(openingRevision, colorCount);
    if (documentRef.current?.revision !== openingRevision) {
      throw new Error('The document changed while its palette was sampled.');
    }
    return result;
  }, [documentRef]);
};
