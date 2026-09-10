import { useEffect, useMemo, useRef } from 'react';
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
import {
  reserveAppliedPixelMutation,
  type AppliedPixelMutationReservation,
  UnpublishedPixelRollbackOwner
} from '../../commands/pixelMutationTransaction';
import type {
  DocumentHistoryAdmissionBarrier,
  DocumentHistoryReservation
} from '../../commands/documentCommandHistory';
import type {
  DocumentMutationCloseReason,
  DocumentMutationController,
  DocumentMutationTransaction
} from '../../documents/useDocumentMutationController';
import { PaintStrokeRecorder } from './PaintStrokeRecorder';

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
  reserveHistoryEntry(entry: PaintHistoryEntry): DocumentHistoryReservation;
  acquireHistoryAdmissionBarrier(): DocumentHistoryAdmissionBarrier;
  getSelectionRevision(): number;
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
  const strokeRecorder = new PaintStrokeRecorder();
  let activeDocument: DocumentMutationTransaction | null = null;
  let activeRenderer: PaintSessionRendererPort | null = null;
  let preparedSurface: {
    readonly edit: ReversiblePixelEdit;
  } | null = null;
  let rendererEditStarted = false;
  let rendererEditClosed = false;
  let sampledStrokeStarted = false;
  let sampledStrokeClosed = false;
  let specializedCommitOwnsGpuState = false;
  let activeSelectionRevision: number | null = null;
  let activeHistoryBarrier: DocumentHistoryAdmissionBarrier | null = null;
  let activeHistoryPublication: AppliedPixelMutationReservation | null = null;
  const rollbackOwner = new UnpublishedPixelRollbackOwner();
  let terminalCleanupError: string | null = null;
  const paint = (update: PaintGestureUpdate) => {
    if (!update.dabs.length || !activeBrush) return;
    const dependencies = resolveDependencies();
    if (activeSelectionRevision !== null
      && dependencies.getSelectionRevision() !== activeSelectionRevision) {
      activeDocument?.cancel();
      if (!terminalCleanupError) {
        dependencies.setError('The selection changed during the brush stroke; the stroke was cancelled.');
      }
      return;
    }
    const renderer = activeRenderer;
    if (!renderer || dependencies.getRenderer() !== renderer) {
      activeDocument?.cancel();
      if (!terminalCleanupError) {
        dependencies.setError(
          'The document renderer changed during the brush stroke; the stroke was cancelled.'
        );
      }
      return;
    }
    const preset = resolveBrushPreset(activeBrush.presetId);
    try {
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
    } catch (reason) {
      activeDocument?.cancel();
      if (!terminalCleanupError) {
        dependencies.setError(
          reason instanceof Error ? reason.message : 'The brush stroke could not be rendered.'
        );
      }
    }
  };
  const paintScheduler: PaintDabScheduler = frame
    ? createPaintDabScheduler(frame, paint)
    : createImmediatePaintDabScheduler(paint);

  const rollbackPreparedSurface = () => {
    if (!preparedSurface) return true;
    const current = preparedSurface;
    const rollback = rollbackOwner.rollback(
      (edit, direction) => direction === 'undo' ? edit.undo() : edit.redo(),
      [current.edit]
    );
    if (rollback.ok) preparedSurface = null;
    return rollback.ok;
  };

  const closePaintInteraction = (_reason: DocumentMutationCloseReason) => {
    const dependencies = resolveDependencies();
    const renderer = activeRenderer;
    terminalCleanupError = null;
    const cleanupFailure = (reason: unknown, fallback: string) => {
      terminalCleanupError ??= reason instanceof Error ? reason.message : fallback;
    };
    try {
      paintScheduler.cancel();
    } catch (reason) {
      cleanupFailure(reason, 'Pending brush work could not be cancelled.');
    }
    activeHistoryBarrier?.release();
    activeHistoryBarrier = null;
    activeHistoryPublication?.cancel();
    activeHistoryPublication = null;
    let pixelEdit: ReversiblePixelEdit | null = null;
    if (!specializedCommitOwnsGpuState && !rendererEditClosed) {
      if (!rendererEditStarted) {
        try {
          renderer?.cancelPixelEdit();
        } catch (reason) {
          cleanupFailure(reason, 'The unopened pixel edit could not be cancelled.');
        }
      } else {
        rendererEditClosed = true;
        try {
          pixelEdit = renderer?.finishPixelEdit() ?? null;
        } catch (reason) {
          cleanupFailure(reason, 'The pixel edit could not be closed.');
        }
        if (!pixelEdit) {
          try {
            renderer?.cancelPixelEdit();
          } catch (reason) {
            cleanupFailure(reason, 'The pixel edit could not be cancelled.');
          }
        }
      }
    }
    if (!specializedCommitOwnsGpuState && renderer) {
      const surfaceEdit = preparedSurface?.edit ?? null;
      const edits = [
        ...(surfaceEdit ? [surfaceEdit] : []),
        ...(pixelEdit ? [pixelEdit] : [])
      ];
      const rollback = rollbackOwner.rollback(
        (edit, direction) => edit === surfaceEdit
          ? direction === 'undo' ? edit.undo() : edit.redo()
          : renderer.applyPixelHistory(edit, direction),
        edits
      );
      if (rollback.ok) preparedSurface = null;
      else cleanupFailure(
        null,
        rollback.compensationFailed
          ? 'The brush rollback and its compensation both failed; painting is quarantined.'
          : 'The brush stroke was canceled, but its GPU rollback could not be completed.'
      );
    } else if (!specializedCommitOwnsGpuState && !rollbackPreparedSurface()) {
      cleanupFailure(null, 'The prepared paint surface could not be rolled back.');
    }
    try {
      renderer?.setPaintInteractionActive(false);
    } catch (reason) {
      cleanupFailure(reason, 'Interactive paint quality could not be released.');
    }
    if (sampledStrokeStarted && !sampledStrokeClosed) {
      sampledStrokeClosed = true;
      try {
        renderer?.endSampledBrushStroke();
      } catch (reason) {
        cleanupFailure(reason, 'The sampled brush source could not be released.');
      }
    }
    try {
      gesture.reset();
    } catch (reason) {
      cleanupFailure(reason, 'The paint gesture could not be reset.');
    }
    activeBrush = null;
    activeOperator = null;
    strokeRecorder.reset();
    activeDocument = null;
    activeRenderer = null;
    rendererEditStarted = false;
    rendererEditClosed = false;
    sampledStrokeStarted = false;
    sampledStrokeClosed = false;
    specializedCommitOwnsGpuState = false;
    activeSelectionRevision = null;
    if (terminalCleanupError) dependencies.setError(terminalCleanupError);
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
      const recovery = rollbackOwner.retry();
      if (recovery && !recovery.ok) {
        dependencies.setError(
          'Painting is blocked until the previous GPU rollback can be recovered.'
        );
        return false;
      }
      if (recovery?.ok) preparedSurface = null;
      terminalCleanupError = null;
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
        activeRenderer = renderer;
        activeHistoryBarrier = dependencies.acquireHistoryAdmissionBarrier();
        activeSelectionRevision = dependencies.getSelectionRevision();
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
        strokeRecorder.begin(
          recordSemanticCommit, paintTarget, brush, point, operator
        );
        paintScheduler.schedule(gesture.begin(pointerId, paintTarget, {
          ...activeBrush,
          maximumSpacingPx: Math.max(0.5, 1.5 / Math.max(displayScale, 0.01))
        }, point));
        if (!activeDocument?.active) return false;
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
      strokeRecorder.capture([point]);
      paintScheduler.schedule(update);
      return true;
    },
    moveMany: (pointerId, points) => {
      const update = gesture.moveMany(pointerId, points);
      if (!update) return false;
      strokeRecorder.capture(points);
      paintScheduler.schedule(update);
      return true;
    },
    finish: (pointerId) => {
      const finished = gesture.finish(pointerId);
      if (!finished) return false;
      const completedRecording = strokeRecorder.take();
      if (finished.dabs.length) paintScheduler.schedule({
        target: finished.target,
        dabs: finished.dabs
      });
      paintScheduler.flush();
      activeBrush = null;
      activeOperator = null;
      const dependencies = resolveDependencies();
      const renderer = activeRenderer;
      const canonicalDocument = dependencies.getDocument();
      const transaction = activeDocument;
      const workingDocument = transaction?.current ?? null;
      if (!renderer || dependencies.getRenderer() !== renderer
        || !canonicalDocument || !workingDocument || !transaction?.active
        || canonicalDocument.id !== transaction.documentId
        || (activeSelectionRevision !== null
          && dependencies.getSelectionRevision() !== activeSelectionRevision)
        || !finished.dirtyBounds) {
        transaction?.cancel();
        if (!transaction) closePaintInteraction('cancel');
        return false;
      }
      const dirtyBounds = clipDirtyBoundsToDocument(finished.dirtyBounds, workingDocument);
      if (!dirtyBounds) {
        transaction.cancel();
        return false;
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
        return false;
      }
      let committed = false;
      try {
        committed = transaction.commitWith((before, stagedAfter) => {
          activeHistoryBarrier?.release();
          activeHistoryBarrier = null;
          const label = finished.target.channel === 'mask'
            ? 'Brush Tool on Layer Mask' : 'Brush Tool';
          const type = finished.target.channel === 'mask'
            ? 'paint.mask.stroke' : 'paint.stroke';
          activeHistoryPublication = reserveAppliedPixelMutation(() => resolveDependencies(), {
            label, type, layerIds: [finished.target.layerId]
          });
          const pixelEdit = renderer.finishPixelEdit();
          rendererEditClosed = true;
          if (!pixelEdit) {
            activeHistoryPublication.cancel();
            activeHistoryPublication = null;
            renderer.cancelPixelEdit();
            return false;
          }
          const surfaceEdit = preparedSurface?.edit ?? null;
          specializedCommitOwnsGpuState = true;
          activeHistoryPublication.commit({
            operation: 'Brush Tool',
            label,
            type,
            layerIds: [finished.target.layerId],
            before,
            after: stagedAfter,
            edits: surfaceEdit ? [surfaceEdit, pixelEdit] : [pixelEdit]
          });
          activeHistoryPublication = null;
          preparedSurface = null;
          if (sampledStrokeStarted && !sampledStrokeClosed) {
            sampledStrokeClosed = true;
            try {
              renderer.endSampledBrushStroke();
            } catch (reason) {
              console.error('Sampled brush cleanup failed after durable paint commit.', reason);
              dependencies.setError('The stroke committed, but its sampled source cleanup failed.');
            }
          }
          return true;
        });
      } catch (reason) {
        dependencies.setError(
          reason instanceof Error ? reason.message : 'The brush stroke did not complete.'
        );
        return false;
      }
      if (committed && completedRecording) {
        dependencies.onStrokeCommitted?.({
          target: completedRecording.target,
          brush: completedRecording.brush,
          ...(completedRecording.operator ? { operator: completedRecording.operator } : {}),
          samples: completedRecording.samples
        });
      }
      return committed;
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
  const controller = useMemo(
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
  useEffect(() => () => controller.reset(), [controller]);
  return controller;
};
