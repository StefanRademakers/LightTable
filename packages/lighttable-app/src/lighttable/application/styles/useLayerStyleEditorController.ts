import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { layerSupportsLayerStyles } from '../../editor/document/documentTypes';
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
 * Owns contextual Layer Style editing transactions.
 *
 * Rapid previews are grouped into short undo checkpoints. This lets the
 * docked inspector stay open without retaining one unbounded transaction or
 * leaving the renderer in interaction quality between edits.
 */
export const useLayerStyleEditorController = (
  dependencies: LayerStyleEditorDependencies
): LayerStyleEditorController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const requestRef = useRef<LayerStyleEditorRequest | null>(null);
  const checkpointTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [request, setRequestState] = useState<LayerStyleEditorRequest | null>(null);

  const setRequest = useCallback((next: LayerStyleEditorRequest | null) => {
    requestRef.current = next;
    setRequestState(next);
  }, []);

  const endRendererInteraction = useCallback(() => {
    dependenciesRef.current.getRenderer()?.setLayerStyleInteractionActive(false);
  }, []);

  const clearCheckpointTimer = useCallback(() => {
    if (checkpointTimerRef.current === null) return;
    clearTimeout(checkpointTimerRef.current);
    checkpointTimerRef.current = null;
  }, []);

  const checkpoint = useCallback((close: boolean) => {
    clearCheckpointTimer();
    const currentRequest = requestRef.current;
    if (!currentRequest) return;
    const after = dependenciesRef.current.getDocument();
    if (after?.id === currentRequest.before.id && after !== currentRequest.before) {
      dependenciesRef.current.pushDocumentHistory(currentRequest.before, after);
    }
    endRendererInteraction();
    if (close || after?.id !== currentRequest.before.id) {
      setRequest(null);
    } else if (after !== currentRequest.before) {
      setRequest({ ...currentRequest, before: after });
    }
  }, [clearCheckpointTimer, endRendererInteraction, setRequest]);

  const scheduleCheckpoint = useCallback(() => {
    clearCheckpointTimer();
    checkpointTimerRef.current = setTimeout(() => checkpoint(false), 220);
  }, [checkpoint, clearCheckpointTimer]);

  const open = useCallback((layerId: LayerId, effectId?: LayerStyleId) => {
    const current = dependenciesRef.current.getDocument();
    const layer = current ? findDocumentLayer(current, layerId) : null;
    if (!current || !layer || !layerSupportsLayerStyles(layer)) return;
    const activeRequest = requestRef.current;
    if (activeRequest?.layerId === layerId && activeRequest.before.id === current.id) {
      setRequest({ ...activeRequest, effectId });
      return;
    }
    if (activeRequest) checkpoint(true);
    setRequest({ layerId, effectId, before: current });
  }, [checkpoint, setRequest]);

  const preview = useCallback((stack: LayerStyleStack) => {
    const currentRequest = requestRef.current;
    const current = dependenciesRef.current.getDocument();
    if (!current || !currentRequest || current.id !== currentRequest.before.id) return;
    const next = setLayerStyleStack(current, currentRequest.layerId, stack);
    if (next !== current) {
      dependenciesRef.current.getRenderer()?.setLayerStyleInteractionActive(true);
      dependenciesRef.current.applyDocumentSnapshot(next);
      scheduleCheckpoint();
    }
  }, [scheduleCheckpoint]);

  const cancel = useCallback(() => {
    clearCheckpointTimer();
    const currentRequest = requestRef.current;
    if (!currentRequest) return;
    const current = dependenciesRef.current.getDocument();
    if (current?.id === currentRequest.before.id) {
      dependenciesRef.current.applyDocumentSnapshot(currentRequest.before);
    }
    endRendererInteraction();
    setRequest(null);
  }, [clearCheckpointTimer, endRendererInteraction, setRequest]);

  const commit = useCallback(() => checkpoint(true), [checkpoint]);

  useEffect(() => {
    const currentRequest = requestRef.current;
    if (!currentRequest) return;
    const isSameDocument = dependencies.activeDocument?.id === currentRequest.before.id;
    const layer = isSameDocument && dependencies.activeDocument
      ? findDocumentLayer(dependencies.activeDocument, currentRequest.layerId)
      : null;
    if (layer && layerSupportsLayerStyles(layer)) return;
    // A document switch, undo or replacement can remove the edited layer.
    clearCheckpointTimer();
    endRendererInteraction();
    setRequest(null);
  }, [clearCheckpointTimer, dependencies.activeDocument, endRendererInteraction, setRequest]);

  useEffect(() => () => {
    clearCheckpointTimer();
    const currentRequest = requestRef.current;
    const after = dependenciesRef.current.getDocument();
    if (currentRequest && after?.id === currentRequest.before.id && after !== currentRequest.before) {
      dependenciesRef.current.pushDocumentHistory(currentRequest.before, after);
    }
    if (currentRequest) endRendererInteraction();
  }, [clearCheckpointTimer, endRendererInteraction]);

  return { request, open, preview, cancel, commit };
};
