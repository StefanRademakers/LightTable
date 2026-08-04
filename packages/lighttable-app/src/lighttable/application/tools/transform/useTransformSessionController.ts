import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ImageDocument,
  LayerId
} from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';
import type {
  AffineMatrix,
  TransformQuad,
  TransformSessionState
} from '../../../editor/tools/transform/transformTypes';
import {
  TransformController,
  type TransformRendererPort
} from './transformController';
import { duplicateLayer, setLayerTransform } from '../../../editor/document/documentCommands';
import { findDocumentLayer } from '../../../editor/document/layerTree';
import { matrixApproximatelyEqual, multiplyMatrices, identityMatrix } from '../../../editor/tools/transform/affine';

export interface TransformEditorRendererPort extends TransformRendererPort {
  setDocument(document: ImageDocument): void;
  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
}

export interface TransformHistoryEntry {
  byteSize: number;
  layerIds: readonly LayerId[];
  undo(): void;
  redo(): void;
  dispose(): void;
}

export interface TransformSessionDependencies {
  activeTool: string;
  activeDocument: ImageDocument | null;
  activeLayerId: LayerId | null;
  selection: SelectionOperation[];
  getDocument(): ImageDocument | null;
  getRenderer(): TransformEditorRendererPort | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  applyDocumentAndSelection(
    document: ImageDocument,
    selection: SelectionOperation[]
  ): void;
  pushDocumentHistory(before: ImageDocument, after: ImageDocument): void;
  pushHistoryEntry(entry: TransformHistoryEntry): void;
  activateViewTool(): void;
  setError(message: string | null): void;
  setStatus(message: string): void;
}

export interface TransformSessionController {
  state: TransformSessionState | null;
  update(matrix: AffineMatrix): void;
  updateProjective(quad: TransformQuad): void;
  commit(): void;
  cancel(): void;
  reset(): void;
  isActive(): boolean;
  repeat(duplicate?: boolean): void;
  nudge(x: number, y: number): void;
  setDuplicate(duplicate: boolean): void;
}

/**
 * React adapter for the renderer-backed transform transaction.
 *
 * The low-level TransformController owns preview pixels and transform math.
 * This adapter owns the editor transaction: document publication, selection
 * publication and exactly one history entry when a transform is committed.
 */
