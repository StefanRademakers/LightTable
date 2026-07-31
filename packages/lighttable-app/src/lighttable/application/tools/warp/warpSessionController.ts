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
import type { AdjustmentStack } from '../../../processing/adjustmentStack';
import {
  addWarpNodeToStack,
  createDefaultWarpNodeSettings,
  createWarpModuleInstance,
  findWarpModuleInstance,
  readWarpNodeSettings,
  setWarpNodeSettings,
  type WarpBrushMode,
  type WarpBrushSettingsSnapshot,
  type WarpStroke
} from '../../../effects/warp/warpTypes';
import {
  WarpGestureController,
  type WarpGesturePoint
} from './warpGestureController';

export interface WarpHistoryEntry {
  readonly label?: string;
  readonly type?: string;
  readonly layerIds: readonly LayerId[];
  undo(): void;
  redo(): void;
}

export interface WarpSessionDependencies {
  getDocument(): ImageDocument | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushHistoryEntry(entry: WarpHistoryEntry): void;
  setError(message: string | null): void;
  createId(kind: 'stack' | 'module' | 'stroke'): string;
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
  finish(pointerId: number, timeMs: number): boolean;
  cancel(pointerId: number): boolean;
  reset(): void;
}

interface ActiveWarpSession {
  readonly documentId: ImageDocument['id'];
  readonly layerId: RasterLayer['id'];
  readonly before: ImageDocument;
}

const emptyStack = (
  dependencies: WarpSessionDependencies
): AdjustmentStack => ({
  id: dependencies.createId('stack'),
  revision: 0,
  modules: []
});

const documentWithStroke = (
  document: ImageDocument,
  layerId: RasterLayer['id'],
  stroke: WarpStroke,
  dependencies: WarpSessionDependencies
): ImageDocument => {
  const layer = findRasterLayer(document, layerId);
  if (!layer) throw new Error('The Warp target layer no longer exists.');
  let stack = layer.adjustmentStack
    ? structuredClone(layer.adjustmentStack)
    : emptyStack(dependencies);
  let instance = findWarpModuleInstance(stack);
  if (!instance) {
    instance = createWarpModuleInstance(dependencies.createId('module'));
    stack = addWarpNodeToStack(stack, instance);
  }
  const current = readWarpNodeSettings(findWarpModuleInstance(stack)!);
  const strokes = current.strokes.filter(({ id }) => id !== stroke.id);
  stack = setWarpNodeSettings(stack, {
    ...current,
    strokes: [...strokes, structuredClone(stroke)]
  });
  return setRasterLayerAdjustmentStack(document, layerId, stack);
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

/**
 * Owns one non-destructive Warp gesture and its document transaction.
 *
 * Every preview is a normal immutable document snapshot, while pointer-up
 * records exactly one undo entry. The transaction is locked to a document and
 * layer identity, so switching tabs cannot leak a stroke into another file.
 */
export const createWarpSessionController = (
  resolveDependencies: () => WarpSessionDependencies,
  gesture = new WarpGestureController()
): WarpSessionController => {
  let active: ActiveWarpSession | null = null;

  const currentTarget = (): {
    dependencies: WarpSessionDependencies;
    document: ImageDocument;
    layer: RasterLayer;
  } | null => {
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    if (!active || !document || document.id !== active.documentId) return null;
    const layer = findRasterLayer(document, active.layerId);
    return layer ? { dependencies, document, layer } : null;
  };

  const publishStroke = (stroke: WarpStroke): boolean => {
    const target = currentTarget();
    if (!target) return false;
    target.dependencies.applyDocumentSnapshot(documentWithStroke(
      target.document,
      target.layer.id,
      stroke,
      target.dependencies
    ));
    return true;
  };

  const restoreBefore = () => {
    if (!active) return;
    const dependencies = resolveDependencies();
    if (dependencies.getDocument()?.id === active.documentId) {
      dependencies.applyDocumentSnapshot(active.before);
    }
  };

  const reset = () => {
    gesture.reset();
    active = null;
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
      active = {
        documentId: document.id,
        layerId: layer.id,
        before: document
      };
      const stroke = gesture.begin({
        pointerId: request.pointerId,
        strokeId: dependencies.createId('stroke'),
        mode: request.mode,
        settings: request.settings,
        point: sourcePoint
      });
      if (!stroke || !publishStroke(stroke)) {
        restoreBefore();
        reset();
        return false;
      }
      dependencies.setError(null);
      return true;
    },
    move: (pointerId, point) => {
      const target = currentTarget();
      if (!target) {
        reset();
        return false;
      }
      const sourcePoint = toLayerSourcePoint(target.layer, point);
      if (!sourcePoint) return false;
      const stroke = gesture.move(pointerId, sourcePoint);
      return stroke ? publishStroke(stroke) : false;
    },
    finish: (pointerId, timeMs) => {
      const session = active;
      const stroke = gesture.finish(pointerId, timeMs);
      if (!session) return false;
      if (!stroke) {
        restoreBefore();
        active = null;
        return true;
      }
      if (!publishStroke(stroke)) {
        reset();
        return false;
      }
      const dependencies = resolveDependencies();
      const after = dependencies.getDocument();
      active = null;
      if (!after || after.id !== session.documentId) return false;
      dependencies.pushHistoryEntry({
        label: 'Warp layer',
        type: 'layer.warp',
        layerIds: [session.layerId],
        undo: () => {
          const latest = resolveDependencies();
          if (latest.getDocument()?.id !== session.documentId) {
            throw new Error('The Warp edit belongs to a different document.');
          }
          latest.applyDocumentSnapshot(session.before);
        },
        redo: () => {
          const latest = resolveDependencies();
          if (latest.getDocument()?.id !== session.documentId) {
            throw new Error('The Warp edit belongs to a different document.');
          }
          latest.applyDocumentSnapshot(after);
        }
      });
      return true;
    },
    cancel: (pointerId) => {
      if (!gesture.cancel(pointerId)) return false;
      restoreBefore();
      active = null;
      return true;
    },
    reset: () => {
      restoreBefore();
      reset();
    }
  };
};
