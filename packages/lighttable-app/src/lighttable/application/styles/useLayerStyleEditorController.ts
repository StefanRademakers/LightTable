import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { setLayerStyleStack } from '../../editor/styles/layerStyleCommands';
import type {
  LayerStyleId,
  LayerStyleStack
} from '../../editor/styles/layerStyleTypes';

export interface LayerStyleInteractionPort {
  setLayerStyleInteractionActive(active: boolean): void;
}

export interface LayerStyleEditorRequest {
  layerId: LayerId;
  effectId?: LayerStyleId;
  before: ImageDocument;
}

export interface LayerStyleEditorDependencies {
  activeDocument: ImageDocument | null;
  getDocument(): ImageDocument | null;
  getRenderer(): LayerStyleInteractionPort | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushDocumentHistory(before: ImageDocument, after: ImageDocument): void;
}

export interface LayerStyleEditorController {
  request: LayerStyleEditorRequest | null;
  open(layerId: LayerId, effectId?: LayerStyleId): void;
  preview(stack: LayerStyleStack): void;
  cancel(): void;
  commit(): void;
}

/**
 * Owns the temporary Layer Style editing transaction.
 *
 * Previews may replace the active document many times, but cancel restores the
 * exact opening snapshot and commit records one history command. Renderer
 * interaction quality is always released, including when undo or a document
 * replacement removes the edited layer.
 */
export const useLayerStyleEditorController = (
  dependencies: LayerStyleEditorDependencies
): LayerStyleEditorController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const requestRef = useRef<LayerStyleEditorRequest | null>(null);
  const [request, setRequestState] = useState<LayerStyleEditorRequest | null>(null);

  const setRequest = useCallback((next: LayerStyleEditorRequest | null) => {
    requestRef.current = next;
    setRequestState(next);
  }, []);

  const endRendererInteraction = useCallback(() => {
    dependenciesRef.current.getRenderer()?.setLayerStyleInteractionActive(false);
  }, []);

  const open = useCallback((layerId: LayerId, effectId?: LayerStyleId) => {
    const current = dependenciesRef.current.getDocument();
    const layer = current ? findDocumentLayer(current, layerId) : null;
    if (!current || layer?.type !== 'raster') return;
    if (requestRef.current) {
      dependenciesRef.current.getRenderer()?.setLayerStyleInteractionActive(false);
    }
    dependenciesRef.current.getRenderer()?.setLayerStyleInteractionActive(true);
    setRequest({ layerId, effectId, before: current });
  }, [setRequest]);

  const preview = useCallback((stack: LayerStyleStack) => {
    const currentRequest = requestRef.current;
    const current = dependenciesRef.current.getDocument();
    if (!current || !currentRequest || current.id !== currentRequest.before.id) return;
    const next = setLayerStyleStack(current, currentRequest.layerId, stack);
    if (next !== current) dependenciesRef.current.applyDocumentSnapshot(next);
  }, []);

  const cancel = useCallback(() => {
    const currentRequest = requestRef.current;
    if (!currentRequest) return;
    const current = dependenciesRef.current.getDocument();
    if (current?.id === currentRequest.before.id) {
      dependenciesRef.current.applyDocumentSnapshot(currentRequest.before);
    }
    endRendererInteraction();
    setRequest(null);
  }, [endRendererInteraction, setRequest]);

  const commit = useCallback(() => {
    const currentRequest = requestRef.current;
    if (!currentRequest) return;
    const after = dependenciesRef.current.getDocument();
    if (
      after?.id === currentRequest.before.id
      && after !== currentRequest.before
    ) {
      dependenciesRef.current.pushDocumentHistory(currentRequest.before, after);
    }
    endRendererInteraction();
    setRequest(null);
  }, [endRendererInteraction, setRequest]);

  useEffect(() => {
    const currentRequest = requestRef.current;
    if (!currentRequest) return;
    const isSameDocument = dependencies.activeDocument?.id === currentRequest.before.id;
    const layer = isSameDocument && dependencies.activeDocument
      ? findDocumentLayer(dependencies.activeDocument, currentRequest.layerId)
      : null;
    if (layer?.type === 'raster') return;
    // A document switch, undo or replacement can remove the edited layer.
    endRendererInteraction();
    setRequest(null);
  }, [dependencies.activeDocument, endRendererInteraction, setRequest]);

  useEffect(() => () => {
    if (requestRef.current) endRendererInteraction();
  }, [endRendererInteraction]);

  return { request, open, preview, cancel, commit };
};
