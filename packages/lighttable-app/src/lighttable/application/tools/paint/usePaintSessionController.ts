import { useMemo, useRef } from 'react';
import {
  setRasterLayerDocumentSurface,
  markLayerMaskPixelsChanged,
  markLayerPixelsChanged
} from '../../../editor/document/documentCommands';
import type {
  ImageDocument,
  LayerId,
  LayerNode,
  Rect
} from '../../../editor/document/documentTypes';
import { findRasterLayer } from '../../../editor/document/layerTree';
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
import type {
  PaintBrushStrokePlan,
  SampledBrushStrokePlan
} from '../../../editor/tools/paint/sampledBrushTypes';
import {
  createImmediatePaintDabScheduler,
  createPaintDabScheduler,
  type PaintDabScheduler,
  type PaintFramePort
} from './paintDabScheduler';
import { commitAppliedPixelMutation } from '../../commands/pixelMutationTransaction';
import type {
  DocumentMutationCloseReason,
  DocumentMutationController,
  DocumentMutationTransaction
} from '../../documents/useDocumentMutationController';

export interface PaintHistoryEntry {
  label: string;
  type: string;
  byteSize: number;
  layerIds: readonly LayerId[];
  undo(): void;
  redo(): void;
  dispose(): void;
}

export interface PaintSessionRendererPort {
  setPaintInteractionActive(active: boolean, layerId?: LayerId): void;
  beginBrushStroke(layer: LayerNode, channel: PaintChannel): void;
  prepareRasterPaintSurface?(layer: Extract<LayerNode, { type: 'raster' }>): ReversiblePixelEdit | null;
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
    operator?: PaintBrushStrokePlan
  ): void;
  finishPixelEdit(): ReversiblePixelEdit | null;
  cancelPixelEdit(): void;
  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
}

export interface PaintSessionDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): PaintSessionRendererPort | null;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushHistoryEntry(entry: PaintHistoryEntry): void;
  setError(message: string | null): void;
  onStrokeCommitted?(stroke: {
    readonly target: PaintGestureTarget;
    readonly brush: BrushSettings;
    readonly operator?: PaintBrushStrokePlan;
    readonly samples: readonly BrushPoint[];
  }): void;
}

export interface BeginPaintSession {
  pointerId: number;
  layer: LayerNode;
  target: PaintGestureTarget;
  brush: BrushSettings;
  point: BrushPoint;
  /** Document-to-screen scale used to keep large-tip spacing visually continuous. */
  displayScale?: number;
  operator?: PaintBrushStrokePlan;
  recordSemanticCommit?: boolean;
}

export interface PaintSessionController {
  get active(): boolean;
  owns(pointerId: number): boolean;
  begin(request: BeginPaintSession): boolean;
  move(pointerId: number, point: BrushPoint): boolean;
  moveMany(pointerId: number, points: readonly BrushPoint[]): boolean;
  finish(pointerId: number): boolean;
  cancel(pointerId: number): boolean;
  reset(): void;
}

