import { useMemo, useRef } from 'react';
import {
  markLayerMaskPixelsChanged,
  markLayerPixelsChanged
} from '../../../editor/document/documentCommands';
import type {
  ImageDocument,
  LayerId,
  LayerNode,
  Rect
} from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import type {
  BrushSettings,
  PaintChannel
} from '../../../editor/session/editorSession';
import type { BrushPoint } from '../../../editor/tools/brush/strokeBuilder';
import { resolveBrushPreset } from '../../../editor/tools/brush/brushPresets';
import {
  PaintGestureController,
  type PaintGestureTarget,
  type PaintGestureUpdate
} from '../../../editor/tools/paint/paintGestureController';
import { srgbHexToLinearRgb } from '../fill/fillOperation';
import type { SampledBrushStrokePlan } from '../../../editor/tools/paint/sampledBrushTypes';
import {
  createImmediatePaintDabScheduler,
  createPaintDabScheduler,
  type PaintDabScheduler,
  type PaintFramePort
} from './paintDabScheduler';

export interface PaintHistoryEntry {
  byteSize: number;
  layerIds: readonly LayerId[];
  undo(): void;
  redo(): void;
  dispose(): void;
}

export interface PaintSessionRendererPort {
  setPaintInteractionActive(active: boolean, layerId?: LayerId): void;
  beginBrushStroke(layer: LayerNode, channel: PaintChannel): void;
  beginSampledBrushStroke(plan: SampledBrushStrokePlan): void;
  endSampledBrushStroke(): void;
  paintBrushDabs(
    layerId: LayerId,
    channel: PaintChannel,
    dabs: PaintGestureUpdate['dabs'],
    color: [number, number, number],
    hardness: number,
    opacity: number,
    flow: number,
    erase: boolean,
    sourceToDocument: PaintGestureTarget['sourceToDocument'],
    tip: ReturnType<typeof resolveBrushPreset>['tip'],
    engine: ReturnType<typeof resolveBrushPreset>['engine'],
    operator?: SampledBrushStrokePlan
  ): void;
  finishPixelEdit(): ReversiblePixelEdit | null;
  cancelPixelEdit(): void;
  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
}

export interface PaintSessionDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): PaintSessionRendererPort | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushHistoryEntry(entry: PaintHistoryEntry): void;
  setError(message: string | null): void;
}

export interface BeginPaintSession {
  pointerId: number;
  layer: LayerNode;
  target: PaintGestureTarget;
  brush: BrushSettings;
  point: BrushPoint;
  /** Document-to-screen scale used to keep large-tip spacing visually continuous. */
  displayScale?: number;
  operator?: SampledBrushStrokePlan;
}

export interface PaintSessionController {
  get active(): boolean;
  owns(pointerId: number): boolean;
  begin(request: BeginPaintSession): boolean;
  move(pointerId: number, point: BrushPoint): boolean;
  finish(pointerId: number): boolean;
  cancel(pointerId: number): boolean;
  reset(): void;
}

const cloneBrush = (brush: BrushSettings): BrushSettings => ({ ...brush });

