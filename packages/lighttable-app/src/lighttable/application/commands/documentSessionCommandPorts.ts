import type { EditorApplicationSession } from '../workspace/editorApplicationSession';
import { applyLayerCreation } from '../layers/applyLayerCreation';
import { layerSupportsLayerStyles } from '../../editor/document/documentTypes';
import type { DocumentSession } from '../documents/documentSession';
import type { DocumentLightTableCommandPorts } from './lightTableCommandContract';
import {
  createRasterLayer,
  createGradientFillLayer,
  createGroupLayer,
  deleteLayers,
  groupLayers,
  moveLayer,
  moveLayerSelection,
  removeLayerMask,
  renameLayer,
  setLayerBlendMode,
  setLayerClipping,
  setLayerFillOpacity,
  setLayerOpacity,
  setLayerMaskEnabled,
  setLayerMaskLinked,
  setLayersLock,
  setLayersVisibility,
  setLayerTransform,
  setVectorLayerAntiAlias,
  ungroupLayers
} from '../../editor/document/documentCommands';
import { findDocumentLayer, siblingLayers } from '../../editor/document/layerTree';
import { createDocumentHistoryController } from './useDocumentHistoryController';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { executeSemanticTextCommand } from '../text/semanticTextCommandExecutor';
import { executeSemanticVectorCommand } from '../vectors/semanticVectorCommandExecutor';
import { executeSvgImport, exportSvgDocument } from '../vectors/svgDocumentCodec';
import { executeSemanticLayerStyleCommand } from '../styles/semanticLayerStyleCommandExecutor';
import { executeSemanticLayerStyleSnapshot } from '../styles/executeSemanticLayerStyleSnapshot';
import { executeSemanticFilterSnapshot } from '../filters/executeSemanticFilterSnapshot';
import { executeSemanticProcessingStructure } from '../adjustments/executeSemanticProcessingStructure';
import { layerStyleSnapshot } from '../styles/completeLayerStyleSnapshot';
import { executeSemanticWarpStrokeCommand } from './semanticWarpCommandExecutor';
import { executeSemanticFaceWarpCommand } from '../effects/faceWarp/semanticFaceWarpCommandExecutor';
import { executeAtomicCommandBatch } from './atomicCommandBatchExecutor';
import {
  canReadInactiveFlatRaster,
  copyInactiveFlatRasterPixels,
  exportInactiveFlatRasterLayerPreview,
  exportInactiveFlatRasterPreview
} from './inactiveFlatRasterArtifacts';
import type { LightTableCommandId } from './lightTableCommandContract';

const requiresPresentation = (operation: string): never => {
  throw new Error(`${operation} requires the active document presentation renderer.`);
};

const CANONICAL_PORTS = new Set<string>([
  'setZoom', 'createRasterLayer', 'renameLayer', 'setLayerVisibility',
  'setLayerFillOpacity', 'setLayerStyleEnabled', 'setLayerEffectEnabled',
  'executeTextCommand', 'executeVectorCommand', 'executeSvgImport',
  'executeWarpStrokeCommand', 'executeLayerStyleCommand', 'executeFaceWarpCommand',
  'executeLayerStyleSnapshot', 'executeFilterSnapshot',
  'executeProcessingStructure',
  'executeLayerCommand', 'executeAtomicBatch', 'exportSvgArtifact'
]);

const CANONICAL_COMMANDS = new Set<LightTableCommandId>([
  'view.setZoom', 'layer.createRaster', 'layer.createGradientFill', 'layer.createGroup',
  'layer.group', 'layer.ungroup', 'layer.reorder', 'layer.delete', 'layer.move',
  'layer.setOpacity', 'layer.setVectorAntiAlias',
  'layer.setBlendMode', 'layer.setClipping', 'layer.setTransform', 'layer.setLock',
  'layer.rename', 'layer.setVisibility', 'layer.setFillOpacity',
  'layer.style.setEnabled', 'layer.style.update', 'layer.effect.setEnabled',
  'layer.style.setSnapshot', 'filter.setSnapshot',
  'adjustment.modifyStructure',
  'layer.effect.add', 'layer.effect.update', 'layer.effect.remove', 'layer.effect.move',
  'text.create', 'text.replaceRange', 'text.format', 'text.setLayout',
  'vector.create', 'vector.update', 'vector.remove', 'vector.importSvg',
  'warp.applyStroke', 'faceWarp.applyOperation', 'command.batch', 'file.exportSvg'
]);

/**
 * Creates the document-lifetime semantic command owner.
 *
 * This controller deliberately contains only operations whose canonical result
 * can be produced without a mounted canvas or presentation renderer. The one
 * active editor port may override these operations and supplies GPU-dependent
 * commands, but tab visibility is never required for ordinary document-model
 * mutations.
 */