const cloneBrush = (brush: BrushSettings): BrushSettings => ({ ...brush });
const cloneOperator = (operator: PaintBrushStrokePlan): PaintBrushStrokePlan =>
  operator.operator === 'tone' ? { ...operator } : ({
    ...operator,
    source: { ...operator.source, point: { ...operator.source.point } },
    sourceOffset: { ...operator.sourceOffset }
  });

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
  let activeOperator: PaintBrushStrokePlan | null = null;
  let recordedStroke: {
    target: PaintGestureTarget;
    brush: BrushSettings;
    operator?: PaintBrushStrokePlan;
    samples: BrushPoint[];
    byteLength: number;
    overflowed: boolean;
  } | null = null;
  let activeDocument: DocumentMutationTransaction | null = null;
  let preparedSurface: {
    readonly edit: ReversiblePixelEdit;
  } | null = null;
  let rendererEditStarted = false;
  let rendererEditClosed = false;
  let sampledStrokeStarted = false;
  let sampledStrokeClosed = false;
  let specializedCommitOwnsGpuState = false;
  const captureSamples = (points: readonly BrushPoint[]) => {
    if (!recordedStroke || recordedStroke.overflowed) return;
    const addedBytes = points.reduce((total, point) => total + JSON.stringify(point).length, 0);
    if (recordedStroke.samples.length + points.length > 4096
      || recordedStroke.byteLength + addedBytes > 220 * 1024) {
      recordedStroke.overflowed = true;
      recordedStroke.samples = [];
      return;
    }
    recordedStroke.samples.push(...points.map((point) => ({ ...point })));
    recordedStroke.byteLength += addedBytes;
  };

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

  const rollbackPreparedSurface = () => {
    if (!preparedSurface) return;
    preparedSurface.edit.undo();
    preparedSurface.edit.destroy();
    preparedSurface = null;
  };

  const closePaintInteraction = (_reason: DocumentMutationCloseReason) => {
    const dependencies = resolveDependencies();
    const renderer = dependencies.getRenderer();
    paintScheduler.cancel();
    if (!specializedCommitOwnsGpuState && !rendererEditClosed) {
      if (!rendererEditStarted) {
        renderer?.cancelPixelEdit();
      } else {
        const edit = renderer?.finishPixelEdit() ?? null;
        rendererEditClosed = true;
        if (edit) {
          renderer?.applyPixelHistory(edit, 'undo');
          edit.destroy();
        } else {
          renderer?.cancelPixelEdit();
        }
      }
    }
    if (!specializedCommitOwnsGpuState) rollbackPreparedSurface();
    renderer?.setPaintInteractionActive(false);
    if (sampledStrokeStarted && !sampledStrokeClosed) renderer?.endSampledBrushStroke();
    gesture.reset();
    activeBrush = null;
    activeOperator = null;
    recordedStroke = null;
    activeDocument = null;
    rendererEditStarted = false;
    rendererEditClosed = false;
    sampledStrokeStarted = false;
    sampledStrokeClosed = false;
    specializedCommitOwnsGpuState = false;
  };

  const reset = () => {
    const transaction = activeDocument;
    if (transaction?.active) {
      transaction.cancel();
      return;
    }
    closePaintInteraction('cancel');
  };

  return {
    get active() {
      return gesture.active;
    },
    owns: (pointerId) => gesture.owns(pointerId),
    begin: ({ pointerId, layer, target, brush, point, displayScale = 1, operator,
      recordSemanticCommit = false }) => {
      const dependencies = resolveDependencies();
      const renderer = dependencies.getRenderer();
      if (!renderer) return false;
      try {
        let paintLayer = layer;
        let paintTarget = target;
        const document = dependencies.getDocument();
        if (!document) throw new Error('The paint document is not available.');
        const transaction = dependencies.documentMutations.begin(
          'tool.paint',
          {
            label: target.channel === 'mask' ? 'Brush Tool on Layer Mask' : 'Brush Tool',
            type: target.channel === 'mask' ? 'paint.mask.stroke' : 'paint.stroke',
            layerIds: [target.layerId]
          },
          closePaintInteraction,
          'cancel'
        );
        if (!transaction) throw new Error('The paint document is not available.');
        activeDocument = transaction;
        rendererEditStarted = false;
        rendererEditClosed = false;
        sampledStrokeStarted = false;
        sampledStrokeClosed = false;
        specializedCommitOwnsGpuState = false;
        if (target.channel === 'pixels' && layer.type === 'raster' && document) {
          const surfaceEdit = renderer.prepareRasterPaintSurface?.(layer) ?? null;
          if (surfaceEdit) {
            const preparedDocument = setRasterLayerDocumentSurface(
              document,
              layer.id,
              document.width,
              document.height
            );
            const preparedLayer = findRasterLayer(preparedDocument, layer.id);
            if (!preparedLayer) {
              surfaceEdit.undo();
              surfaceEdit.destroy();
              throw new Error('The raster layer could not be prepared for painting.');
            }
            preparedSurface = {
              edit: surfaceEdit
            };
            if (!transaction.change(() => preparedDocument)) {
              rollbackPreparedSurface();
              throw new Error('The raster paint surface could not be projected.');
            }
            paintLayer = preparedLayer;
            paintTarget = {
              ...target,
              sourceToDocument: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
            };
          }
        }
        renderer.setPaintInteractionActive(true, paintLayer.id);
        renderer.beginBrushStroke(paintLayer, paintTarget.channel);
        rendererEditStarted = true;
        if (operator && operator.operator !== 'tone') {
          renderer.beginSampledBrushStroke(operator);
          sampledStrokeStarted = true;
        }
        activeBrush = cloneBrush(brush);
        activeOperator = operator ?? null;
        recordedStroke = recordSemanticCommit ? {
          target: { ...paintTarget, sourceToDocument: { ...paintTarget.sourceToDocument } },
          brush: cloneBrush(brush),
          ...(operator ? { operator: cloneOperator(operator) } : {}),
          samples: [{ ...point }],
          byteLength: 512 + JSON.stringify(point).length,
          overflowed: false
        } : null;
        paintScheduler.schedule(gesture.begin(pointerId, paintTarget, {
          ...activeBrush,
          maximumSpacingPx: Math.max(0.5, 1.5 / Math.max(displayScale, 0.01))
        }, point));
        dependencies.setError(null);
        return true;
      } catch (reason) {
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
      const update = gesture.moveMany(pointerId, [point]);
      if (!update) return false;
      captureSamples([point]);
      paintScheduler.schedule(update);
      return true;
    },
    moveMany: (pointerId, points) => {
      const update = gesture.moveMany(pointerId, points);
      if (!update) return false;
      captureSamples(points);
      paintScheduler.schedule(update);
      return true;
    },
    finish: (pointerId) => {
      const finished = gesture.finish(pointerId);
      if (!finished) return false;
      const completedRecording = recordedStroke;
      recordedStroke = null;
      if (finished.dabs.length) paintScheduler.schedule({
        target: finished.target,
        dabs: finished.dabs
      });
      paintScheduler.flush();
      activeBrush = null;
      activeOperator = null;
      const dependencies = resolveDependencies();
      const renderer = dependencies.getRenderer();
      const canonicalDocument = dependencies.getDocument();
      const transaction = activeDocument;
      const workingDocument = transaction?.current ?? null;
      if (!renderer || !canonicalDocument || !workingDocument || !transaction?.active
        || canonicalDocument.id !== transaction.documentId
        || !finished.dirtyBounds) {
        transaction?.cancel();
        if (!transaction) closePaintInteraction('cancel');
        return true;
      }
      const dirtyBounds = clipDirtyBoundsToDocument(finished.dirtyBounds, workingDocument);
      if (!dirtyBounds) {
        transaction.cancel();
        return true;
      }
      const after = finished.target.channel === 'mask'
        ? markLayerMaskPixelsChanged(
            workingDocument,
            finished.target.layerId,
            dirtyBounds
          )
        : markLayerPixelsChanged(
            workingDocument,
            finished.target.layerId,
            dirtyBounds
          );
      if (!transaction.stage(() => after)) {
        transaction.cancel();
        return true;
      }
      let committed = false;
      try {
        committed = transaction.commitWith((before, stagedAfter) => {
          const pixelEdit = renderer.finishPixelEdit();
          rendererEditClosed = true;
          if (sampledStrokeStarted && !sampledStrokeClosed) {
            renderer.endSampledBrushStroke();
            sampledStrokeClosed = true;
          }
          if (!pixelEdit) {
            renderer.cancelPixelEdit();
            return false;
          }
          const surfaceEdit = preparedSurface?.edit ?? null;
          preparedSurface = null;
          specializedCommitOwnsGpuState = true;
          commitAppliedPixelMutation(() => resolveDependencies(), {
            operation: 'Brush Tool',
            label: finished.target.channel === 'mask' ? 'Brush Tool on Layer Mask' : 'Brush Tool',
            type: finished.target.channel === 'mask' ? 'paint.mask.stroke' : 'paint.stroke',
            layerIds: [finished.target.layerId],
            before,
            after: stagedAfter,
            edits: surfaceEdit ? [surfaceEdit, pixelEdit] : [pixelEdit]
          });
          return true;
        });
      } catch (reason) {
        dependencies.setError(
          reason instanceof Error ? reason.message : 'The brush stroke did not complete.'
        );
        return true;
      }
      if (committed && completedRecording && !completedRecording.overflowed) {
        dependencies.onStrokeCommitted?.({
          target: completedRecording.target,
          brush: completedRecording.brush,
          ...(completedRecording.operator ? { operator: completedRecording.operator } : {}),
          samples: completedRecording.samples
        });
      }
      return true;
    },
    cancel: (pointerId) => {
      if (!gesture.cancel(pointerId)) return false;
      const transaction = activeDocument;
      if (transaction?.active) transaction.cancel();
      else closePaintInteraction('cancel');
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
