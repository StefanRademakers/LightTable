import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { layerSupportsLayerStyles } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { LayerStyleId, LayerStyleStack } from '../../editor/styles/layerStyleTypes';
import type {
  DocumentMutationController,
  DocumentMutationCloseReason,
  DocumentMutationTransaction
} from '../documents/useDocumentMutationController';
import { applyLayerStyleSnapshot, projectLayerStylePreview } from './layerStyleSnapshotOwner';
import { layerStyleSnapshot } from './completeLayerStyleSnapshot';

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
  readonly handle: LayerStyleInteractionHandle;
  readonly request: LayerStyleEditorRequest;
  readonly renderer: LayerStyleInteractionPort | null;
  readonly rendererGeneration: number;
  readonly transaction: DocumentMutationTransaction;
  desiredStack: LayerStyleStack;
  previewGeneration: number;
}

export interface LayerStyleInteractionHandle {
  readonly sequence: number;
}

const sameTarget = (left: LayerStyleEditorRequest, right: LayerStyleEditorRequest) => (
  left.before.id === right.before.id
  && left.layerId === right.layerId
  && left.effectId === right.effectId
);

export interface LayerStyleInteractionSession {
  readonly active: boolean;
  begin(request: LayerStyleEditorRequest): LayerStyleInteractionHandle | null;
  preview(request: LayerStyleEditorRequest, stack: LayerStyleStack,
    handle: LayerStyleInteractionHandle | void): boolean;
  commit(handle: LayerStyleInteractionHandle | void): boolean;
  commitActive(): boolean;
  cancel(handle: LayerStyleInteractionHandle | void): boolean;
  cancelActive(): boolean;
  reconcileBinding(): boolean;
}

/** Owns one exact document/layer/presentation/renderer Layer Style gesture. */
export const createLayerStyleInteractionSession = (
  resolveDependencies: () => LayerStyleInteractionSessionDependencies
): LayerStyleInteractionSession => {
  let active: ActiveLayerStyleInteraction | null = null;
  let sequence = 0;

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

  const cancelActive = () => {
    const interaction = active;
    if (!interaction) return false;
    try {
      return interaction.transaction.cancel();
    } finally {
      close(interaction);
    }
  };

  const begin = (request: LayerStyleEditorRequest) => {
    // A pointer gesture exclusively owns its admission handle. Sharing that
    // handle with a second control lets the first pointerup commit while the
    // second control continues publishing an unowned local draft.
    if (active) return null;
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const layer = document && document.id === request.before.id
      ? findDocumentLayer(document, request.layerId)
      : null;
    if (!document || !layer || !layerSupportsLayerStyles(layer) || layer.locks.all
      || (request.effectId
        && !layer.styleStack.effects.some(({ id }) => id === request.effectId))) return null;
    const renderer = dependencies.getRenderer();
    if (!renderer) return null;
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
    if (!transaction) return null;
    const handle = { sequence: ++sequence };
    interaction = {
      handle, request, renderer, rendererGeneration, transaction,
      desiredStack: layer.styleStack,
      previewGeneration: 0
    };
    active = interaction;
    try {
      renderer?.setLayerStyleInteractionActive(true, request.layerId);
    } catch (error) {
      cancelActive();
      throw error;
    }
    return handle;
  };

  const commitActive = () => {
    const interaction = active;
    if (!interaction) return false;
    if (!liveOwner(interaction)) {
      cancelActive();
      return false;
    }
    try {
      interaction.transaction.stage(() => applyLayerStyleSnapshot(
        interaction.transaction.before,
        interaction.request.layerId,
        layerStyleSnapshot(interaction.desiredStack)
      ));
    } catch (error) {
      cancelActive();
      throw error;
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
  };

  return {
    get active() { return active !== null; },
    begin,
    preview: (request, stack, handle) => {
      const interaction = active;
      if (!interaction || interaction.handle !== handle
        || !sameTarget(interaction.request, request)) return false;
      if (!liveOwner(interaction)) {
        cancelActive();
        return false;
      }
      interaction.desiredStack = stack;
      interaction.previewGeneration += 1;
      try {
        return interaction.transaction.change(() => projectLayerStylePreview(
          interaction.transaction.before,
          interaction.request.layerId,
          stack,
          interaction.previewGeneration
        ));
      } catch (error) {
        cancelActive();
        throw error;
      }
    },
    commit: (handle) => {
      const interaction = active;
      if (!interaction || interaction.handle !== handle) return false;
      return commitActive();
    },
    commitActive,
    cancel: (handle) => active?.handle === handle ? cancelActive() : false,
    cancelActive,
    reconcileBinding: () => {
      if (!active || liveOwner(active)) return true;
      cancelActive();
      return false;
    }
  };
};