export const useTransformSessionController = (
  dependencies: TransformSessionDependencies
): TransformSessionController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const controllerRef = useRef<TransformController | null>(null);
  const controllerDocumentIdRef = useRef<ImageDocument['id'] | null>(null);
  const [state, setState] = useState<TransformSessionState | null>(null);
  const lastLayerTransformRef = useRef<AffineMatrix | null>(null);

  const isActive = useCallback(
    () => Boolean(controllerRef.current?.state),
    []
  );

  const applyFinishedTransform = useCallback((
    result: ReturnType<TransformController['finish']>
  ) => {
    if (result.kind === 'cancelled' || result.kind === 'unchanged') return;
    const current = dependenciesRef.current;
    if (result.kind === 'error') {
      current.setError(result.message);
      return;
    }
    if (result.kind === 'layer') {
      if (result.afterDocument !== result.beforeDocument) {
        current.applyDocumentSnapshot(result.afterDocument);
        current.pushDocumentHistory(result.beforeDocument, result.afterDocument);
      }
      return;
    }

    const {
      beforeDocument,
      afterDocument,
      beforeSelection,
      afterSelection,
      layerId,
      pixelEdit
    } = result;
    current.applyDocumentAndSelection(afterDocument, afterSelection);
    current.pushHistoryEntry({
      byteSize: pixelEdit.byteSize,
      layerIds: [layerId],
      undo: () => {
        const latest = dependenciesRef.current;
        if (!latest.getRenderer()?.applyPixelHistory(pixelEdit, 'undo')) {
          throw new Error('Transform undo is no longer available.');
        }
        latest.applyDocumentAndSelection(beforeDocument, beforeSelection);
      },
      redo: () => {
        const latest = dependenciesRef.current;
        if (!latest.getRenderer()?.applyPixelHistory(pixelEdit, 'redo')) {
          throw new Error('Transform redo is no longer available.');
        }
        latest.applyDocumentAndSelection(afterDocument, afterSelection);
      },
      dispose: pixelEdit.destroy
    });
  }, []);

  const finish = useCallback((commit: boolean) => {
    const controller = controllerRef.current;
    if (!controller?.state) return;
    const current = dependenciesRef.current;
    const document = current.getDocument();
    const belongsToActiveDocument = Boolean(
      document && document.id === controllerDocumentIdRef.current
    );
    const transformDelta = controller.state?.matrix ?? null;
    const result = controller.finish(
      belongsToActiveDocument ? document : null,
      belongsToActiveDocument ? current.selection : [],
      commit && belongsToActiveDocument
    );
    controllerDocumentIdRef.current = null;
    setState(null);
    current.activateViewTool();
    if (commit && result.kind === 'layer' && transformDelta
      && !matrixApproximatelyEqual(transformDelta, identityMatrix())) {
      lastLayerTransformRef.current = { ...transformDelta };
    }
    applyFinishedTransform(result);
  }, [applyFinishedTransform]);

  const reset = useCallback(() => {
    const controller = controllerRef.current;
    controller?.invalidatePendingLaunch();
    if (controller?.state) {
      controller.finish(dependenciesRef.current.getDocument(), [], false);
    }
    controllerRef.current = null;
    controllerDocumentIdRef.current = null;
    setState(null);
  }, []);

  const begin = useCallback(async () => {
    const current = dependenciesRef.current;
    const document = current.getDocument();
    const renderer = current.getRenderer();
    if (!document || !renderer) {
      current.setError('Select a raster layer before transforming.');
      current.activateViewTool();
      return;
    }
    const controller = controllerRef.current ?? new TransformController(renderer);
    controllerRef.current = controller;
    controllerDocumentIdRef.current = document.id;
    const result = await controller.begin(document, current.selection);
    if (result.ok) {
      setState(result.state);
      current.setError(null);
      if (result.notice) current.setStatus(result.notice);
      return;
    }
    if (result.code === 'stale' || result.code === 'already-active') return;
    if (result.message) current.setError(result.message);
    current.activateViewTool();
  }, []);

  const update = useCallback((matrix: AffineMatrix) => {
    const next = controllerRef.current?.update(matrix);
    if (next) setState(next);
  }, []);

  const updateProjective = useCallback((quad: TransformQuad) => {
    const next = controllerRef.current?.updateProjective(quad);
    if (next) setState(next);
  }, []);

  const nudge = useCallback((x: number, y: number) => {
    const controller = controllerRef.current;
    const current = controller?.state;
    if (!controller || !current) return;
    if (current.projectiveQuad) {
      const next = current.projectiveQuad.map((point) => ({
        x: point.x + x,
        y: point.y + y
      })) as unknown as TransformQuad;
      const updated = controller.updateProjective(next);
      if (updated) setState(updated);
      return;
    }
    const updated = controller.update(multiplyMatrices(
      { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y },
      current.matrix
    ));
    if (updated) setState(updated);
  }, []);

  const repeat = useCallback((duplicate = false) => {
    const delta = lastLayerTransformRef.current;
    const current = dependenciesRef.current;
    const before = current.getDocument();
    if (!delta || !before?.activeLayerId) {
      current.setError('There is no previous layer transform to repeat.');
      return;
    }
    const withTarget = duplicate ? duplicateLayer(before, before.activeLayerId) : before;
    const target = findDocumentLayer(withTarget, withTarget.activeLayerId);
    if (!target) {
      current.setError('The active layer can no longer be transformed.');
      return;
    }
    const after = setLayerTransform(
      withTarget,
      target.id,
      multiplyMatrices(delta, target.transform)
    );
    current.applyDocumentSnapshot(after);
    current.pushDocumentHistory(before, after);
    current.setError(null);
  }, []);

  useEffect(() => {
    const controller = controllerRef.current;
    if (
      controllerDocumentIdRef.current
      && controllerDocumentIdRef.current !== dependencies.activeDocument?.id
    ) {
      controller?.invalidatePendingLaunch();
      if (controller?.state) controller.finish(null, [], false);
      controllerRef.current = null;
      controllerDocumentIdRef.current = null;
      setState(null);
    }
    const activeController = controllerRef.current;
    if (dependencies.activeTool !== 'transform') {
      activeController?.invalidatePendingLaunch();
      if (activeController?.state) finish(true);
      return;
    }
    if (
      activeController?.state
      && activeController.state.layerId !== dependencies.activeLayerId
    ) {
      finish(true);
      return;
    }
    void begin();
  }, [
    begin,
    dependencies.activeDocument?.id,
    dependencies.activeLayerId,
    dependencies.activeTool,
    finish
  ]);

  useEffect(() => () => {
    const controller = controllerRef.current;
    controller?.invalidatePendingLaunch();
    if (controller?.state) controller.finish(null, [], false);
    controllerRef.current = null;
    controllerDocumentIdRef.current = null;
  }, []);

  return {
    state,
    update,
    updateProjective,
    commit: () => finish(true),
    cancel: () => finish(false),
    reset,
    isActive,
    repeat,
    nudge,
    setDuplicate: (duplicate) => {
      if (controllerRef.current?.setDuplicate(duplicate)) {
        const next = controllerRef.current.state;
        if (next) setState(next);
      }
    }
  };
};
