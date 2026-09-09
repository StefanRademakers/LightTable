import {
  setRasterLayerAdjustmentStack
} from '../../../editor/document/documentCommands';
import {
  layerIsLocked,
  type ImageDocument,
  type LayerId,
  type RasterLayer
} from '../../../editor/document/documentTypes';
import { findRasterLayer } from '../../../editor/document/layerTree';
import {
  invertMatrix,
  transformPoint
} from '../../../editor/tools/transform/affine';
import {
  findWarpModuleInstance,
  isExecutableWarpMode,
  removeWarpNodeFromStack,
  type WarpBrushMode,
  type WarpBrushSettingsSnapshot,
  type WarpStroke
} from '../../../effects/warp/warpTypes';
import {
  parseSemanticWarpStrokeCommand,
  semanticWarpStrokeFromCommitted,
  type SemanticWarpStrokeCommand
} from '../../commands/semanticWarpCommandContract';
import { applyWarpStrokeToDocument } from './warpDocumentOperation';
import {
  WarpGestureController,
  type WarpGesturePoint
} from './warpGestureController';
import {
  createImmediateWarpPreviewScheduler,
  type WarpPreviewScheduler
} from './warpPreviewScheduler';
import {
  createInactiveWarpHoldScheduler,
  type WarpHoldScheduler
} from './warpHoldScheduler';
import type {
  DocumentMutationController,
  DocumentMutationTransaction
} from '../../documents/useDocumentMutationController';

export interface WarpSessionDependencies {
  getDocument(): ImageDocument | null;
  readonly documentMutations: Pick<DocumentMutationController, 'begin' | 'change'>;
  setError(message: string | null): void;
  createId(kind: 'stack' | 'module' | 'stroke'): string;
  acquireInteractionBinding?(layerId: LayerId): WarpInteractionBinding | null;
  onStrokeCommitted?(
    layerId: LayerId,
    stroke: WarpStroke,
    command: SemanticWarpStrokeCommand
  ): void;
}

export interface WarpInteractionBinding {
  isCurrent(): boolean;
  setActive(active: boolean, moduleId: string): void;
  requestCanonicalProjection(moduleId: string, moduleRevision: number): boolean;
}

export interface BeginWarpSession {
  readonly pointerId: number;
  readonly mode: WarpBrushMode;
  readonly settings: WarpBrushSettingsSnapshot;
  /** Document-space input. It is frozen into layer-source coordinates at begin. */
  readonly point: WarpGesturePoint;
}

export interface WarpSessionController {
  readonly active: boolean;
  owns(pointerId: number): boolean;
  begin(request: BeginWarpSession): boolean;
  move(pointerId: number, point: WarpGesturePoint): boolean;
  moveMany(pointerId: number, points: readonly WarpGesturePoint[]): boolean;
  finish(pointerId: number, timeMs: number): boolean;
  cancel(pointerId: number): boolean;
  clearActiveLayer(): boolean;
  reset(): void;
}

interface ActiveWarpSession {
  readonly documentId: ImageDocument['id'];
  readonly layerId: RasterLayer['id'];
  readonly transaction: DocumentMutationTransaction;
  readonly dependencies: WarpSessionDependencies;
  readonly interactionBinding: WarpInteractionBinding | null;
  /** Stable stack/module identity used to replace this gesture's stroke. */
  readonly recipeBase: ImageDocument;
  readonly moduleId: string;
  nextModuleRevision: number;
  nextStackRevision: number;
}

const documentWithoutWarp = (
  document: ImageDocument,
  layerId: RasterLayer['id']
): ImageDocument => {
  const layer = findRasterLayer(document, layerId);
  if (!layer?.adjustmentStack) return document;
  const stack = removeWarpNodeFromStack(layer.adjustmentStack);
  if (stack === layer.adjustmentStack) return document;
  return setRasterLayerAdjustmentStack(
    document,
    layerId,
    stack.modules.length > 0 ? stack : null
  );
};

const toLayerSourcePoint = (
  layer: RasterLayer,
  point: WarpGesturePoint
): WarpGesturePoint | null => {
  const documentToSource = invertMatrix(layer.transform);
  if (!documentToSource) return null;
  const source = transformPoint(documentToSource, point);
  return { ...point, x: source.x, y: source.y };
};

const toLayerSourcePoints = (
  layer: RasterLayer,
  points: readonly WarpGesturePoint[]
): WarpGesturePoint[] => {
  const documentToSource = invertMatrix(layer.transform);
  if (!documentToSource) return [];
  return points.map((point) => {
    const source = transformPoint(documentToSource, point);
    return { ...point, x: source.x, y: source.y };
  });
};

