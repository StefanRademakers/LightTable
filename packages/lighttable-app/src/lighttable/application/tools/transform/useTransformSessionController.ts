import { useCallback, useEffect, useRef, useState } from 'react';
import {
  layerIsLocked,
  type ImageDocument,
  type LayerId,
  type RasterLayer
} from '../../../editor/document/documentTypes';
import type { PaintChannel } from '../../../editor/session/editorSession';
import type { SelectionCoverageBounds } from '../../../editor/selection/selectionCoverage';
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
import {
  duplicateLayer,
  setLayerMaskTransform,
  setLayerTransform
} from '../../../editor/document/documentCommands';
import { findDocumentLayer } from '../../../editor/document/layerTree';
import {
  matrixApproximatelyEqual,
  multiplyMatrices,
  identityMatrix,
  aroundPoint,
  rotationMatrix,
  scaleMatrix,
  transformedBounds
} from '../../../editor/tools/transform/affine';
import { layerDocumentSnapBounds } from '../snapping/layerSnapGeometry';
import { unionSnapRects } from '../snapping/snapEngine';
import {
  topLevelTransformLayerIds,
  transformLayerGroupInDocumentSpace
} from '../snapping/groupLayerTransform';
import {
  alignTransformFrameToDocument,
  transformSessionFrame,
  type TransformFrameMode,
  type TransformSessionFrame
} from '../../../editor/tools/transform/transformSessionFrame';

export interface TransformEditorRendererPort extends TransformRendererPort {
  setDocument(document: ImageDocument): void;
  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
  measureLayerMaskContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null>;
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
  activeChannel: PaintChannel;
  selectedLayerIds?: readonly LayerId[];
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
  setError(message: string | null): void;
  setStatus(message: string): void;
  transformFrameMode?: TransformFrameMode;
  onLayerTransformCommitted?(layerId: LayerId, transform: AffineMatrix): void;
}

export interface TransformSessionController {
  state: TransformSessionState | null;
  frameOverride: TransformSessionFrame | null;
  begin(): void;
  update(matrix: AffineMatrix): void;
  updateProjective(quad: TransformQuad): void;
  checkpoint(): void;
  alignFrameToDocument(): void;
  commit(): void;
  cancel(): void;
  reset(): void;
  isActive(): boolean;
  repeat(duplicate?: boolean): void;
  nudge(x: number, y: number): void;
  setDuplicate(duplicate: boolean): void;
  applyFixed(operation: FixedTransformOperation): Promise<FixedTransformTarget | null>;
}

export type FixedTransformOperation =
  | 'rotate-180' | 'rotate-clockwise-90' | 'rotate-counter-clockwise-90'
  | 'flip-horizontal' | 'flip-vertical';

export type FixedTransformTarget = 'selection' | 'mask' | 'layer' | 'layer-group';

/**
 * React adapter for the renderer-backed transform transaction.
 *
 * The low-level TransformController owns preview pixels and transform math.
 * This adapter owns document/selection publication and gesture checkpoints.
 * Pointer-up publishes one durable history entry while a continuation frame
 * keeps the user-facing local transform space alive until explicit confirmation.
 */
