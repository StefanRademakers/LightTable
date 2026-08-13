import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageDocument, RasterLayer } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { RasterSelectionMask } from '../../editor/selection/selectionTypes';
import { Ben2BackgroundRemovalModel } from './Ben2BackgroundRemovalModel';
import type { BackgroundRemovalModel, BackgroundRemovalProgress } from './backgroundRemovalTypes';

export type BackgroundRemovalMaskMode = 'replace' | 'intersect' | 'new-layer';

export type BackgroundRemovalControllerState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'choose-mask-mode'; readonly layerName: string }
  | { readonly phase: 'running'; readonly progress: BackgroundRemovalProgress };

interface BackgroundRemovalRenderer {
  exportLayerForBackgroundRemoval(
    document: ImageDocument,
    layer: RasterLayer
  ): Promise<Blob>;
}

interface UseBackgroundRemovalControllerOptions {
  readonly getDocument: () => ImageDocument | null;
  readonly getRenderer: () => BackgroundRemovalRenderer | null;
  readonly applyMask: (mask: RasterSelectionMask, mode: BackgroundRemovalMaskMode) => boolean;
  readonly setStatus: (message: string) => void;
  readonly setError: (message: string) => void;
  readonly createModel?: () => BackgroundRemovalModel;
}

/**
 * Canonical application command for background removal. UI surfaces only
 * request this command; model choice, stale-result rejection and the single
 * editable-mask transaction stay behind this boundary.
 */
export const useBackgroundRemovalController = ({
  getDocument,
  getRenderer,
  applyMask,
  setStatus,
  setError,
  createModel = () => new Ben2BackgroundRemovalModel()
}: UseBackgroundRemovalControllerOptions) => {
  const [state, setState] = useState<BackgroundRemovalControllerState>({ phase: 'idle' });
  const modelRef = useRef<BackgroundRemovalModel | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const operationRef = useRef(0);

  const cancel = useCallback(() => {
    operationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ phase: 'idle' });
    setStatus('Background removal canceled.');
  }, [setStatus]);

  useEffect(() => () => {
    abortRef.current?.abort();
    modelRef.current?.dispose();
  }, []);

  const removeBackgroundFromActiveLayer = useCallback(async (mode: BackgroundRemovalMaskMode) => {
    const document = getDocument();
    const renderer = getRenderer();
    const layer = document ? findDocumentLayer(document, document.activeLayerId) : null;
    if (!document || !renderer || layer?.type !== 'raster') {
      setError('Remove Background requires an active raster layer.');
      return;
    }
    if (layer.locks.all || layer.locks.pixels) {
      setError('Unlock the active layer before removing its background.');
      return;
    }

    const operation = operationRef.current + 1;
    operationRef.current = operation;
    const source = { documentId: document.id, revision: document.revision, layerId: layer.id };
    const abort = new AbortController();
    abortRef.current?.abort();
    abortRef.current = abort;
    setState({ phase: 'running', progress: { phase: 'decode', message: 'Preparing active layer…' } });

    try {
      // Export is GPU-composited from the isolated active layer. It preserves
      // local adjustments while excluding surrounding layers and styles.
      const image = await renderer.exportLayerForBackgroundRemoval(document, layer);
      if (abort.signal.aborted || operation !== operationRef.current) return;
      const model = modelRef.current ?? (modelRef.current = createModel());
      const result = await model.remove(image, {
        signal: abort.signal,
        onProgress: (progress) => {
          if (operation !== operationRef.current) return;
          setState({ phase: 'running', progress });
        }
      });
      const current = getDocument();
      if (abort.signal.aborted || operation !== operationRef.current) return;
      if (!current || current.id !== source.documentId || current.revision !== source.revision
        || current.activeLayerId !== source.layerId) {
        setError('Background-removal result was discarded because the document changed.');
        return;
      }
      if (!applyMask(result.mask, mode)) return;
      setStatus(`Background removed in ${Math.round(result.durationMs)} ms (${result.backend.toUpperCase()}).`);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError(reason instanceof Error ? reason.message : 'Background removal failed.');
      }
    } finally {
      if (operation === operationRef.current) {
        abortRef.current = null;
        setState({ phase: 'idle' });
      }
    }
  }, [applyMask, createModel, getDocument, getRenderer, setError, setStatus]);

  const request = useCallback(() => {
    const document = getDocument();
    const layer = document ? findDocumentLayer(document, document.activeLayerId) : null;
    if (layer?.type !== 'raster') {
      setError('Remove Background requires an active raster layer.');
      return;
    }
    if (layer.locks.all || layer.locks.pixels) {
      setError('Unlock the active layer before removing its background.');
      return;
    }
    if (layer.mask) setState({ phase: 'choose-mask-mode', layerName: layer.name });
    else void removeBackgroundFromActiveLayer('replace');
  }, [getDocument, removeBackgroundFromActiveLayer, setError]);

  return { state, request, cancel, removeBackgroundFromActiveLayer } as const;
};
