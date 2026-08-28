import { useCallback, useRef, type RefObject } from 'react';
import type { LayerId } from '../../editor/document/documentTypes';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { walkLayerTree } from '../../editor/document/layerTree';
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

/** Owns lazy revision-bound caches per layer; no work occurs before a request. */
export const useLayerPalette = (
  rendererRef: RefObject<DocumentRendererPort | null>,
  documentRef: RefObject<ImageDocument | null>
) => {
  const extractorsRef = useRef(new Map<LayerId, DocumentPaletteExtractor>());
  const prunedRevisionRef = useRef<number | null>(null);
  return useCallback(async (layerId: LayerId, colorCount: number) => {
    const openingDocument = documentRef.current;
    if (!openingDocument) throw new Error('The document is not ready.');
    if (prunedRevisionRef.current !== openingDocument.revision) {
      const currentLayerIds = new Set(walkLayerTree(openingDocument.layers).map(({ node }) => node.id));
      for (const [cachedLayerId, extractor] of extractorsRef.current) {
        if (currentLayerIds.has(cachedLayerId)) continue;
        extractor.clear();
        extractorsRef.current.delete(cachedLayerId);
      }
      prunedRevisionRef.current = openingDocument.revision;
    }
    let extractor = extractorsRef.current.get(layerId);
    if (!extractor) {
      extractor = new DocumentPaletteExtractor(async () => {
        const renderer = rendererRef.current;
        const document = documentRef.current;
        if (!renderer || !document) throw new Error('The document renderer is not ready.');
        return renderer.exportLayerPaletteSamples(document, layerId);
      });
      extractorsRef.current.set(layerId, extractor);
    }
    const openingRevision = openingDocument.revision;
    const result = await extractor.getPalette(openingRevision, colorCount);
    if (documentRef.current?.revision !== openingRevision) {
      throw new Error('The document changed while its layer palette was sampled.');
    }
    return result;
  }, [documentRef, rendererRef]);
};
