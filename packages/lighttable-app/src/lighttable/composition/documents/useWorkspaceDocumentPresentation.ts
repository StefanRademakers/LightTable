import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from 'react';
import type { DocumentRendererLifecycle } from '../../application/rendering/documentRendererLifecycle';
import type { DocumentRendererPort } from '../../infrastructure/rendering/webGpuDocumentRenderer';

interface WorkspaceDocumentPresentationOptions {
  readonly documentId: string;
  readonly active: boolean;
  readonly rendererGeneration: number;
  readonly rendererLifecycle: DocumentRendererLifecycle;
  readonly rendererRef: RefObject<DocumentRendererPort | null>;
  readonly publishThumbnail?: (thumbnail: Blob) => void;
}

export interface WorkspaceDocumentPresentation {
  readonly presentedDocumentId: string | null;
  publishCompositeRendered(): void;
  publishInitialThumbnail(renderer: DocumentRendererPort): Promise<void>;
}

/**
 * Owns the boundary between a retained GPU canvas and one workspace document.
 *
 * A renderer may be reused, so document id alone cannot prove ownership. Every
 * waiter and delayed thumbnail export is bound to the committed presentation
 * epoch, renderer object and renderer generation. Rebinding invalidates them in
 * a layout effect, before the browser can expose the retained canvas.
 */
export const useWorkspaceDocumentPresentation = ({
  documentId,
  active,
  rendererGeneration,
  rendererLifecycle,
  rendererRef,
  publishThumbnail
}: WorkspaceDocumentPresentationOptions): WorkspaceDocumentPresentation => {
  const [presentedDocumentId, setPresentedDocumentId] = useState<string | null>(null);
  const currentDocumentIdRef = useRef(documentId);
  currentDocumentIdRef.current = documentId;
  const activeRef = useRef(active);
  activeRef.current = active;
  const presentedDocumentIdRef = useRef<string | null>(null);
  const pendingPresentationRef = useRef<{
    readonly documentId: string;
    readonly epoch: number;
  } | null>(null);
  const presentationEpochRef = useRef(0);
  const thumbnailTimerRef = useRef<number | null>(null);
  const thumbnailGenerationRef = useRef(0);

  const publishInitialThumbnail = useCallback(async (renderer: DocumentRendererPort) => {
    if (!publishThumbnail) return;
    const generation = ++thumbnailGenerationRef.current;
    try {
      const thumbnail = await renderer.exportThumbnailPng(256);
      if (generation === thumbnailGenerationRef.current) publishThumbnail(thumbnail);
    } catch {
      // Thumbnail publication is best-effort and must never fail document open.
    }
  }, [publishThumbnail]);

  const waitForOwnedPresentation = useCallback(() => {
    const ownerDocumentId = documentId;
    const renderer = rendererRef.current;
    const ownerRendererGeneration = rendererLifecycle.getSnapshot().generation;
    const ownerEpoch = presentationEpochRef.current;
    if (renderer && presentedDocumentIdRef.current !== ownerDocumentId
      && (pendingPresentationRef.current?.documentId !== ownerDocumentId
        || pendingPresentationRef.current.epoch !== ownerEpoch)) {
      pendingPresentationRef.current = { documentId: ownerDocumentId, epoch: ownerEpoch };
      void renderer.waitForPresentation().then(() => {
        if (!activeRef.current
          || currentDocumentIdRef.current !== ownerDocumentId
          || presentationEpochRef.current !== ownerEpoch
          || rendererRef.current !== renderer
          || rendererLifecycle.getSnapshot().generation !== ownerRendererGeneration) return;
        presentedDocumentIdRef.current = ownerDocumentId;
        setPresentedDocumentId(ownerDocumentId);
      }, () => undefined).finally(() => {
        if (pendingPresentationRef.current?.documentId === ownerDocumentId
          && pendingPresentationRef.current.epoch === ownerEpoch) {
          pendingPresentationRef.current = null;
        }
      });
    }
  }, [documentId, rendererLifecycle, rendererRef]);

  const publishCompositeRendered = useCallback(() => {
    // This callback is captured by one renderer generation. The closure-owned
    // id prevents a late frame from document A claiming document B.
    waitForOwnedPresentation();
    const ownerDocumentId = documentId;
    const renderer = rendererRef.current;
    const ownerRendererGeneration = rendererLifecycle.getSnapshot().generation;
    const ownerEpoch = presentationEpochRef.current;
    if (!publishThumbnail) return;
    if (thumbnailTimerRef.current !== null) window.clearTimeout(thumbnailTimerRef.current);
    thumbnailTimerRef.current = window.setTimeout(() => {
      thumbnailTimerRef.current = null;
      if (!activeRef.current
        || currentDocumentIdRef.current !== ownerDocumentId
        || presentationEpochRef.current !== ownerEpoch
        || rendererRef.current !== renderer
        || rendererLifecycle.getSnapshot().generation !== ownerRendererGeneration
        || !renderer) return;
      void publishInitialThumbnail(renderer);
    }, 180);
  }, [documentId, publishInitialThumbnail, publishThumbnail, rendererLifecycle, rendererRef,
    waitForOwnedPresentation]);

  useLayoutEffect(() => {
    presentationEpochRef.current += 1;
    presentedDocumentIdRef.current = null;
    pendingPresentationRef.current = null;
    thumbnailGenerationRef.current += 1;
    if (thumbnailTimerRef.current !== null) {
      window.clearTimeout(thumbnailTimerRef.current);
      thumbnailTimerRef.current = null;
    }
    setPresentedDocumentId(null);
    // Resume can present an already-composited retained texture without
    // producing another document-composite callback. Register the exact-frame
    // waiter before the engine is reactivated so that display-only resume has
    // the same ownership gate as initial open and document rebind.
    if (active) waitForOwnedPresentation();
  }, [active, documentId, rendererGeneration, waitForOwnedPresentation]);

  useEffect(() => () => {
    thumbnailGenerationRef.current += 1;
    if (thumbnailTimerRef.current !== null) window.clearTimeout(thumbnailTimerRef.current);
  }, []);

  return { presentedDocumentId, publishCompositeRendered, publishInitialThumbnail };
};
