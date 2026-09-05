import type { EditorApplicationSession } from '../workspace/editorApplicationSession';
import type { DocumentSession } from '../documents/documentSession';
import type { DocumentLightTableCommandPorts } from './lightTableCommandContract';
import {
  createRasterLayer,
  deleteLayers,
  moveLayer,
  removeLayerMask,
  renameLayer,
  setLayerBlendMode,
  setLayerClipping,
  setLayerFillOpacity,
  setLayerMaskEnabled,
  setLayerMaskLinked,
  setLayersLock,
  setLayersVisibility,
  setLayerTransform
} from '../../editor/document/documentCommands';
import { siblingLayers } from '../../editor/document/layerTree';
import { setLayerStyleStackEnabled } from '../../editor/styles/layerStyleCommands';
import { createDocumentHistoryController } from './useDocumentHistoryController';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { executeSemanticTextCommand } from '../text/semanticTextCommandExecutor';
import { executeSemanticVectorCommand } from '../vectors/semanticVectorCommandExecutor';
import { executeSvgImport, exportSvgDocument } from '../vectors/svgDocumentCodec';
import { executeSemanticLayerStyleCommand } from '../styles/semanticLayerStyleCommandExecutor';
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
  'executeLayerCommand', 'executeAtomicBatch', 'exportSvgArtifact'
]);

const CANONICAL_COMMANDS = new Set<LightTableCommandId>([
  'view.setZoom', 'layer.createRaster', 'layer.delete', 'layer.move',
  'layer.setBlendMode', 'layer.setClipping', 'layer.setTransform', 'layer.setLock',
  'layer.rename', 'layer.setVisibility', 'layer.setFillOpacity',
  'layer.style.setEnabled', 'layer.style.update', 'layer.effect.setEnabled',
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
    isMutationBlocked: () => session.history.getSnapshot().busy
  }));
  const semanticDependencies = {
    getDocument: () => session.getSnapshot().document,
    applyDocument,
    recordHistory: mutation.record
  };
  const change = mutation.change;

  return {
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
      change((document) => setLayerStyleStackEnabled(document, layerId, enabled));
    },
    setLayerEffectEnabled: (layerId, effectId, enabled) => executeSemanticLayerStyleCommand(
      { kind: 'toggle', layerId, effectId, enabled }, { changeDocument: mutation.change }
    ),
    executeTextCommand: (command) => executeSemanticTextCommand(command, {
      ...semanticDependencies,
      fontRegistry: session.fonts,
      getTextSettings: () => applicationSession.getSnapshot().text,
      getForegroundColor: () => applicationSession.getSnapshot().brush.color
    }),
    executeVectorCommand: (command) => executeSemanticVectorCommand(command, semanticDependencies),
    executeSvgImport: (command) => executeSvgImport(command, semanticDependencies),
    executeWarpStrokeCommand: (command) => executeSemanticWarpStrokeCommand(command, {
      ...semanticDependencies,
      createId: (kind) => `warp-${kind}-${crypto.randomUUID()}`
    }),
    executeFillCommand: () => requiresPresentation('Fill'),
    executeRasterGradientCommand: () => requiresPresentation('Raster gradients'),
    executeLayerStyleCommand: (command) => executeSemanticLayerStyleCommand(
      command, { changeDocument: mutation.change }
    ),
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
        change((document) => command.operation === 'remove'
          ? removeLayerMask(document, command.layerId)
          : command.operation === 'set-enabled'
            ? setLayerMaskEnabled(document, command.layerId, command.enabled!)
            : setLayerMaskLinked(document, command.layerId, command.linked!));
        return { layerId: command.layerId, operation: command.operation,
          ...(command.operation === 'set-enabled' ? { enabled: command.enabled } : {}),
          ...(command.operation === 'set-linked' ? { linked: command.linked } : {}) };
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