export const createDocumentSessionCommandPorts = (
  session: DocumentSession,
  applicationSession: EditorApplicationSession
): DocumentLightTableCommandPorts => {
  const applyDocument = (document: NonNullable<ReturnType<typeof session.getSnapshot>['document']>) => {
    session.setDocument(document);
  };
  const history = createDocumentHistoryController(() => ({
    documentId: session.id,
    history: session.history,
    getDocument: () => session.getSnapshot().document,
    getRenderer: () => null,
    finishOpenTransactions: () => undefined,
    setError: () => undefined
  }));
  const mutation = createDocumentMutationController(() => ({
    getDocument: () => session.getSnapshot().document,
    applySnapshot: applyDocument,
    previewSnapshot: () => requiresPresentation('Document transaction previews'),
    discardPreview: () => undefined,
    pushHistoryEntry: history.record,
    isMutationBlocked: () => !session.isAcceptingMutations()
  }));
  const semanticDependencies = {
    getDocument: () => session.getSnapshot().document,
    applyDocument,
    recordHistory: mutation.record
  };
  const change = mutation.change;

  return {
    // An inactive document has no mounted renderer/tool preview to retire.
    settleInteractionBeforeCommand: () => undefined,
    supportsPort: (port) => CANONICAL_PORTS.has(port)
      || (canReadInactiveFlatRaster(session)
        && ['copyPixels', 'exportPreviewArtifact', 'exportLayerPreviewArtifact'].includes(port)),
    supportsCommand: (command) => CANONICAL_COMMANDS.has(command)
      || (command === 'selection.copyPixels' && canReadInactiveFlatRaster(session)),
    setZoom: (viewport) => session.updateViewport(() => viewport),
    createRasterLayer: () => {
      change((document) => createRasterLayer(document));
      session.updateEditor((current) => ({ ...current, activeChannel: 'pixels' }));
    },
    copyPixels: () => copyInactiveFlatRasterPixels(session),
    placeArtifact: () => requiresPresentation('Placing raster artwork'),
    renameLayer: (layerId, name) => { change((document) => renameLayer(document, layerId, name)); },
    setLayerVisibility: (layerIds, visible) => {
      change((document) => setLayersVisibility(document, [...layerIds], visible));
    },
    setLayerFillOpacity: (layerId, opacity) => {
      change((document) => setLayerFillOpacity(document, layerId, opacity));
    },
    setLayerStyleEnabled: (layerId, enabled) => {
      const document = session.getSnapshot().document;
      const layer = document ? findDocumentLayer(document, layerId) : null;
      if (!layer || !layerSupportsLayerStyles(layer)) {
        throw new Error('The layer cannot own Layer Styles.');
      }
      executeSemanticLayerStyleSnapshot({
        layerId,
        snapshot: { ...layerStyleSnapshot(layer.styleStack), enabled }
      }, { changeDocument: mutation.change });
    },
    setLayerEffectEnabled: (layerId, effectId, enabled) => executeSemanticLayerStyleCommand(
      { kind: 'toggle', layerId, effectId, enabled }, { changeDocument: mutation.change }
    ),
    executeTextCommand: (command, assertCurrent) => executeSemanticTextCommand(command, {
      assertCurrent,
      changeDocument: mutation.change,
      getDocument: semanticDependencies.getDocument,
      fontRegistry: session.fonts,
      getTextSettings: () => applicationSession.getSnapshot().text,
      getForegroundColor: () => applicationSession.getSnapshot().brush.color
    }),
    executeVectorCommand: (command) => executeSemanticVectorCommand(command, {
      changeDocument: mutation.change
    }),
    executeSvgImport: (command) => executeSvgImport(command, {
      changeDocument: mutation.change,
      captureScope: () => {
        const documentId = session.getSnapshot().document?.id;
        return { isCurrent: () => {
          const current = session.getSnapshot();
          return Boolean(documentId) && current.lifecycle === 'ready'
            && current.document?.id === documentId;
        } };
      }
    }),
    executeWarpStrokeCommand: (command) => executeSemanticWarpStrokeCommand(command, {
      getDocument: semanticDependencies.getDocument,
      changeDocument: mutation.change,
      createId: (kind) => `warp-${kind}-${crypto.randomUUID()}`
    }),
    executeFillCommand: () => requiresPresentation('Fill'),
    executeRasterGradientCommand: () => requiresPresentation('Raster gradients'),
    executeLayerStyleCommand: (command) => executeSemanticLayerStyleCommand(
      command, { changeDocument: mutation.change }
    ),
    executeLayerStyleSnapshot: (command) => executeSemanticLayerStyleSnapshot(command, {
      changeDocument: mutation.change
    }),
    executeFilterSnapshot: (command) => executeSemanticFilterSnapshot(command, {
      changeDocument: mutation.change
    }),
    executeProcessingStructure: (command) => executeSemanticProcessingStructure(command, {
      changeDocument: mutation.change
    }),
    executeFaceWarpCommand: (command) => executeSemanticFaceWarpCommand(
      command, {
        getDocument: semanticDependencies.getDocument,
        changeDocument: mutation.change
      }
    ),
    executeLayerCommand: (command) => {
      if (command.kind === 'duplicate' || command.kind === 'copy-to-new-layer') {
        return requiresPresentation('Raster layer duplication');
      }
      if (command.kind === 'delete') {
        change((document) => deleteLayers(document, [...command.layerIds]));
        return { layerIds: command.layerIds };
      }
      if (command.kind === 'move') {
        const document = session.getSnapshot().document;
        if (!document) return null;
        const siblings = siblingLayers(document, command.layerId);
        const index = siblings.findIndex(({ id }) => id === command.layerId);
        const target = index + (command.direction === 'up' ? 1 : -1);
        if (index < 0 || target < 0 || target >= siblings.length) return null;
        change((current) => moveLayer(current, command.layerId, target));
        return { layerId: command.layerId, direction: command.direction };
      }
      if (command.kind === 'set-opacity') {
        change((document) => setLayerOpacity(document, command.layerId, command.opacity));
        return { layerId: command.layerId, opacity: command.opacity };
      }
      if (command.kind === 'set-vector-anti-alias') {
        change((document) => setVectorLayerAntiAlias(document, command.layerId, command.antiAlias));
        return { layerId: command.layerId, antiAlias: command.antiAlias };
      }
      if (command.kind === 'set-blend-mode') {
        change((document) => setLayerBlendMode(document, command.layerId, command.blendMode));
        return { layerId: command.layerId, blendMode: command.blendMode };
      }
      if (command.kind === 'set-clipping') {
        change((document) => setLayerClipping(document, command.layerId, command.clipping));
        return { layerId: command.layerId, clipping: command.clipping };
      }
      if (command.kind === 'set-transform') {
        change((document) => setLayerTransform(document, command.layerId, command.transform));
        return { layerId: command.layerId, transform: command.transform };
      }
      if (command.kind === 'set-mask') {
        if (command.operation === 'add') return requiresPresentation('Creating raster masks');
        if (command.operation === 'remove') return requiresPresentation('Deleting raster masks');
        if (command.operation === 'invert') return requiresPresentation('Inverting raster masks');
        if (command.operation === 'apply') return requiresPresentation('Applying raster masks');
        if (command.operation === 'load-selection') {
          return requiresPresentation('Loading raster masks as selections');
        }
        change((document) => command.operation === 'remove'
          ? removeLayerMask(document, command.layerId)
          : command.operation === 'set-enabled'
            ? setLayerMaskEnabled(document, command.layerId, command.enabled!)
            : setLayerMaskLinked(document, command.layerId, command.linked!));
        return { layerId: command.layerId, operation: command.operation,
          ...(command.operation === 'set-enabled' ? { enabled: command.enabled } : {}),
          ...(command.operation === 'set-linked' ? { linked: command.linked } : {}) };
      }
      if (command.kind === 'reorder') {
        change((document) => moveLayerSelection(
          document, [...command.layerIds], command.targetLayerId, command.placement
        ));
        return command;
      }
      if (command.kind === 'create-gradient-fill') {
        const layerId = applyLayerCreation(change, (document) => createGradientFillLayer(document));
        return layerId ? { layerId } : null;
      }
      if (command.kind === 'create-group') {
        const layerId = applyLayerCreation(change, (document) => createGroupLayer(document));
        return layerId ? { layerId } : null;
      }
      if (command.kind === 'group') {
        const groupId = applyLayerCreation(change, (document) => groupLayers(document, [...command.layerIds]));
        return groupId
          ? { layerIds: command.layerIds, groupId }
          : null;
      }
      if (command.kind === 'ungroup') {
        change((document) => ungroupLayers(document, [...command.layerIds]));
        return { layerIds: command.layerIds };
      }
      change((document) => setLayersLock(
        document, [...command.layerIds], command.lock, command.locked
      ));
      return { layerIds: command.layerIds, lock: command.lock, locked: command.locked };
    },
    executeSelectionCommand: () => requiresPresentation('Selection editing'),
    executeAtomicBatch: (batch, signal, report) => executeAtomicCommandBatch(batch, {
      fontRegistry: session.fonts,
      documentMutations: mutation,
      getTextSettings: () => applicationSession.getSnapshot().text,
      getForegroundColor: () => applicationSession.getSnapshot().brush.color
    }, signal, report),
    exportNativeArtifact: () => requiresPresentation('Native export'),
    exportPngArtifact: () => requiresPresentation('PNG export'),
    exportBitmapArtifact: () => requiresPresentation('Bitmap export'),
    exportPreviewArtifact: (maxEdge, encoding, region) =>
      exportInactiveFlatRasterPreview(session, maxEdge, encoding, region),
    exportLayerPreviewArtifact: (layerId, channel, maxEdge, encoding) =>
      exportInactiveFlatRasterLayerPreview(session, layerId, channel, maxEdge, encoding),
    exportPsdArtifact: () => requiresPresentation('PSD export'),
    exportSvgArtifact: () => {
      const document = session.getSnapshot().document;
      if (!document) throw new Error('The SVG export document is unavailable.');
      return exportSvgDocument(document, session.getSnapshot().title);
    },
    beginGesture: () => requiresPresentation('Gestures'),
    updateGesture: () => requiresPresentation('Gestures'),
    finishGesture: () => requiresPresentation('Gestures'),
    undo: () => requiresPresentation('Undo'),
    redo: () => requiresPresentation('Redo')
  };
};
