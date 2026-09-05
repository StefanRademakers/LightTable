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
  setLayerStyleInteractionActive(active: boolean, layerId?: LayerId): void;
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
  previewDocumentSnapshot(document: ImageDocument): void;
  applyDocumentSnapshot(document: ImageDocument): void;
  discardDocumentPreview(): void;
  pushDocumentHistory(before: ImageDocument, after: ImageDocument): void;
  onCheckpoint?(before: ImageDocument, after: ImageDocument, layerId: LayerId): void;
}

export interface LayerStyleEditorController {
  request: LayerStyleEditorRequest | null;
  open(layerId: LayerId, effectId?: LayerStyleId): void;
  beginInteraction(): void;
  preview(stack: LayerStyleStack): void;
  commitInteraction(): void;
  cancelInteraction(): void;
  cancel(): void;
  commit(): void;
}

interface LayerStyleInteraction {
  before: ImageDocument;
  latest: ImageDocument | null;
  layerId: LayerId;
}

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
  const interactionRef = useRef<LayerStyleInteraction | null>(null);
  const [request, setRequestState] = useState<LayerStyleEditorRequest | null>(null);

  const setRequest = useCallback((next: LayerStyleEditorRequest | null) => {
    requestRef.current = next;
    setRequestState(next);
  }, []);

  const endRendererInteraction = useCallback(() => {
    dependenciesRef.current.getRenderer()?.setLayerStyleInteractionActive(false);
  }, []);

  const discardInteraction = useCallback(() => {
    const interaction = interactionRef.current;
    interactionRef.current = null;
    if (!interaction) return;
    dependenciesRef.current.discardDocumentPreview();
    endRendererInteraction();
  }, [endRendererInteraction]);

  const beginInteraction = useCallback(() => {
    if (interactionRef.current) return;
    const currentRequest = requestRef.current;
    const current = dependenciesRef.current.getDocument();
    if (!currentRequest || !current || current.id !== currentRequest.before.id) return;
    const layer = findDocumentLayer(current, currentRequest.layerId);
    if (!layer || !layerSupportsLayerStyles(layer)) return;
    interactionRef.current = {
      before: current,
      latest: null,
      layerId: currentRequest.layerId
    };
    dependenciesRef.current.getRenderer()?.setLayerStyleInteractionActive(
      true,
      currentRequest.layerId
    );
  }, []);

  const commitInteraction = useCallback(() => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    interactionRef.current = null;

    const current = dependenciesRef.current.getDocument();
    const canonicalIsBaseline = current?.id === interaction.before.id
      && current.revision === interaction.before.revision;
    const after = interaction.latest;
    if (!canonicalIsBaseline || !after || after === interaction.before) {
      dependenciesRef.current.discardDocumentPreview();
      endRendererInteraction();
      return;
    }

    try {
      dependenciesRef.current.applyDocumentSnapshot(after);
      dependenciesRef.current.pushDocumentHistory(interaction.before, after);
    } catch (error) {
      dependenciesRef.current.applyDocumentSnapshot(interaction.before);
      endRendererInteraction();
      throw error;
    }

    endRendererInteraction();
    const currentRequest = requestRef.current;
    if (currentRequest?.layerId === interaction.layerId) {
      setRequest({ ...currentRequest, before: after });
    }
    dependenciesRef.current.onCheckpoint?.(
      interaction.before,
      after,
      interaction.layerId
    );
  }, [endRendererInteraction, setRequest]);

  const cancelInteraction = useCallback(() => {
    discardInteraction();
  }, [discardInteraction]);

  const open = useCallback((layerId: LayerId, effectId?: LayerStyleId) => {
    const current = dependenciesRef.current.getDocument();
    const layer = current ? findDocumentLayer(current, layerId) : null;
    if (!current || !layer || !layerSupportsLayerStyles(layer)) return;
    const activeRequest = requestRef.current;
    if (activeRequest?.layerId === layerId && activeRequest.before.id === current.id) {
      setRequest({ ...activeRequest, effectId });
      return;
    }
    discardInteraction();
    setRequest({ layerId, effectId, before: current });
  }, [discardInteraction, setRequest]);

  const preview = useCallback((stack: LayerStyleStack) => {
    if (!interactionRef.current) beginInteraction();
    const interaction = interactionRef.current;
    if (!interaction) return;
    const current = dependenciesRef.current.getDocument();
    if (!current
      || current.id !== interaction.before.id
      || current.revision !== interaction.before.revision) {
      discardInteraction();
      return;
    }
    const next = setLayerStyleStack(interaction.before, interaction.layerId, stack);
    interaction.latest = next === interaction.before ? null : next;
    if (interaction.latest) {
      dependenciesRef.current.previewDocumentSnapshot(interaction.latest);
    } else {
      dependenciesRef.current.discardDocumentPreview();
    }
  }, [beginInteraction, discardInteraction]);

  const cancel = useCallback(() => {
    discardInteraction();
    setRequest(null);
  }, [discardInteraction, setRequest]);

  const commit = useCallback(() => {
    commitInteraction();
    setRequest(null);
  }, [commitInteraction, setRequest]);

  useEffect(() => {
    const currentRequest = requestRef.current;
    if (!currentRequest) return;
    const isSameDocument = dependencies.activeDocument?.id === currentRequest.before.id;
    const layer = isSameDocument && dependencies.activeDocument
      ? findDocumentLayer(dependencies.activeDocument, currentRequest.layerId)
      : null;
    if (layer && layerSupportsLayerStyles(layer)) return;
    discardInteraction();
    setRequest(null);
  }, [dependencies.activeDocument, discardInteraction, setRequest]);

  useEffect(() => () => {
    discardInteraction();
  }, [discardInteraction]);

  return {
    request,
    open,
    beginInteraction,
    preview,
    commitInteraction,
    cancelInteraction,
    cancel,
    commit
  };
};