/**
 * Owns one non-destructive Warp gesture and its document transaction.
 *
 * Every preview is a normal immutable document snapshot, while pointer-up
 * records exactly one undo entry. The transaction is locked to a document and
 * layer identity, so switching tabs cannot leak a stroke into another file.
 */
export const createWarpSessionController = (
  resolveDependencies: () => WarpSessionDependencies,
  gesture = new WarpGestureController(),
  previewScheduler: WarpPreviewScheduler = createImmediateWarpPreviewScheduler(),
  holdScheduler: WarpHoldScheduler = createInactiveWarpHoldScheduler()
): WarpSessionController => {
  let active: ActiveWarpSession | null = null;

  const currentTarget = (): {
    dependencies: WarpSessionDependencies;
    document: ImageDocument;
    layer: RasterLayer;
  } | null => {
    const dependencies = active?.dependencies;
    if (!dependencies) return null;
    try {
      if (active?.interactionBinding?.isCurrent() === false) return null;
    } catch (reason) {
      dependencies.setError(
        reason instanceof Error ? reason.message : 'Warp renderer validation failed.'
      );
      return null;
    }
    const document = dependencies.getDocument();
    if (!active?.transaction.active || !document || document.id !== active.documentId) return null;
    const layer = findRasterLayer(active.transaction.current, active.layerId);
    return layer ? { dependencies, document: active.transaction.current, layer } : null;
  };

  const publishStroke = (stroke: WarpStroke): boolean => {
    const target = currentTarget();
    if (!target) return false;
    try {
      const previewDocument = applyWarpStrokeToDocument(
        active!.recipeBase,
        target.layer.id,
        stroke,
        target.dependencies,
        {
          moduleId: active!.moduleId,
          moduleRevision: active!.nextModuleRevision++,
          stackRevision: active!.nextStackRevision++
        }
      );
      return active!.transaction.change(() => previewDocument);
    } catch (reason) {
      target.dependencies.setError(
        reason instanceof Error ? reason.message : 'Warp preview failed.'
      );
      return false;
    }
  };

  const scheduleStroke = (stroke: WarpStroke): boolean => {
    if (!currentTarget()) return false;
    previewScheduler.schedule(() => {
      if (!publishStroke(stroke)) {
        if (active) active.transaction.cancel();
        else closeInteraction();
      }
    });
    return true;
  };

  const closeInteraction = () => {
    const interactionBinding = active?.interactionBinding ?? null;
    const dependencies = active?.dependencies ?? null;
    const moduleId = active?.moduleId ?? null;
    holdScheduler.stop();
    previewScheduler.cancel();
    gesture.reset();
    active = null;
    try {
      if (moduleId) interactionBinding?.setActive(false, moduleId);
    } catch (reason) {
      dependencies?.setError(
        reason instanceof Error ? reason.message : 'Warp renderer cleanup failed.'
      );
    }
  };

  const moveMany = (pointerId: number, points: readonly WarpGesturePoint[]): boolean => {
    const target = currentTarget();
    if (!target) {
      if (active) active.transaction.cancel();
      else closeInteraction();
      return false;
    }
    const sourcePoints = toLayerSourcePoints(target.layer, points);
    if (!sourcePoints.length) return false;
    const stroke = gesture.moveMany(pointerId, sourcePoints);
    return stroke ? scheduleStroke(stroke) : false;
  };

  return {
    get active() {
      return active !== null;
    },
    owns: (pointerId) => gesture.owns(pointerId),
    begin: (request) => {
      if (active) return false;
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      const layer = document
        ? findRasterLayer(document, document.activeLayerId)
        : null;
      if (!document || !layer) {
        dependencies.setError('Select an editable raster layer before warping.');
        return false;
      }
      if (!isExecutableWarpMode(request.mode)) {
        dependencies.setError(`Warp mode "${request.mode}" is not available yet.`);
        return false;
      }
      if (layerIsLocked(layer, 'pixels') || layerIsLocked(layer, 'position')) {
        dependencies.setError('Unlock the active layer before warping.');
        return false;
      }
      const sourcePoint = toLayerSourcePoint(layer, request.point);
      if (!sourcePoint) {
        dependencies.setError('The active layer transform cannot be inverted.');
        return false;
      }
      const transaction = dependencies.documentMutations.begin(
        'tool.warp',
        { label: 'Warp layer', type: 'layer.warp', layerIds: [layer.id] },
        closeInteraction
      );
      if (!transaction) return false;
      try {
        const stroke = gesture.begin({
          pointerId: request.pointerId,
          strokeId: dependencies.createId('stroke'),
          mode: request.mode,
          settings: request.settings,
          point: sourcePoint
        });
        if (!stroke) {
          transaction.cancel();
          return false;
        }
        const interactionBinding = dependencies.acquireInteractionBinding?.(layer.id) ?? null;
        if (dependencies.acquireInteractionBinding && !interactionBinding) {
          gesture.reset();
          transaction.cancel();
          dependencies.setError('The Warp renderer is unavailable.');
          return false;
        }
        const recipeBase = applyWarpStrokeToDocument(
          transaction.before,
          layer.id,
          stroke,
          dependencies
        );
        const recipeModule = findWarpModuleInstance(
          findRasterLayer(recipeBase, layer.id)?.adjustmentStack
        );
        const recipeStack = findRasterLayer(recipeBase, layer.id)?.adjustmentStack;
        if (!recipeModule || !recipeStack) {
          throw new Error('The Warp recipe could not be created.');
        }
        active = {
          documentId: document.id,
          layerId: layer.id,
          transaction,
          dependencies,
          interactionBinding,
          recipeBase,
          moduleId: recipeModule.id,
          nextModuleRevision: recipeModule.revision + 1,
          nextStackRevision: recipeStack.revision + 1
        };
        interactionBinding?.setActive(true, recipeModule.id);
        if (!transaction.change(() => recipeBase)) {
          transaction.cancel();
          return false;
        }
      } catch (reason) {
        if (active?.transaction === transaction) active.transaction.cancel();
        else {
          gesture.reset();
          transaction.cancel();
        }
        dependencies.setError(reason instanceof Error ? reason.message : 'Warp could not start.');
        return false;
      }
      if (!active) {
        transaction.cancel();
        return false;
      }
      if (request.mode !== 'push') {
        holdScheduler.start((timeMs) => {
          const heldStroke = gesture.tick(request.pointerId, timeMs);
          if (heldStroke && !scheduleStroke(heldStroke)) transaction.cancel();
        });
      }
      dependencies.setError(null);
      return true;
    },
    move: (pointerId, point) => moveMany(pointerId, [point]),
    moveMany,
    finish: (pointerId, timeMs) => {
      holdScheduler.stop();
      const session = active;
      const stroke = gesture.finish(pointerId, timeMs);
      if (!session) return false;
      if (!stroke) {
        session.transaction.cancel();
        return true;
      }
      const command = parseSemanticWarpStrokeCommand(
        semanticWarpStrokeFromCommitted(session.layerId, stroke)
      );
      if ('message' in command) {
        session.dependencies.setError(command.message);
        session.transaction.cancel();
        return false;
      }
      previewScheduler.cancel();
      if (!publishStroke(stroke)) {
        session.transaction.cancel();
        return false;
      }
      try {
        const terminalModule = findWarpModuleInstance(
          findRasterLayer(session.transaction.current, session.layerId)?.adjustmentStack
        );
        if (!terminalModule
          || session.interactionBinding?.requestCanonicalProjection(
            terminalModule.id,
            terminalModule.revision
          ) === false) {
          throw new Error('The Warp renderer could not bind the terminal recipe.');
        }
      } catch (reason) {
        session.dependencies.setError(
          reason instanceof Error ? reason.message : 'Warp terminal projection failed.'
        );
        session.transaction.cancel();
        return false;
      }
      if (!session.transaction.commit()) return false;
      try {
        session.dependencies.onStrokeCommitted?.(
          session.layerId,
          structuredClone(stroke),
          command
        );
      } catch (reason) {
        session.dependencies.setError(
          reason instanceof Error ? reason.message : 'Warp command observation failed.'
        );
      }
      return true;
    },
    cancel: (pointerId) => {
      if (!gesture.cancel(pointerId)) return false;
      holdScheduler.stop();
      previewScheduler.cancel();
      active?.transaction.cancel();
      return true;
    },
    clearActiveLayer: () => {
      const dependencies = resolveDependencies();
      if (active) {
        dependencies.setError('Finish or cancel the active Warp stroke first.');
        return false;
      }
      const before = dependencies.getDocument();
      const layer = before
        ? findRasterLayer(before, before.activeLayerId)
        : null;
      if (!before || !layer) {
        dependencies.setError('Select a raster layer with a Warp edit first.');
        return false;
      }
      const after = documentWithoutWarp(before, layer.id);
      if (after === before) {
        dependencies.setError('The active layer has no Warp edit to reset.');
        return false;
      }
      dependencies.documentMutations.change(
        () => after,
        true,
        { label: 'Reset Warp', type: 'layer.warp.reset', layerIds: [layer.id] }
      );
      dependencies.setError(null);
      return true;
    },
    reset: () => {
      if (active) active.transaction.cancel();
      else closeInteraction();
    }
  };
};
