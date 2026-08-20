import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { RasterSelectionMask } from '../../editor/selection/selectionTypes';
import type { LayerId } from '../../editor/document/documentTypes';
import { Ben2BackgroundRemovalModel } from './Ben2BackgroundRemovalModel';
import type { BackgroundRemovalModel, BackgroundRemovalProgress } from './backgroundRemovalTypes';
import { executeBackgroundRemovalOperation, type BackgroundRemovalRenderer }
  from './executeBackgroundRemovalOperation';
import { createBoundedTaskProgress } from '../tasks/boundedTaskProgress';

export type { BackgroundRemovalMaskMode } from '../commands/semanticBackgroundRemovalCommandContract';
import type { BackgroundRemovalMaskMode } from '../commands/semanticBackgroundRemovalCommandContract';

export type BackgroundRemovalControllerState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'choose-mask-mode'; readonly layerId: LayerId; readonly layerName: string }
  | { readonly phase: 'running'; readonly progress: BackgroundRemovalProgress };

interface UseBackgroundRemovalControllerOptions {
  readonly getDocument: () => ImageDocument | null;
  readonly getRenderer: () => BackgroundRemovalRenderer | null;
  readonly applyMask: (layerId: LayerId, mask: RasterSelectionMask, mode: BackgroundRemovalMaskMode) => boolean;
  readonly setStatus: (message: string) => void;
  readonly setError: (message: string) => void;
  readonly createModel?: () => BackgroundRemovalModel;
  readonly startTask?: (layerId: LayerId, mode: BackgroundRemovalMaskMode) => void;
  readonly cancelTask?: () => boolean;
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
  createModel = () => new Ben2BackgroundRemovalModel(),
  startTask,
  cancelTask
}: UseBackgroundRemovalControllerOptions) => {
  const [state, setState] = useState<BackgroundRemovalControllerState>({ phase: 'idle' });
  const modelRef = useRef<BackgroundRemovalModel | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const operationRef = useRef(0);
  const latestProgressRef = useRef<BackgroundRemovalProgress | null>(null);

  const cancel = useCallback(() => {
    if (cancelTask?.()) return;
    operationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ phase: 'idle' });
    setStatus('Background removal canceled.');
  }, [cancelTask, setStatus]);

  useEffect(() => () => {
    abortRef.current?.abort();
    modelRef.current?.dispose();
  }, []);

  const removeBackgroundFromLayer = useCallback(async (
    layerId: LayerId,
    mode: BackgroundRemovalMaskMode,
    options: { readonly signal?: AbortSignal; readonly onProgress?: (progress: BackgroundRemovalProgress) => void } = {}
  ) => {
    const document = getDocument();
    const renderer = getRenderer();
    const layer = document ? findDocumentLayer(document, layerId) : null;
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
    const abort = new AbortController();
    const cancelFromTask = () => abort.abort();
    options.signal?.addEventListener('abort', cancelFromTask, { once: true });
    if (options.signal?.aborted) abort.abort();
    abortRef.current?.abort();
    abortRef.current = abort;
    setState({ phase: 'running', progress: { phase: 'decode', message: 'Preparing active layer…' } });

    try {
      const model = modelRef.current ?? (modelRef.current = createModel());
      const publishProgress = createBoundedTaskProgress(() => {
        const progress = latestProgressRef.current;
        if (!progress || operation !== operationRef.current) return;
        setState({ phase: 'running', progress });
        options.onProgress?.(progress);
      });
      const result = await executeBackgroundRemovalOperation({
        document, layer, renderer, model, mode, signal: abort.signal, getDocument, applyMask,
        onProgress: (progress) => {
          latestProgressRef.current = progress;
          publishProgress(progress.percent ?? 0, progress.message);
        }
      });
      setStatus(`Background removed in ${Math.round(result.durationMs)} ms (${result.backend.toUpperCase()}).`);
      return result;
    } catch (reason) {
      const canceled = abort.signal.aborted
        || (reason instanceof DOMException && reason.name === 'AbortError');
      if (!canceled) setError(reason instanceof Error ? reason.message : 'Background removal failed.');
      throw canceled && !(reason instanceof DOMException)
        ? new DOMException('Background removal was canceled.', 'AbortError') : reason;
    } finally {
      options.signal?.removeEventListener('abort', cancelFromTask);
      if (operation === operationRef.current) {
        abortRef.current = null;
        latestProgressRef.current = null;
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
    if (layer.mask) setState({ phase: 'choose-mask-mode', layerId: layer.id, layerName: layer.name });
    else if (startTask) startTask(layer.id, 'replace');
    else void removeBackgroundFromLayer(layer.id, 'replace').catch(() => undefined);
  }, [getDocument, removeBackgroundFromLayer, setError, startTask]);

  const choose = useCallback((mode: BackgroundRemovalMaskMode) => {
    if (state.phase !== 'choose-mask-mode') return;
    if (startTask) startTask(state.layerId, mode);
    else void removeBackgroundFromLayer(state.layerId, mode).catch(() => undefined);
  }, [removeBackgroundFromLayer, startTask, state]);

  return { state, request, choose, cancel, removeBackgroundFromLayer } as const;
};