export const useTransformSessionController = (
  dependencies: TransformSessionDependencies
): TransformSessionController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const controllerRef = useRef<TransformController | null>(null);
  const controllerDocumentIdRef = useRef<ImageDocument['id'] | null>(null);
  const [state, setState] = useState<TransformSessionState | null>(null);
  const [frameOverride, setFrameOverrideState] = useState<TransformSessionFrame | null>(null);
  const frameOverrideRef = useRef<TransformSessionFrame | null>(null);
  const continuationFrameRef = useRef<TransformSessionFrame | null>(null);
  const setFrameOverride = useCallback((frame: TransformSessionFrame | null) => {
    frameOverrideRef.current = frame;
    setFrameOverrideState(frame);
  }, []);
  const selectedLayerKey = (dependencies.selectedLayerIds ?? []).join('\u0000');
  const automaticLaunchKeyRef = useRef<string | null>(null);
  const lastLayerTransformRef = useRef<AffineMatrix | null>(null);
  const groupRef = useRef<{
    before: ImageDocument;
    layerIds: readonly LayerId[];
    requestedSelectionKey: string;
    matrix: AffineMatrix;
    bounds: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const maskRef = useRef<{
    before: ImageDocument;
    layerId: LayerId;
    layerTransform: AffineMatrix;
    maskTransform: AffineMatrix;
    linked: boolean;
    matrix: AffineMatrix;
    bounds: { x: number; y: number; width: number; height: number };
  } | null>(null);

  const isActive = useCallback(
    () => Boolean(controllerRef.current?.state || groupRef.current || maskRef.current),
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
        const layer = findDocumentLayer(result.afterDocument, result.layerId);
        if (layer) current.onLayerTransformCommitted?.(layer.id, { ...layer.transform });
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

  const finish = useCallback((commit: boolean, preserveContinuation = false) => {
    if (!preserveContinuation) continuationFrameRef.current = null;
    setFrameOverride(null);
    const mask = maskRef.current;
    if (mask) {
      maskRef.current = null;
      const current = dependenciesRef.current;
      const after = current.getDocument();
      const unchanged = matrixApproximatelyEqual(mask.matrix, identityMatrix());
      setState(null);
      if (!after || after.id !== mask.before.id) return;
      if (!commit) {
        current.applyDocumentSnapshot(mask.before);
        return;
      }
      if (unchanged) {
        current.applyDocumentSnapshot(mask.before);
        return;
      }
      if (after !== mask.before) current.pushDocumentHistory(mask.before, after);
      return;
    }
    const group = groupRef.current;
    if (group) {
      groupRef.current = null;
      const current = dependenciesRef.current;
      const after = current.getDocument();
      const unchanged = matrixApproximatelyEqual(group.matrix, identityMatrix());
      setState(null);
      if (!after || after.id !== group.before.id) return;
      if (!commit) {
        current.applyDocumentSnapshot(group.before);
        return;
      }
      if (unchanged) {
        current.applyDocumentSnapshot(group.before);
        return;
      }
      if (after !== group.before) current.pushDocumentHistory(group.before, after);
      return;
    }
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
    if (commit && result.kind === 'layer' && transformDelta
      && !matrixApproximatelyEqual(transformDelta, identityMatrix())) {
      lastLayerTransformRef.current = { ...transformDelta };
    }
    applyFinishedTransform(result);
  }, [applyFinishedTransform, setFrameOverride]);

  const reset = useCallback(() => {
    const mask = maskRef.current;
    if (mask && dependenciesRef.current.getDocument()?.id === mask.before.id) {
      dependenciesRef.current.applyDocumentSnapshot(mask.before);
    }
    maskRef.current = null;
    const group = groupRef.current;
    if (group && dependenciesRef.current.getDocument()?.id === group.before.id) {
      dependenciesRef.current.applyDocumentSnapshot(group.before);
    }
    groupRef.current = null;
    const controller = controllerRef.current;
    controller?.invalidatePendingLaunch();
    if (controller?.state) {
      controller.finish(dependenciesRef.current.getDocument(), [], false);
    }
    controllerRef.current = null;
    controllerDocumentIdRef.current = null;
    continuationFrameRef.current = null;
    setFrameOverride(null);
    setState(null);
  }, [setFrameOverride]);

  const begin = useCallback(async (reportEmptyLayer = true) => {
    const current = dependenciesRef.current;
    const document = current.getDocument();
    const renderer = current.getRenderer();
    if (!document || !renderer) {
      current.setError('Select a raster layer before transforming.');
      return;
    }
    const activeLayer = findDocumentLayer(document, document.activeLayerId);
    if (current.activeChannel === 'mask') {
      if (!activeLayer || activeLayer.type !== 'raster' || !activeLayer.mask
        || layerIsLocked(activeLayer, 'position')) {
        current.setError(null);
        setState(null);
        return;
      }
      const measured = await renderer.measureLayerMaskContent(activeLayer);
      if (document.id !== dependenciesRef.current.getDocument()?.id) return;
      if (!measured) {
        current.setError('The active layer mask has no measurable content.');
        return;
      }
      maskRef.current = {
        before: document,
        layerId: activeLayer.id,
        layerTransform: { ...activeLayer.transform },
        maskTransform: { ...activeLayer.mask.transform },
        linked: activeLayer.mask.linked,
        matrix: identityMatrix(),
        bounds: transformedBounds(activeLayer.mask.transform, measured.coreBounds)
      };
      setState({
        layerId: activeLayer.id,
        sourceBounds: transformedBounds(activeLayer.mask.transform, measured.coreBounds),
        supportBounds: transformedBounds(activeLayer.mask.transform, measured.supportBounds),
        sourceContentBounds: { ...measured.coreBounds },
        sourceMatrix: { ...activeLayer.mask.transform },
        matrix: identityMatrix(),
        projectiveQuad: null,
        sourceKind: 'layer',
        previewKind: 'semantic'
      });
      setFrameOverride(continuationFrameRef.current);
      continuationFrameRef.current = null;
      current.setError(null);
      return;
    }
    const requestedSelectionKey = [...new Set(current.selectedLayerIds ?? [])].join('\u0000');
    const groupIds = topLevelTransformLayerIds(document, current.selectedLayerIds ?? [])
      .filter((layerId) => {
        const candidate = findDocumentLayer(document, layerId);
        return candidate && !layerIsLocked(candidate, 'position');
      });
    if (groupIds.length > 1) {
      const bounds = unionSnapRects(groupIds.flatMap((layerId) => {
        const candidate = findDocumentLayer(document, layerId);
        const rect = candidate ? layerDocumentSnapBounds(document, candidate) : null;
        return rect ? [rect] : [];
      }));
      if (!bounds) {
        current.setError('The selected layers have no measurable content yet.');
        return;
      }
      groupRef.current = {
        before: document,
        layerIds: groupIds,
        requestedSelectionKey,
        matrix: identityMatrix(),
        bounds
      };
      setState({
        layerId: document.activeLayerId!,
        sourceBounds: bounds,
        supportBounds: bounds,
        sourceContentBounds: bounds,
        sourceMatrix: identityMatrix(),
        matrix: identityMatrix(),
        projectiveQuad: null,
        sourceKind: 'layer',
        previewKind: 'semantic'
      });
      setFrameOverride(continuationFrameRef.current);
      continuationFrameRef.current = null;
      current.setError(null);
      return;
    }
    const layer = findDocumentLayer(document, document.activeLayerId);
    if (!layer || layerIsLocked(layer, 'position')) {
      current.setError(null);
      setState(null);
      return;
    }
    const controller = controllerRef.current ?? new TransformController(renderer);
    controllerRef.current = controller;
    controllerDocumentIdRef.current = document.id;
    const result = await controller.begin(document, current.selection);
    if (result.ok) {
      setState(result.state);
      setFrameOverride(continuationFrameRef.current);
      continuationFrameRef.current = null;
      current.setError(null);
      if (result.notice) current.setStatus(result.notice);
      return;
    }
    if (result.code === 'stale' || result.code === 'already-active') return;
    if (result.code === 'empty-layer' && !reportEmptyLayer) {
      current.setError(null);
      setState(null);
      return;
    }
    if (result.message) current.setError(result.message);
  }, [setFrameOverride]);

  const checkpoint = useCallback(() => {
    const controllerState = controllerRef.current?.state;
    const active = controllerState ?? (state ? {
      ...state,
      matrix: maskRef.current?.matrix ?? groupRef.current?.matrix ?? state.matrix
    } : null);
    if (!active) return;
    if (!active.projectiveQuad) {
      const frame = frameOverrideRef.current
        ?? transformSessionFrame(active, dependenciesRef.current.transformFrameMode ?? 'document');
      continuationFrameRef.current = {
        bounds: { ...frame.bounds },
        matrix: multiplyMatrices(active.matrix, frame.matrix)
      };
    } else {
      continuationFrameRef.current = null;
    }
    finish(true, true);
    // Pointer-up is a durable checkpoint, not an explicit exit from the Move
    // tool. Re-open against the committed document so the gizmo immediately
    // follows the new layer bounds. `begin` consumes the continuation frame,
    // preserving local axes across consecutive move/scale/rotate gestures.
    void begin(false);
  }, [begin, finish, state]);

  const alignFrameToDocument = useCallback(() => {
    const controllerState = controllerRef.current?.state;
    const active = controllerState ?? (state ? {
      ...state,
      matrix: maskRef.current?.matrix ?? groupRef.current?.matrix ?? state.matrix
    } : null);
    if (!active || active.projectiveQuad) return;
    const frame = frameOverrideRef.current
      ?? transformSessionFrame(active, dependenciesRef.current.transformFrameMode ?? 'local');
    const aligned = alignTransformFrameToDocument(active, frame);
    if (aligned) setFrameOverride(aligned);
  }, [setFrameOverride, state]);

  const update = useCallback((matrix: AffineMatrix) => {
    const mask = maskRef.current;
    if (mask) {
      const current = dependenciesRef.current;
      mask.matrix = { ...matrix };
      const after = mask.linked
        ? setLayerTransform(
            mask.before,
            mask.layerId,
            multiplyMatrices(matrix, mask.layerTransform)
          )
        : setLayerMaskTransform(
            mask.before,
            mask.layerId,
            multiplyMatrices(matrix, mask.maskTransform)
          );
      current.applyDocumentSnapshot(after);
      setState((active) => active ? { ...active, matrix: { ...matrix } } : active);
      return;
    }
    const group = groupRef.current;
    if (group) {
      group.matrix = { ...matrix };
      dependenciesRef.current.applyDocumentSnapshot(
        transformLayerGroupInDocumentSpace(group.before, group.layerIds, matrix)
      );
      setState((current) => current ? { ...current, matrix: { ...matrix } } : current);
      return;
    }
    const next = controllerRef.current?.update(matrix);
    if (next) setState(next);
  }, []);

  const updateProjective = useCallback((quad: TransformQuad) => {
    if (maskRef.current) return;
    const next = controllerRef.current?.updateProjective(quad);
    if (next) setState(next);
  }, []);

  const applyFixed = useCallback(async (operation: FixedTransformOperation) => {
    if (isActive()) finish(true);
    await begin();
    const active = controllerRef.current?.state;
    const bounds = active?.sourceBounds ?? groupRef.current?.bounds ?? maskRef.current?.bounds;
    if (!bounds) return null;
    const target: FixedTransformTarget = maskRef.current
      ? 'mask'
      : groupRef.current ? 'layer-group' : active?.sourceKind ?? 'layer';
    const pivot = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const delta = aroundPoint(
      operation === 'rotate-180' ? rotationMatrix(Math.PI)
        : operation === 'rotate-clockwise-90' ? rotationMatrix(Math.PI / 2)
          : operation === 'rotate-counter-clockwise-90' ? rotationMatrix(-Math.PI / 2)
            : operation === 'flip-horizontal' ? scaleMatrix(-1, 1)
              : scaleMatrix(1, -1),
      pivot
    );
    update(delta);
    finish(true);
    dependenciesRef.current.setStatus(operation.startsWith('rotate') ? 'Layer rotated' : 'Layer flipped');
    return target;
  }, [begin, finish, isActive, update]);

  const nudge = useCallback((x: number, y: number) => {
    if (maskRef.current) {
      setState((current) => {
        if (!current) return current;
        const matrix = multiplyMatrices(
          { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y },
          current.matrix
        );
        const mask = maskRef.current!;
        mask.matrix = { ...matrix };
        const nextDocument = mask.linked
          ? setLayerTransform(
              mask.before,
              mask.layerId,
              multiplyMatrices(matrix, mask.layerTransform)
            )
          : setLayerMaskTransform(
              mask.before,
              mask.layerId,
              multiplyMatrices(matrix, mask.maskTransform)
            );
        dependenciesRef.current.applyDocumentSnapshot(nextDocument);
        return { ...current, matrix };
      });
      return;
    }
    if (groupRef.current) {
      setState((current) => {
        if (!current) return current;
        const matrix = multiplyMatrices(
          { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y },
          current.matrix
        );
        const group = groupRef.current!;
        group.matrix = { ...matrix };
        dependenciesRef.current.applyDocumentSnapshot(
          transformLayerGroupInDocumentSpace(group.before, group.layerIds, matrix)
        );
        return { ...current, matrix };
      });
      return;
    }
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
    const activeGroup = groupRef.current;
    const activeMask = maskRef.current;
    if (activeMask && activeMask.before.id !== dependencies.activeDocument?.id) {
      maskRef.current = null;
      setState(null);
    }
    if (activeGroup && activeGroup.before.id !== dependencies.activeDocument?.id) {
      groupRef.current = null;
      setState(null);
    }
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
      automaticLaunchKeyRef.current = null;
      activeController?.invalidatePendingLaunch();
      if (activeController?.state || groupRef.current || maskRef.current) finish(true);
      return;
    }
    const activeGroupKey = groupRef.current?.requestedSelectionKey ?? null;
    if (
      (activeGroupKey !== null && activeGroupKey !== selectedLayerKey)
      || (activeController?.state && (dependencies.selectedLayerIds?.length ?? 0) > 1)
    ) {
      finish(true);
      return;
    }
    if (
      (activeController?.state || groupRef.current || maskRef.current)
      && state?.layerId !== dependencies.activeLayerId
    ) {
      finish(true);
      return;
    }
    if (maskRef.current && dependencies.activeChannel !== 'mask') {
      finish(true);
      return;
    }
    if (activeController?.state || groupRef.current || maskRef.current) return;
    const automaticLaunchKey = [
      dependencies.activeDocument?.id ?? '', dependencies.activeLayerId ?? '',
      dependencies.activeChannel, selectedLayerKey
    ].join('\u0000');
    // Tool/document/target activation opens one transaction. An explicit
    // commit or cancel leaves the selected Transform tool dormant until the
    // user activates it again; otherwise Enter/Escape immediately recreate
    // the overlay and Ctrl+T can only commit that surprise transaction.
    if (automaticLaunchKeyRef.current === automaticLaunchKey) return;
    automaticLaunchKeyRef.current = automaticLaunchKey;
    void begin(false);
  }, [
    begin,
    dependencies.activeDocument?.id,
    dependencies.activeLayerId,
    dependencies.activeChannel,
    dependencies.activeTool,
    finish,
    selectedLayerKey,
    state?.layerId
  ]);

  useEffect(() => () => {
    const controller = controllerRef.current;
    controller?.invalidatePendingLaunch();
    if (controller?.state) controller.finish(null, [], false);
    const group = groupRef.current;
    if (group && dependenciesRef.current.getDocument()?.id === group.before.id) {
      dependenciesRef.current.applyDocumentSnapshot(group.before);
    }
    groupRef.current = null;
    const mask = maskRef.current;
    if (mask && dependenciesRef.current.getDocument()?.id === mask.before.id) {
      dependenciesRef.current.applyDocumentSnapshot(mask.before);
    }
    maskRef.current = null;
    controllerRef.current = null;
    controllerDocumentIdRef.current = null;
  }, []);

  return {
    state,
    frameOverride,
    begin: () => { void begin(); },
    update,
    updateProjective,
    checkpoint,
    alignFrameToDocument,
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
    },
    applyFixed
  };
};