const clipDirtyBoundsToDocument = (
  bounds: Rect,
  document: Pick<ImageDocument, 'width' | 'height'>
): Rect | null => {
  const x = Math.max(0, bounds.x);
  const y = Math.max(0, bounds.y);
  const right = Math.min(document.width, bounds.x + bounds.width);
  const bottom = Math.min(document.height, bounds.y + bounds.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
};

/**
 * Owns one renderer-backed paint transaction from pointer-down to history.
 *
 * The brush, target and source-to-document matrix are snapshotted at begin.
 * React pointer routing can therefore change UI state without changing the
 * meaning of an in-flight stroke. A completed stroke publishes one document
 * revision and exactly one reversible GPU history entry.
 */
export const createPaintSessionController = (
  resolveDependencies: () => PaintSessionDependencies,
  gesture = new PaintGestureController(),
  frame?: PaintFramePort
): PaintSessionController => {
  let activeBrush: BrushSettings | null = null;
  let activeOperator: SampledBrushStrokePlan | null = null;

  const paint = (update: PaintGestureUpdate) => {
    if (!update.dabs.length || !activeBrush) return;
    const renderer = resolveDependencies().getRenderer();
    if (!renderer) return;
    const preset = resolveBrushPreset(activeBrush.presetId);
    renderer.paintBrushDabs(
      update.target.layerId,
      update.target.channel,
      update.dabs,
      srgbHexToLinearRgb(activeBrush.color) ?? [0, 0, 0],
      activeBrush.hardness,
      activeBrush.opacity,
      // Healing is a patch replacement operation rather than accumulating
      // paint. A single dab at full opacity must be able to remove a defect;
      // ordinary Brush and Clone Stamp retain their user-controlled flow.
      activeOperator?.operator === 'healing' ? 1 : activeBrush.flow,
      update.target.erase,
      update.target.sourceToDocument,
      preset.tip,
      preset.engine,
      activeOperator ?? undefined
    );
  };
  const paintScheduler: PaintDabScheduler = frame
    ? createPaintDabScheduler(frame, paint)
    : createImmediatePaintDabScheduler(paint);

  const reset = () => {
    if (gesture.active) {
      resolveDependencies().getRenderer()?.setPaintInteractionActive(false);
    }
    gesture.reset();
    paintScheduler.cancel();
    activeBrush = null;
    activeOperator = null;
    resolveDependencies().getRenderer()?.endSampledBrushStroke();
  };

  return {
    get active() {
      return gesture.active;
    },
    owns: (pointerId) => gesture.owns(pointerId),
    begin: ({ pointerId, layer, target, brush, point, displayScale = 1, operator }) => {
      const dependencies = resolveDependencies();
      const renderer = dependencies.getRenderer();
      if (!renderer) return false;
      try {
        renderer.setPaintInteractionActive(true, layer.id);
        renderer.beginBrushStroke(layer, target.channel);
        if (operator) renderer.beginSampledBrushStroke(operator);
        activeBrush = cloneBrush(brush);
        activeOperator = operator ?? null;
        paintScheduler.schedule(gesture.begin(pointerId, target, {
          ...activeBrush,
          maximumSpacingPx: Math.max(0.5, 1.5 / Math.max(displayScale, 0.01))
        }, point));
        dependencies.setError(null);
        return true;
      } catch (reason) {
        renderer.cancelPixelEdit();
        renderer.setPaintInteractionActive(false);
        reset();
        dependencies.setError(
          reason instanceof Error
            ? reason.message
            : 'The brush stroke could not be started.'
        );
        return false;
      }
    },
    move: (pointerId, point) => {
      const update = gesture.move(pointerId, point);
      if (!update) return false;
      paintScheduler.schedule(update);
      return true;
    },
    finish: (pointerId) => {
      const finished = gesture.finish(pointerId);
      if (!finished) return false;
      if (finished.dabs.length) paintScheduler.schedule({
        target: finished.target,
        dabs: finished.dabs
      });
      paintScheduler.flush();
      activeBrush = null;
      activeOperator = null;
      const dependencies = resolveDependencies();
      const renderer = dependencies.getRenderer();
      const before = dependencies.getDocument();
      if (!renderer || !before || !finished.dirtyBounds) {
        renderer?.cancelPixelEdit();
        renderer?.endSampledBrushStroke();
        renderer?.setPaintInteractionActive(false);
        return true;
      }
      const dirtyBounds = clipDirtyBoundsToDocument(finished.dirtyBounds, before);
      if (!dirtyBounds) {
        renderer.cancelPixelEdit();
        renderer.endSampledBrushStroke();
        renderer.setPaintInteractionActive(false);
        return true;
      }
      const after = finished.target.channel === 'mask'
        ? markLayerMaskPixelsChanged(
            before,
            finished.target.layerId,
            dirtyBounds
          )
        : markLayerPixelsChanged(
            before,
            finished.target.layerId,
            dirtyBounds
          );
      const pixelEdit = renderer.finishPixelEdit();
      renderer.endSampledBrushStroke();
      if (!pixelEdit) {
        renderer.cancelPixelEdit();
        renderer.setPaintInteractionActive(false);
        return true;
      }
      renderer.setPaintInteractionActive(false);
      dependencies.applyDocumentSnapshot(after);
      dependencies.pushHistoryEntry({
        byteSize: pixelEdit.byteSize,
        layerIds: [finished.target.layerId],
        undo: () => {
          const latest = resolveDependencies();
          if (!latest.getRenderer()?.applyPixelHistory(pixelEdit, 'undo')) {
            throw new Error('Brush undo is no longer available.');
          }
          latest.applyDocumentSnapshot(before);
        },
        redo: () => {
          const latest = resolveDependencies();
          if (!latest.getRenderer()?.applyPixelHistory(pixelEdit, 'redo')) {
            throw new Error('Brush redo is no longer available.');
          }
          latest.applyDocumentSnapshot(after);
        },
        dispose: pixelEdit.destroy
      });
      return true;
    },
    cancel: (pointerId) => {
      if (!gesture.cancel(pointerId)) return false;
      paintScheduler.cancel();
      activeBrush = null;
      activeOperator = null;
      const renderer = resolveDependencies().getRenderer();
      const pixelEdit = renderer?.finishPixelEdit();
      if (pixelEdit) {
        renderer?.applyPixelHistory(pixelEdit, 'undo');
        pixelEdit.destroy();
      } else {
        renderer?.cancelPixelEdit();
      }
      renderer?.setPaintInteractionActive(false);
      renderer?.endSampledBrushStroke();
      return true;
    },
    reset,
  };
};

export const usePaintSessionController = (
  dependencies: PaintSessionDependencies,
  gesture?: PaintGestureController
): PaintSessionController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  return useMemo(
    () => createPaintSessionController(
      () => dependenciesRef.current,
      gesture,
      {
        request: (callback) => window.requestAnimationFrame(callback),
        cancel: (handle) => window.cancelAnimationFrame(handle)
      }
    ),
    [gesture]
  );
};
