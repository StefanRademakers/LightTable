import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { layerSupportsLayerStyles } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { setLayerStyleStack } from '../../editor/styles/layerStyleCommands';
import type { LayerStyleId, LayerStyleStack } from '../../editor/styles/layerStyleTypes';
import type {
  DocumentMutationController,
  DocumentMutationCloseReason,
  DocumentMutationTransaction
} from '../documents/useDocumentMutationController';

export interface LayerStyleInteractionPort {
  setLayerStyleInteractionActive(active: boolean, layerId?: LayerId): void;
}

export interface LayerStyleEditorRequest {
  layerId: LayerId;
  effectId?: LayerStyleId;
  before: ImageDocument;
}

export interface LayerStyleInteractionSessionDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): LayerStyleInteractionPort | null;
  getRendererGeneration(): number;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
  onCheckpoint?(before: ImageDocument, after: ImageDocument, layerId: LayerId): void;
  onCanceled?(reason: Exclude<DocumentMutationCloseReason, 'commit'>): void;
}

interface ActiveLayerStyleInteraction {
  readonly request: LayerStyleEditorRequest;
  readonly renderer: LayerStyleInteractionPort | null;
  readonly rendererGeneration: number;
  readonly transaction: DocumentMutationTransaction;
}

const sameTarget = (left: LayerStyleEditorRequest, right: LayerStyleEditorRequest) => (
  left.before.id === right.before.id
  && left.layerId === right.layerId
  && left.effectId === right.effectId
);

export interface LayerStyleInteractionSession {
  readonly active: boolean;
  begin(request: LayerStyleEditorRequest): boolean;
  preview(request: LayerStyleEditorRequest, stack: LayerStyleStack): boolean;
  commit(): boolean;
  cancel(): boolean;
  reconcileBinding(): boolean;
}

/** Owns one exact document/layer/presentation/renderer Layer Style gesture. */
export const createLayerStyleInteractionSession = (
  resolveDependencies: () => LayerStyleInteractionSessionDependencies
): LayerStyleInteractionSession => {
  let active: ActiveLayerStyleInteraction | null = null;

  const leaveRenderer = (interaction: ActiveLayerStyleInteraction) => {
    interaction.renderer?.setLayerStyleInteractionActive(false, interaction.request.layerId);
  };
  const close = (interaction: ActiveLayerStyleInteraction) => {
    if (active !== interaction) return;
    active = null;
    leaveRenderer(interaction);
  };
  const liveOwner = (interaction: ActiveLayerStyleInteraction) => {
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const layer = document
      ? findDocumentLayer(document, interaction.request.layerId)
      : null;
    return Boolean(document
      && document.id === interaction.request.before.id
      && layer && layerSupportsLayerStyles(layer) && !layer.locks.all
      && (!interaction.request.effectId
        || layer.styleStack.effects.some(({ id }) => id === interaction.request.effectId))
      && dependencies.getRenderer() === interaction.renderer
      && dependencies.getRendererGeneration() === interaction.rendererGeneration
      && interaction.transaction.active);
  };

  const cancel = () => {
    const interaction = active;
    if (!interaction) return false;
    try {
      return interaction.transaction.cancel();
    } finally {
      close(interaction);
    }
  };

  const begin = (request: LayerStyleEditorRequest) => {
    if (active && sameTarget(active.request, request) && liveOwner(active)) return true;
    cancel();
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const layer = document && document.id === request.before.id
      ? findDocumentLayer(document, request.layerId)
      : null;
    if (!document || !layer || !layerSupportsLayerStyles(layer) || layer.locks.all
      || (request.effectId
        && !layer.styleStack.effects.some(({ id }) => id === request.effectId))) return false;
    const renderer = dependencies.getRenderer();
    if (!renderer) return false;
    const rendererGeneration = dependencies.getRendererGeneration();
    let interaction: ActiveLayerStyleInteraction | null = null;
    const transaction = dependencies.documentMutations.begin(
      `layer-style:${document.id}:${request.layerId}:${request.effectId ?? 'stack'}`,
      { label: 'Layer Style', type: 'layer.style', layerIds: [request.layerId] },
      (reason) => {
        if (interaction) close(interaction);
        if (reason !== 'commit') dependencies.onCanceled?.(reason);
      },
      'cancel'
    );
    if (!transaction) return false;
    interaction = { request, renderer, rendererGeneration, transaction };
    active = interaction;
    try {
      renderer?.setLayerStyleInteractionActive(true, request.layerId);
    } catch (error) {
      cancel();
      throw error;
    }
    return true;
  };

  return {
    get active() { return active !== null; },
    begin,
    preview: (request, stack) => {
      if (!active || !sameTarget(active.request, request)) {
        if (!begin(request)) return false;
      }
      const interaction = active;
      if (!interaction || !liveOwner(interaction)) {
        cancel();
        return false;
      }
      return interaction.transaction.change((current) => (
        setLayerStyleStack(current, interaction.request.layerId, stack)
      ));
    },
    commit: () => {
      const interaction = active;
      if (!interaction) return false;
      if (!liveOwner(interaction)) {
        cancel();
        return false;
      }
      const before = interaction.transaction.before;
      const after = interaction.transaction.current;
      try {
        const changed = interaction.transaction.commit();
        if (changed) {
          resolveDependencies().onCheckpoint?.(
            before, after, interaction.request.layerId
          );
        }
        return changed;
      } finally {
        close(interaction);
      }
    },
    cancel,
    reconcileBinding: () => {
      if (!active || liveOwner(active)) return true;
      cancel();
      return false;
    }
  };
};
