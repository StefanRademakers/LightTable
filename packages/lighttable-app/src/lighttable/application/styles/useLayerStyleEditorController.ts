import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { layerSupportsLayerStyles } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type {
  LayerStyleId,
  LayerStyleStack
} from '../../editor/styles/layerStyleTypes';
import type {
  DocumentMutationController
} from '../documents/useDocumentMutationController';
import {
  admittedInteraction,
  rejectedInteraction,
  type InteractionAdmission
} from '../interactions/interactionAdmission';
import {
  createLayerStyleInteractionSession,
  type LayerStyleInteractionHandle,
  type LayerStyleEditorRequest,
  type LayerStyleInteractionPort
} from './layerStyleInteractionSession';

export type { LayerStyleEditorRequest, LayerStyleInteractionPort } from './layerStyleInteractionSession';
export type { LayerStyleInteractionHandle } from './layerStyleInteractionSession';
export type LayerStyleInteractionAdmission = InteractionAdmission<LayerStyleInteractionHandle>;

export interface LayerStyleEditorDependencies {
  activeDocument: ImageDocument | null;
  getDocument(): ImageDocument | null;
  getRenderer(): LayerStyleInteractionPort | null;
  rendererGeneration: number;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
  onCheckpoint?(before: ImageDocument, after: ImageDocument, layerId: LayerId): void;
}

export interface LayerStyleEditorController {
  request: LayerStyleEditorRequest | null;
  draftGeneration: number;
  open(layerId: LayerId, effectId?: LayerStyleId): void;
  beginInteraction(): LayerStyleInteractionAdmission;
  preview(stack: LayerStyleStack, admission: LayerStyleInteractionAdmission): void;
  commitInteraction(admission: LayerStyleInteractionAdmission): void;
  cancelInteraction(admission: LayerStyleInteractionAdmission): void;
  cancel(): void;
  commit(): void;
}

export const reconcileLayerStyleEditorRequest = (
  activeDocument: ImageDocument | null,
  request: LayerStyleEditorRequest | null
): LayerStyleEditorRequest | null => {
  if (!activeDocument || !request || activeDocument.id !== request.before.id) return null;
  const layer = findDocumentLayer(activeDocument, request.layerId);
  if (!layer || !layerSupportsLayerStyles(layer) || layer.locks.all) return null;
  return request.effectId && !layer.styleStack.effects.some(({ id }) => id === request.effectId)
    ? { layerId: request.layerId, before: activeDocument }
    : request;
};

/**
 * Owns the transient gesture around editing a document-owned Layer Style stack.
 *
 * Pointer-rate previews are projected to the renderer only. The canonical
 * document and its history advance once, synchronously, when the interaction
 * commits. Replacing the target, switching documents or unmounting cancels the
 * preview rather than turning component lifecycle into an authoring action.
 */
export const useLayerStyleEditorController = (
  dependencies: LayerStyleEditorDependencies
): LayerStyleEditorController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const requestRef = useRef<LayerStyleEditorRequest | null>(null);
  const [request, setRequestState] = useState<LayerStyleEditorRequest | null>(null);
  const [draftGeneration, setDraftGeneration] = useState(0);
  const mountedRef = useRef(true);

  const setRequest = useCallback((next: LayerStyleEditorRequest | null) => {
    requestRef.current = next;
    setRequestState(next);
  }, []);

  const interactionRef = useRef<ReturnType<typeof createLayerStyleInteractionSession> | null>(null);
  interactionRef.current ??= createLayerStyleInteractionSession(() => ({
    getDocument: dependenciesRef.current.getDocument,
    getRenderer: dependenciesRef.current.getRenderer,
    getRendererGeneration: () => dependenciesRef.current.rendererGeneration,
    documentMutations: dependenciesRef.current.documentMutations,
    onCanceled: () => {
      if (mountedRef.current) setDraftGeneration((current) => current + 1);
    },
    onCheckpoint: (before, after, layerId) => {
      const currentRequest = requestRef.current;
      if (currentRequest?.layerId === layerId && currentRequest.before.id === after.id) {
        setRequest({ ...currentRequest, before: after });
      }
      dependenciesRef.current.onCheckpoint?.(before, after, layerId);
    }
  }));

  const discardInteraction = useCallback(() => {
    interactionRef.current?.cancelActive();
  }, []);

  const beginInteraction = useCallback(() => {
    // A concurrent control must fail closed without remounting the draft that
    // belongs to the gesture which already owns the document lease.
    if (interactionRef.current?.active) {
      return rejectedInteraction<LayerStyleInteractionHandle>();
    }
    const currentRequest = requestRef.current;
    const handle = currentRequest ? interactionRef.current?.begin(currentRequest) ?? null : null;
    if (handle) return admittedInteraction(handle);
    // The editor owns a local immutable draft. A rejected document lease must
    // remount that draft from canonical state instead of leaving a convincing
    // but uncommitted value visible in the panel.
    setDraftGeneration((current) => current + 1);
    return rejectedInteraction<LayerStyleInteractionHandle>();
  }, []);

  const commitInteraction = useCallback((admission: LayerStyleInteractionAdmission) => {
    if (admission.status === 'admitted') interactionRef.current?.commit(admission.handle);
  }, []);

  const cancelInteraction = useCallback((admission: LayerStyleInteractionAdmission) => {
    if (admission.status === 'admitted') interactionRef.current?.cancel(admission.handle);
  }, []);

  const open = useCallback((layerId: LayerId, effectId?: LayerStyleId) => {
    const current = dependenciesRef.current.getDocument();
    const layer = current ? findDocumentLayer(current, layerId) : null;
    if (!current || !layer || !layerSupportsLayerStyles(layer) || layer.locks.all) return;
    const activeRequest = requestRef.current;
    if (activeRequest?.layerId === layerId && activeRequest.before.id === current.id
      && activeRequest.effectId === effectId) {
      setRequest({ ...activeRequest, effectId });
      return;
    }
    discardInteraction();
    setRequest({ layerId, effectId, before: current });
  }, [discardInteraction, setRequest]);

  const preview = useCallback((stack: LayerStyleStack, admission: LayerStyleInteractionAdmission) => {
    const currentRequest = requestRef.current;
    if (currentRequest && admission.status === 'admitted') interactionRef.current?.preview(
      currentRequest, stack, admission.handle
    );
  }, []);

  const cancel = useCallback(() => {
    discardInteraction();
    setRequest(null);
  }, [discardInteraction, setRequest]);

  const commit = useCallback(() => {
    interactionRef.current?.commitActive();
    setRequest(null);
  }, [setRequest]);

  useEffect(() => {
    const currentRequest = requestRef.current;
    if (!currentRequest) return;
    const reconciled = reconcileLayerStyleEditorRequest(
      dependencies.activeDocument, currentRequest
    );
    if (reconciled) {
      if (!interactionRef.current?.reconcileBinding()) discardInteraction();
      if (reconciled === currentRequest) return;
      discardInteraction();
      setRequest(reconciled);
      return;
    }
    discardInteraction();
    setRequest(null);
  }, [dependencies.activeDocument, dependencies.rendererGeneration, discardInteraction, setRequest]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardInteraction();
    };
  }, [discardInteraction]);

  return {
    request,
    draftGeneration,
    open,
    beginInteraction,
    preview,
    commitInteraction,
    cancelInteraction,
    cancel,
    commit
  };
};
