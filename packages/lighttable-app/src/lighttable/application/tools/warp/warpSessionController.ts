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
  removeWarpNodeFromStack,
  type WarpBrushMode,
  type WarpBrushSettingsSnapshot,
  type WarpStroke
} from '../../../effects/warp/warpTypes';
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
  setInteractionActive?(active: boolean): void;
  onStrokeCommitted?(layerId: LayerId, stroke: WarpStroke): void;
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
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    if (!active?.transaction.active || !document || document.id !== active.documentId) return null;
    const layer = findRasterLayer(active.transaction.current, active.layerId);
    return layer ? { dependencies, document: active.transaction.current, layer } : null;
  };

  const publishStroke = (stroke: WarpStroke): boolean => {
    const target = currentTarget();
    if (!target) return false;
    const previewDocument = applyWarpStrokeToDocument(
      active!.transaction.before,
      target.layer.id,
      stroke,
      target.dependencies
    );
    return active!.transaction.change(() => previewDocument);
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
    holdScheduler.stop();
    previewScheduler.cancel();
    gesture.reset();
    active = null;
    resolveDependencies().setInteractionActive?.(false);
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
      active = {
        documentId: document.id,
        layerId: layer.id,
        transaction
      };
      dependencies.setInteractionActive?.(true);
      const stroke = gesture.begin({
        pointerId: request.pointerId,
        strokeId: dependencies.createId('stroke'),
        mode: request.mode,
        settings: request.settings,
        point: sourcePoint
      });
      if (!stroke || !publishStroke(stroke)) {
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
      previewScheduler.cancel();
      if (!publishStroke(stroke)) {
        session.transaction.cancel();
        return false;
      }
      const dependencies = resolveDependencies();
      if (!session.transaction.commit()) return false;
      dependencies.onStrokeCommitted?.(session.layerId, structuredClone(stroke));
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
