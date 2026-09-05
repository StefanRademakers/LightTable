import { useCallback, useEffect, useRef, useState } from 'react';
import {
  layerIsLocked,
  type ImageDocument,
  type LayerId,
  type LayerNode,
  type RasterLayer,
  type Rect
} from '../../../editor/document/documentTypes';
import type { PaintChannel } from '../../../editor/session/editorSession';
import type { SelectionCoverageBounds } from '../../../editor/selection/selectionCoverage';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';
import type { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
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
import {
  measureTransformGroupBounds,
  topLevelTransformLayerIds,
  transformLayerGroupInDocumentSpace
} from '../snapping/groupLayerTransform';
import {
  alignTransformFrameToDocument,
  transformSessionFrame,
  type TransformFrameMode,
  type TransformSessionFrame
} from '../../../editor/tools/transform/transformSessionFrame';
import { resolveTransformTargetLayerIds } from './transformTargetSelection';
import type {
  DocumentMutationController,
  DocumentMutationDescription,
  DocumentMutationTransaction
} from '../../documents/useDocumentMutationController';

export interface TransformEditorRendererPort extends TransformRendererPort {
  setDocument(document: ImageDocument): void;
  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
  captureSelectionSnapshot(): Promise<SelectionMaskSnapshot>;
  measureLayerMaskContent(layer: LayerNode): Promise<SelectionCoverageBounds | null>;
  updateLayerGeometryPreviews?(
    previews: readonly { readonly layer: LayerNode; readonly matrix: AffineMatrix }[]
  ): boolean;
  clearLayerGeometryPreviews?(layers: readonly LayerNode[]): boolean;
  updateLayerMaskGeometryPreview?(layer: LayerNode, matrix: AffineMatrix): boolean;
  clearLayerMaskGeometryPreview?(layer: LayerNode): boolean;
}

export interface TransformHistoryEntry {
  label: string;
  type: string;
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
  /** Advances for an explicit canvas auto-select request, even for the same layer. */
  activationRevision?: number;
  selection: SelectionOperation[];
  getSelection(): SelectionOperation[];
  getSelectionMaskSnapshot(): SelectionMaskSnapshot | null;
  getDocument(): ImageDocument | null;
  getRenderer(): TransformEditorRendererPort | null;
  documentMutations: Pick<DocumentMutationController, 'begin' | 'change'>;
  applyDocumentSnapshot(document: ImageDocument): void;
  applyDocumentAndSelection(
    document: ImageDocument,
    selection: SelectionOperation[],
    selectionMaskSnapshot: SelectionMaskSnapshot
  ): Promise<void>;
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
  update(matrix: AffineMatrix): TransformSessionState | null;
  updateProjective(quad: TransformQuad): TransformSessionState | null;
  checkpoint(): void;
  alignFrameToDocument(): void;
  commit(): void;
  commitPending(): Promise<void>;
  cancel(): void;
  reset(): void;
  isActive(): boolean;
  ownsTemporaryMove(): boolean;
  repeat(duplicate?: boolean): void;
  nudge(x: number, y: number): void;
  applyNudge(x: number, y: number, duplicate?: boolean, continueTransform?: boolean): void;
  beginTemporaryMove(duplicate?: boolean): Promise<boolean>;
  setDuplicate(duplicate: boolean): void;
  applyFixed(operation: FixedTransformOperation): Promise<FixedTransformTarget | null>;
}

export type FixedTransformOperation =
  | 'rotate-180' | 'rotate-clockwise-90' | 'rotate-counter-clockwise-90'
  | 'flip-horizontal' | 'flip-vertical';

export type FixedTransformTarget = 'selection' | 'mask' | 'layer' | 'layer-group';

const projectGroupGeometryPreviews = (
  before: ImageDocument,
  layerIds: readonly LayerId[],
  matrix: AffineMatrix
): readonly { readonly layer: LayerNode; readonly matrix: AffineMatrix }[] => {
  const previewDocument = transformLayerGroupInDocumentSpace(before, layerIds, matrix);
  return layerIds.flatMap((layerId) => {
    const sourceLayer = findDocumentLayer(before, layerId);
    const previewLayer = findDocumentLayer(previewDocument, layerId);
    return sourceLayer && previewLayer
      ? [{ layer: sourceLayer, matrix: previewLayer.transform }]
      : [];
  });
};

/**
 * React adapter for the renderer-backed transform transaction.
 *
 * The low-level TransformController owns preview pixels and transform math.
 * This adapter owns document/selection publication and the complete interactive
 * transform transaction. Pointer-up only ends the current pointer gesture; the
 * original source remains immutable until explicit confirmation or tool exit.
 */
export const useTransformSessionController = (
  dependencies: TransformSessionDependencies
): TransformSessionController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const controllerRef = useRef<TransformController | null>(null);
  const controllerDocumentIdRef = useRef<ImageDocument['id'] | null>(null);
  const controllerDocumentRevisionRef = useRef<number | null>(null);
  const controllerSelectionMaskBeforeRef = useRef<SelectionMaskSnapshot | null>(null);
  const controllerSelectionMaskIdentityRef = useRef<SelectionMaskSnapshot | null>(null);
  const controllerSelectionIdentityRef = useRef<SelectionOperation[] | null>(null);
  const finishPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const [state, setState] = useState<TransformSessionState | null>(null);
  const [frameOverride, setFrameOverrideState] = useState<TransformSessionFrame | null>(null);
  const frameOverrideRef = useRef<TransformSessionFrame | null>(null);
  const setFrameOverride = useCallback((frame: TransformSessionFrame | null) => {
    frameOverrideRef.current = frame;
    setFrameOverrideState(frame);
  }, []);
  const transformTargetLayerIds = resolveTransformTargetLayerIds(
    dependencies.activeLayerId,
    dependencies.selectedLayerIds ?? []
  );
  const selectedLayerKey = transformTargetLayerIds.join('\u0000');
  const automaticLaunchKeyRef = useRef<string | null>(null);
  const lastLayerTransformRef = useRef<AffineMatrix | null>(null);
  const nudgeTransactionRef = useRef<Promise<void>>(Promise.resolve());
  const temporaryMoveRef = useRef(false);
  const temporaryMoveOwnerToolRef = useRef<string | null>(null);
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
  const documentTransactionRef = useRef<DocumentMutationTransaction | null>(null);

  const discardOwnedTransformPreview = useCallback(() => {
    temporaryMoveRef.current = false;
    temporaryMoveOwnerToolRef.current = null;
    const mask = maskRef.current;
    if (mask) {
      const sourceLayer = findDocumentLayer(mask.before, mask.layerId);
      if (sourceLayer) {
        if (mask.linked) {
          dependenciesRef.current.getRenderer()?.clearLayerGeometryPreviews?.([sourceLayer]);
        }
        dependenciesRef.current.getRenderer()?.clearLayerMaskGeometryPreview?.(sourceLayer);
      }
    }
    maskRef.current = null;
    const group = groupRef.current;
    if (group) {
      const sourceLayers = group.layerIds.flatMap((layerId) => {
        const layer = findDocumentLayer(group.before, layerId);
        return layer ? [layer] : [];
      });
      dependenciesRef.current.getRenderer()?.clearLayerGeometryPreviews?.(sourceLayers);
    }
    groupRef.current = null;
    const controller = controllerRef.current;
    controller?.invalidatePendingLaunch();
    if (controller?.state) controller.finish(null, [], false);
    controllerDocumentIdRef.current = null;
    controllerDocumentRevisionRef.current = null;
    controllerSelectionMaskBeforeRef.current = null;
    controllerSelectionMaskIdentityRef.current = null;
    controllerSelectionIdentityRef.current = null;
    setFrameOverride(null);
    setState(null);
  }, [setFrameOverride]);

  const beginDocumentTransaction = useCallback((
    description: DocumentMutationDescription
  ): DocumentMutationTransaction | null => {
    let owned: DocumentMutationTransaction | null = null;
    owned = dependenciesRef.current.documentMutations.begin(
      'transform',
      description,
      (reason) => {
        if (documentTransactionRef.current !== owned) return;
        documentTransactionRef.current = null;
        if (reason !== 'commit') discardOwnedTransformPreview();
      },
      'cancel'
    );
    if (owned) documentTransactionRef.current = owned;
    return owned;
  }, [discardOwnedTransformPreview]);

  const isActive = useCallback(
    () => Boolean(controllerRef.current?.state || groupRef.current || maskRef.current),
    []
  );

  const applyFinishedTransform = useCallback(async (
    result: ReturnType<TransformController['finish']>,
    beforeSelectionMask: SelectionMaskSnapshot | null,
    transaction: DocumentMutationTransaction | null
  ) => {
    if (result.kind === 'cancelled' || result.kind === 'unchanged') {
      transaction?.cancel();
      return;
    }
    const current = dependenciesRef.current;
    if (result.kind === 'error') {
      transaction?.cancel();
      current.setError(result.message);
      return;
    }
    if (!transaction) {
      if (result.kind !== 'layer') {
        current.getRenderer()?.applyPixelHistory(result.pixelEdit, 'undo');
        result.pixelEdit.destroy();
      }
      current.setError('The transform no longer owns the active document transaction.');
      return;
    }
    if (result.kind === 'layer') {
      if (result.afterDocument !== result.beforeDocument) {
        if (!transaction.stage(() => result.afterDocument)) return;
        if (transaction.commit()) {
          const layer = findDocumentLayer(result.afterDocument, result.layerId);
          if (layer) current.onLayerTransformCommitted?.(layer.id, { ...layer.transform });
        }
      } else {
        transaction.cancel();
      }
      return;
    }

    if (result.kind === 'raster-layer') {
      let editOwned = true;
      let pixelsApplied = true;
      const rollback = () => {
        if (!editOwned) return;
        if (pixelsApplied) current.getRenderer()?.applyPixelHistory(result.pixelEdit, 'undo');
        result.pixelEdit.destroy();
        editOwned = false;
      };
      if (!transaction.stage(() => result.afterDocument)) {
        rollback();
        return;
      }
      try {
        const committed = transaction.commitWith((beforeDocument, afterDocument) => {
          try {
            current.applyDocumentSnapshot(afterDocument);
            current.pushHistoryEntry({
              label: 'Free Transform',
              type: 'transform.layer',
              byteSize: result.pixelEdit.byteSize,
              layerIds: [result.layerId],
              undo: () => {
                const latest = dependenciesRef.current;
                if (!latest.getRenderer()?.applyPixelHistory(result.pixelEdit, 'undo')) {
                  throw new Error('Transform undo is no longer available.');
                }
                latest.applyDocumentSnapshot(beforeDocument);
              },
              redo: () => {
                const latest = dependenciesRef.current;
                if (!latest.getRenderer()?.applyPixelHistory(result.pixelEdit, 'redo')) {
                  throw new Error('Transform redo is no longer available.');
                }
                latest.applyDocumentSnapshot(afterDocument);
              },
              dispose: result.pixelEdit.destroy
            });
            editOwned = false;
            return true;
          } catch (reason) {
            if (current.getRenderer()?.applyPixelHistory(result.pixelEdit, 'undo')) {
              pixelsApplied = false;
            }
            current.applyDocumentSnapshot(beforeDocument);
            throw reason;
          }
        });
        if (!committed) rollback();
      } catch (reason) {
        rollback();
        throw reason;
      }
      return;
    }

    const {
      afterDocument,
      beforeSelection,
      afterSelection,
      layerId,
      pixelEdit
    } = result;
    const renderer = current.getRenderer();
    if (!renderer || !beforeSelectionMask) {
      renderer?.applyPixelHistory(pixelEdit, 'undo');
      pixelEdit.destroy();
      transaction.cancel();
      current.setError('The exact selection state was unavailable; the transform was rolled back.');
      return;
    }
    let editOwned = true;
    let pixelsApplied = true;
    const rollback = () => {
      if (!editOwned) return;
      if (pixelsApplied) renderer.applyPixelHistory(pixelEdit, 'undo');
      pixelEdit.destroy();
      editOwned = false;
    };
    if (!transaction.stage(() => afterDocument)) {
      rollback();
      return;
    }
    try {
      const committed = await transaction.commitWithAsync(async (
        ownedBeforeDocument,
        ownedAfterDocument
      ) => {
        let afterSelectionMask: SelectionMaskSnapshot;
        try {
          afterSelectionMask = await renderer.captureSelectionSnapshot();
        } catch (reason) {
          current.setError(
            reason instanceof Error
              ? `The transformed selection could not be captured: ${reason.message}`
              : 'The transformed selection could not be captured; the transform was rolled back.'
          );
          rollback();
          return false;
        }
        const latest = dependenciesRef.current;
        const latestDocument = latest.getDocument();
        if (
          latest.getRenderer() !== renderer
          || latestDocument !== ownedBeforeDocument
          || latest.getSelection() !== controllerSelectionIdentityRef.current
          || latest.getSelectionMaskSnapshot() !== controllerSelectionMaskIdentityRef.current
        ) {
          rollback();
          latest.setError(
            'The document changed while the transform was finishing; the transform was rolled back.'
          );
          return false;
        }
        try {
          await latest.applyDocumentAndSelection(
            ownedAfterDocument,
            afterSelection,
            afterSelectionMask
          );
          latest.pushHistoryEntry({
            label: 'Free Transform',
            type: 'transform.selection',
            byteSize: pixelEdit.byteSize + beforeSelectionMask.byteSize + afterSelectionMask.byteSize,
            layerIds: [layerId],
            undo: async () => {
              const undoDependencies = dependenciesRef.current;
              if (!undoDependencies.getRenderer()?.applyPixelHistory(pixelEdit, 'undo')) {
                throw new Error('Transform undo is no longer available.');
              }
              try {
                await undoDependencies.applyDocumentAndSelection(
                  ownedBeforeDocument,
                  beforeSelection,
                  beforeSelectionMask
                );
              } catch (reason) {
                undoDependencies.getRenderer()?.applyPixelHistory(pixelEdit, 'redo');
                await undoDependencies.applyDocumentAndSelection(
                  ownedAfterDocument,
                  afterSelection,
                  afterSelectionMask
                );
                throw reason;
              }
            },
            redo: async () => {
              const redoDependencies = dependenciesRef.current;
              if (!redoDependencies.getRenderer()?.applyPixelHistory(pixelEdit, 'redo')) {
                throw new Error('Transform redo is no longer available.');
              }
              try {
                await redoDependencies.applyDocumentAndSelection(
                  ownedAfterDocument,
                  afterSelection,
                  afterSelectionMask
                );
              } catch (reason) {
                redoDependencies.getRenderer()?.applyPixelHistory(pixelEdit, 'undo');
                await redoDependencies.applyDocumentAndSelection(
                  ownedBeforeDocument,
                  beforeSelection,
                  beforeSelectionMask
                );
                throw reason;
              }
            },
            dispose: pixelEdit.destroy
          });
          editOwned = false;
          return true;
        } catch (reason) {
          if (renderer.applyPixelHistory(pixelEdit, 'undo')) pixelsApplied = false;
          try {
            await latest.applyDocumentAndSelection(
              ownedBeforeDocument,
              beforeSelection,
              beforeSelectionMask
            );
          } catch {
            // Preserve the publication error. No history command owns the edit.
          }
          rollback();
          throw reason;
        }
      });
      if (!committed) rollback();
    } catch (reason) {
      rollback();
      throw reason;
    }
  }, []);

  const finish = useCallback((commit: boolean): Promise<void> => {
    temporaryMoveRef.current = false;
    temporaryMoveOwnerToolRef.current = null;
    setFrameOverride(null);
    const mask = maskRef.current;
    if (mask) {
      const transaction = documentTransactionRef.current;
      maskRef.current = null;
      const current = dependenciesRef.current;
      const activeDocument = current.getDocument();
      const sourceLayer = findDocumentLayer(mask.before, mask.layerId);
      if (sourceLayer) {
        if (mask.linked) current.getRenderer()?.clearLayerGeometryPreviews?.([sourceLayer]);
        current.getRenderer()?.clearLayerMaskGeometryPreview?.(sourceLayer);
      }
      const unchanged = matrixApproximatelyEqual(mask.matrix, identityMatrix());
      setState(null);
      if (!activeDocument || activeDocument.id !== mask.before.id || !commit || unchanged) {
        transaction?.cancel();
        return finishPromiseRef.current;
      }
      if (activeDocument.revision !== mask.before.revision) {
        transaction?.cancel();
        current.setError('The document changed during the mask transform; the preview was discarded.');
        return finishPromiseRef.current;
      }
      const after = mask.linked
        ? setLayerTransform(
            mask.before,
            mask.layerId,
            multiplyMatrices(mask.matrix, mask.layerTransform)
          )
        : setLayerMaskTransform(
            mask.before,
            mask.layerId,
            multiplyMatrices(mask.matrix, mask.maskTransform)
      );
      if (after === mask.before) {
        transaction?.cancel();
        return finishPromiseRef.current;
      }
      if (!transaction?.stage(() => after) || !transaction.commit()) {
        current.setError('The layer mask transform could not be committed.');
      }
      return finishPromiseRef.current;
    }
    const group = groupRef.current;
    if (group) {
      const transaction = documentTransactionRef.current;
      groupRef.current = null;
      const current = dependenciesRef.current;
      const renderer = current.getRenderer();
      const sourceLayers = group.layerIds.flatMap((layerId) => {
        const layer = findDocumentLayer(group.before, layerId);
        return layer ? [layer] : [];
      });
      renderer?.clearLayerGeometryPreviews?.(sourceLayers);
      const activeDocument = current.getDocument();
      const unchanged = matrixApproximatelyEqual(group.matrix, identityMatrix());
      setState(null);
      if (!activeDocument || activeDocument.id !== group.before.id || !commit || unchanged) {
        transaction?.cancel();
        return finishPromiseRef.current;
      }
      if (activeDocument.revision !== group.before.revision) {
        transaction?.cancel();
        current.setError('The document changed during the group transform; the preview was discarded.');
        return finishPromiseRef.current;
      }
      const after = transformLayerGroupInDocumentSpace(
        group.before,
        group.layerIds,
        group.matrix
      );
      if (!transaction?.stage(() => after) || !transaction.commit()) {
        current.setError('The layer group transform could not be committed.');
      }
      return finishPromiseRef.current;
    }
    const controller = controllerRef.current;
    if (!controller?.state) return finishPromiseRef.current;
    const current = dependenciesRef.current;
    const transaction = documentTransactionRef.current;
    const document = current.getDocument();
    const belongsToActiveDocument = Boolean(
      document
      && document.id === controllerDocumentIdRef.current
      && document.revision === controllerDocumentRevisionRef.current
      && current.getSelection() === controllerSelectionIdentityRef.current
      && current.getSelectionMaskSnapshot() === controllerSelectionMaskIdentityRef.current
    );
    const transformDelta = controller.state?.matrix ?? null;
    const result = controller.finish(
      belongsToActiveDocument ? document : null,
      belongsToActiveDocument ? current.getSelection() : [],
      commit && belongsToActiveDocument
    );
    controllerDocumentIdRef.current = null;
    controllerDocumentRevisionRef.current = null;
    const beforeSelectionMask = controllerSelectionMaskBeforeRef.current;
    controllerSelectionMaskBeforeRef.current = null;
    setState(null);
    if (commit && result.kind === 'layer' && transformDelta
      && !matrixApproximatelyEqual(transformDelta, identityMatrix())) {
      lastLayerTransformRef.current = { ...transformDelta };
    }
    if (commit && !belongsToActiveDocument) {
      controllerSelectionMaskIdentityRef.current = null;
      transaction?.cancel();
      current.setError('The document or selection changed during the transform; the preview was discarded.');
      return finishPromiseRef.current;
    }
    const pending = applyFinishedTransform(result, beforeSelectionMask, transaction)
      .catch((reason) => {
        dependenciesRef.current.setError(
          reason instanceof Error ? reason.message : 'The transform could not be finished.'
        );
      })
      .finally(() => {
        controllerSelectionIdentityRef.current = null;
        controllerSelectionMaskIdentityRef.current = null;
      });
    finishPromiseRef.current = pending;
    return pending;
  }, [applyFinishedTransform, setFrameOverride]);

  const reset = useCallback(() => {
    const transaction = documentTransactionRef.current;
    if (transaction) {
      if (transaction.cancel() || transaction.active) return;
      documentTransactionRef.current = null;
    }
    discardOwnedTransformPreview();
  }, [discardOwnedTransformPreview]);

  const begin = useCallback(async (reportEmptyLayer = true, allowInactiveTool = false) => {
    await finishPromiseRef.current;
    const current = dependenciesRef.current;
    const document = current.getDocument();
    const renderer = current.getRenderer();
    if (!document || !renderer) {
      current.setError('Select a raster layer before transforming.');
      return;
    }
    const activeLayer = findDocumentLayer(document, document.activeLayerId);
    const requestedLayerIds = resolveTransformTargetLayerIds(
      document.activeLayerId,
      current.selectedLayerIds ?? []
    );
    const requestedSelectionKey = requestedLayerIds.join('\u0000');
    const launchIsCurrent = () => {
      const latest = dependenciesRef.current;
      const latestDocument = latest.getDocument();
      return (allowInactiveTool || latest.activeTool === 'transform')
        && latestDocument === document
        && latestDocument.activeLayerId === document.activeLayerId
        && latest.activeChannel === current.activeChannel
        && resolveTransformTargetLayerIds(
          latestDocument.activeLayerId,
          latest.selectedLayerIds ?? []
        ).join('\u0000') === requestedSelectionKey;
    };
    if (current.activeChannel === 'mask') {
      if (!activeLayer || !activeLayer.mask
        || layerIsLocked(activeLayer, 'position')) {
        current.setError(null);
        setState(null);
        return;
      }
      const transaction = beginDocumentTransaction({
        label: 'Transform Layer Mask',
        type: 'transform.mask',
        layerIds: [activeLayer.id]
      });
      if (!transaction) {
        current.setError('The document is still completing another edit.');
        return;
      }
      let measured: SelectionCoverageBounds | null;
      try {
        measured = await renderer.measureLayerMaskContent(activeLayer);
      } catch (reason) {
        transaction.cancel();
        current.setError(reason instanceof Error
          ? reason.message
          : 'The layer mask could not be measured.');
        return;
      }
      if (!launchIsCurrent() || !transaction.active) {
        transaction.cancel();
        return;
      }
      if (!measured) {
        transaction.cancel();
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
      current.setError(null);
      return;
    }
    const groupIds = topLevelTransformLayerIds(document, requestedLayerIds)
      .filter((layerId) => {
        const candidate = findDocumentLayer(document, layerId);
        return candidate && !layerIsLocked(candidate, 'position');
      });
    if (groupIds.length > 1) {
      const transaction = beginDocumentTransaction({
        label: 'Free Transform',
        type: 'transform.layer-group',
        layerIds: groupIds
      });
      if (!transaction) {
        current.setError('The document is still completing another edit.');
        return;
      }
      let bounds: Rect | null;
      try {
        bounds = await measureTransformGroupBounds(document, groupIds, renderer);
      } catch (reason) {
        transaction.cancel();
        current.setError(reason instanceof Error
          ? reason.message
          : 'The selected layers could not be measured.');
        return;
      }
      if (!launchIsCurrent() || !transaction.active) {
        transaction.cancel();
        return;
      }
      if (!bounds) {
        transaction.cancel();
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
      current.setError(null);
      return;
    }
    const layer = findDocumentLayer(document, document.activeLayerId);
    if (!layer || layerIsLocked(layer, 'position')) {
      current.setError(null);
      setState(null);
      return;
    }
    const transaction = beginDocumentTransaction({
      label: 'Free Transform',
      type: 'transform.layer',
      layerIds: [layer.id]
    });
    if (!transaction) {
      current.setError('The document is still completing another edit.');
      return;
    }
    const controller = controllerRef.current ?? new TransformController(renderer);
    controllerRef.current = controller;
    controllerDocumentIdRef.current = document.id;
    controllerDocumentRevisionRef.current = document.revision;
    const selection = current.getSelection();
    controllerSelectionIdentityRef.current = selection;
    controllerSelectionMaskIdentityRef.current = current.getSelectionMaskSnapshot();
    let selectionMaskBefore = controllerSelectionMaskIdentityRef.current;
    if (selection.length > 0 && !selectionMaskBefore) {
      try {
        selectionMaskBefore = await renderer.captureSelectionSnapshot();
      } catch (reason) {
        transaction.cancel();
        controllerDocumentIdRef.current = null;
        controllerDocumentRevisionRef.current = null;
        controllerSelectionIdentityRef.current = null;
        controllerSelectionMaskIdentityRef.current = null;
        current.setError(
          reason instanceof Error
            ? `The selection could not be captured: ${reason.message}`
            : 'The selection could not be captured.'
        );
        return;
      }
      if (!launchIsCurrent()
        || !transaction.active
        || dependenciesRef.current.getSelection() !== selection
        || dependenciesRef.current.getSelectionMaskSnapshot()
          !== controllerSelectionMaskIdentityRef.current) {
        controllerDocumentIdRef.current = null;
        controllerDocumentRevisionRef.current = null;
        controllerSelectionIdentityRef.current = null;
        controllerSelectionMaskIdentityRef.current = null;
        transaction.cancel();
        return;
      }
    }
    const result = await controller.begin(document, selection);
    if (!launchIsCurrent() || !transaction.active) {
      if (result.ok) controller.finish(null, [], false);
      transaction.cancel();
      if (controllerRef.current === controller) {
        controllerDocumentIdRef.current = null;
        controllerDocumentRevisionRef.current = null;
        controllerSelectionIdentityRef.current = null;
        controllerSelectionMaskIdentityRef.current = null;
        controllerSelectionMaskBeforeRef.current = null;
        setState(null);
      }
      return;
    }
    if (result.ok) {
      controllerSelectionMaskBeforeRef.current = result.state.sourceKind === 'selection'
        ? selectionMaskBefore
        : null;
      setState(result.state);
      current.setError(null);
      if (result.notice) current.setStatus(result.notice);
      return;
    }
    controllerSelectionMaskBeforeRef.current = null;
    controllerSelectionMaskIdentityRef.current = null;
    controllerSelectionIdentityRef.current = null;
    controllerDocumentIdRef.current = null;
    controllerDocumentRevisionRef.current = null;
    transaction.cancel();
    if (result.code === 'stale' || result.code === 'already-active') return;
    if (result.code === 'empty-layer' && !reportEmptyLayer) {
      current.setError(null);
      setState(null);
      return;
    }
    if (result.message) current.setError(result.message);
  }, [beginDocumentTransaction, setFrameOverride]);

  const checkpoint = useCallback(() => {
    const active = controllerRef.current?.state ?? (state ? {
      ...state,
      matrix: maskRef.current?.matrix ?? groupRef.current?.matrix ?? state.matrix
    } : null);
    if (!active) return;
    // Keep the same renderer transaction and immutable source pixels alive.
    // React only needs the latest matrix/quad so the next pointer gesture starts
    // from the current gizmo. History and rasterization happen in `finish`.
    setState({
      ...active,
      matrix: { ...active.matrix },
      projectiveQuad: active.projectiveQuad
        ? [
            { ...active.projectiveQuad[0] },
            { ...active.projectiveQuad[1] },
            { ...active.projectiveQuad[2] },
            { ...active.projectiveQuad[3] }
          ]
        : null
    });
  }, [state]);

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
      const renderer = current.getRenderer();
      const sourceLayer = findDocumentLayer(mask.before, mask.layerId);
      if (!renderer || !sourceLayer) return null;
      const maskTransform = multiplyMatrices(matrix, mask.maskTransform);
      if (mask.linked) {
        const layerUpdated = renderer.updateLayerGeometryPreviews?.([{
          layer: sourceLayer,
          matrix: multiplyMatrices(matrix, mask.layerTransform)
        }]) ?? false;
        const maskUpdated = renderer.updateLayerMaskGeometryPreview?.(
          sourceLayer,
          maskTransform
        ) ?? false;
        if (!layerUpdated || !maskUpdated) {
          if (layerUpdated) renderer.clearLayerGeometryPreviews?.([sourceLayer]);
          if (maskUpdated) renderer.clearLayerMaskGeometryPreview?.(sourceLayer);
          return null;
        }
      } else if (!renderer.updateLayerMaskGeometryPreview?.(sourceLayer, maskTransform)) {
        return null;
      }
      mask.matrix = { ...matrix };
      const next = state ? { ...state, matrix: { ...matrix } } : null;
      if (next) setState(next);
      return next;
    }
    const group = groupRef.current;
    if (group) {
      const previews = projectGroupGeometryPreviews(group.before, group.layerIds, matrix);
      if (!dependenciesRef.current.getRenderer()?.updateLayerGeometryPreviews?.(previews)) {
        return null;
      }
      group.matrix = { ...matrix };
      const next = state ? { ...state, matrix: { ...matrix } } : null;
      return next;
    }
    // Single-layer pointer previews are renderer-owned transient state. React
    // receives the durable checkpoint once, after pointer-up.
    return controllerRef.current?.update(matrix) ?? null;
  }, [state]);

  const updateProjective = useCallback((quad: TransformQuad) => {
    if (maskRef.current) return null;
    return controllerRef.current?.updateProjective(quad) ?? null;
  }, []);

  const applyFixed = useCallback(async (operation: FixedTransformOperation) => {
    if (isActive()) await finish(true);
    // Menu and command-layer fixed transforms are one-shot operations. They
    // use the same selection-aware transform transaction without requiring
    // the interactive Transform tool or its gizmo to be active first.
    await begin(true, true);
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
    await finish(true);
    dependenciesRef.current.setStatus(operation.startsWith('rotate') ? 'Layer rotated' : 'Layer flipped');
    return target;
  }, [begin, finish, isActive, update]);

  const nudge = useCallback((x: number, y: number) => {
    if (maskRef.current) {
      const matrix = multiplyMatrices(
        { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y },
        maskRef.current.matrix
      );
      update(matrix);
      return;
    }
    if (groupRef.current) {
      const group = groupRef.current;
      const matrix = multiplyMatrices(
        { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y },
        group.matrix
      );
      const previews = projectGroupGeometryPreviews(group.before, group.layerIds, matrix);
      if (!dependenciesRef.current.getRenderer()?.updateLayerGeometryPreviews?.(previews)) return;
      group.matrix = { ...matrix };
      setState((current) => current ? { ...current, matrix } : current);
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
  }, [update]);

  const repeat = useCallback((duplicate = false) => {
    const delta = lastLayerTransformRef.current;
    const current = dependenciesRef.current;
    if (!delta || !current.getDocument()?.activeLayerId) {
      current.setError('There is no previous layer transform to repeat.');
      return;
    }
    const changed = current.documentMutations.change(
      (before) => {
        if (!before.activeLayerId) return before;
        const withTarget = duplicate ? duplicateLayer(before, before.activeLayerId) : before;
        const target = findDocumentLayer(withTarget, withTarget.activeLayerId);
        if (!target) return before;
        return setLayerTransform(
          withTarget,
          target.id,
          multiplyMatrices(delta, target.transform)
        );
      },
      true,
      {
        label: duplicate ? 'Duplicate and Transform Again' : 'Transform Again',
        type: duplicate ? 'transform.repeat-duplicate' : 'transform.repeat'
      }
    );
    current.setError(changed ? null : 'The active layer can no longer be transformed.');
  }, []);

  const applyNudge = useCallback((
    x: number,
    y: number,
    duplicate = false,
    continueTransform = false
  ) => {
    if (continueTransform) {
      temporaryMoveRef.current = true;
      temporaryMoveOwnerToolRef.current = dependenciesRef.current.activeTool;
    }
    if (isActive() && !duplicate) {
      nudge(x, y);
      return;
    }
    nudgeTransactionRef.current = nudgeTransactionRef.current.then(async () => {
      if (isActive() && !duplicate) {
        nudge(x, y);
        return;
      }
      if (isActive()) await finish(true);
      await begin(true, true);
      if (!isActive()) {
        if (continueTransform) {
          temporaryMoveRef.current = false;
          temporaryMoveOwnerToolRef.current = null;
        }
        return;
      }
      if (duplicate) controllerRef.current?.setDuplicate(true);
      nudge(x, y);
      const keepActive = continueTransform
        || dependenciesRef.current.activeTool === 'transform';
      if (!keepActive) {
        await finish(true);
      }
    }).catch((reason) => {
      if (continueTransform) {
        temporaryMoveRef.current = false;
        temporaryMoveOwnerToolRef.current = null;
      }
      dependenciesRef.current.setError(
        reason instanceof Error ? reason.message : 'The content could not be moved.'
      );
    });
  }, [begin, finish, isActive, nudge]);

  const commitPending = useCallback(async () => {
    // Keyboard nudges may still be waiting for the asynchronous transform
    // launch. A command must cross that queue before it reads pixels or the
    // selection, otherwise the preview can be newer than the command state.
    await nudgeTransactionRef.current;
    if (isActive()) await finish(true);
    await finishPromiseRef.current;
  }, [finish, isActive]);

  const beginTemporaryMove = useCallback(async (duplicate = false) => {
    if (isActive()) {
      if (duplicate) controllerRef.current?.setDuplicate(true);
      return true;
    }
    temporaryMoveRef.current = true;
    temporaryMoveOwnerToolRef.current = dependenciesRef.current.activeTool;
    try {
      await begin(true, true);
      const active = isActive();
      if (active && duplicate) controllerRef.current?.setDuplicate(true);
      if (!active) temporaryMoveRef.current = false;
      if (!active) temporaryMoveOwnerToolRef.current = null;
      return active;
    } catch (reason) {
      temporaryMoveRef.current = false;
      temporaryMoveOwnerToolRef.current = null;
      throw reason;
    }
  }, [begin, isActive]);

  useEffect(() => {
    const documentTransaction = documentTransactionRef.current;
    if (
      documentTransaction?.active
      && documentTransaction.documentId !== dependencies.activeDocument?.id
    ) {
      documentTransaction.cancel();
      return;
    }
    const controller = controllerRef.current;
    const activeGroup = groupRef.current;
    const activeMask = maskRef.current;
    if (activeMask && activeMask.before.id !== dependencies.activeDocument?.id) {
      const sourceLayer = findDocumentLayer(activeMask.before, activeMask.layerId);
      if (sourceLayer) {
        if (activeMask.linked) {
          dependenciesRef.current.getRenderer()?.clearLayerGeometryPreviews?.([sourceLayer]);
        }
        dependenciesRef.current.getRenderer()?.clearLayerMaskGeometryPreview?.(sourceLayer);
      }
      maskRef.current = null;
      setState(null);
    }
    if (activeGroup && activeGroup.before.id !== dependencies.activeDocument?.id) {
      const sourceLayers = activeGroup.layerIds.flatMap((layerId) => {
        const layer = findDocumentLayer(activeGroup.before, layerId);
        return layer ? [layer] : [];
      });
      dependenciesRef.current.getRenderer()?.clearLayerGeometryPreviews?.(sourceLayers);
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
      controllerDocumentRevisionRef.current = null;
      controllerSelectionIdentityRef.current = null;
      controllerSelectionMaskBeforeRef.current = null;
      controllerSelectionMaskIdentityRef.current = null;
      setState(null);
    }
    const activeController = controllerRef.current;
    const temporaryMoveStillOwned = temporaryMoveRef.current
      && dependencies.activeTool === temporaryMoveOwnerToolRef.current;
    if (dependencies.activeTool !== 'transform' && !temporaryMoveStillOwned) {
      automaticLaunchKeyRef.current = null;
      activeController?.invalidatePendingLaunch();
      if (activeController?.state || groupRef.current || maskRef.current) void finish(true);
      return;
    }
    const activeGroupKey = groupRef.current?.requestedSelectionKey ?? null;
    if (
      (activeGroupKey !== null && activeGroupKey !== selectedLayerKey)
      || (activeController?.state && transformTargetLayerIds.length > 1)
    ) {
      void finish(true);
      return;
    }
    // The active transaction owns its target identity. React `state` is only
    // the gizmo projection and may trail a controller update by one render;
    // using it here can accidentally finish and restart the transaction.
    const activeSessionLayerId = activeController?.state?.layerId
      ?? maskRef.current?.layerId
      ?? null;
    if (activeSessionLayerId && activeSessionLayerId !== dependencies.activeLayerId) {
      void finish(true);
      return;
    }
    if (maskRef.current && dependencies.activeChannel !== 'mask') {
      void finish(true);
      return;
    }
    if (activeController?.state || groupRef.current || maskRef.current) return;
    const automaticLaunchKey = [
      dependencies.activeDocument?.id ?? '', dependencies.activeLayerId ?? '',
      dependencies.activeChannel, selectedLayerKey,
      String(dependencies.activationRevision ?? 0)
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
    dependencies.activationRevision,
    finish,
    selectedLayerKey,
    transformTargetLayerIds.length
  ]);

  useEffect(() => () => {
    const documentTransaction = documentTransactionRef.current;
    documentTransactionRef.current = null;
    documentTransaction?.cancel();
    const controller = controllerRef.current;
    controller?.invalidatePendingLaunch();
    if (controller?.state) controller.finish(null, [], false);
    const group = groupRef.current;
    if (group) {
      const sourceLayers = group.layerIds.flatMap((layerId) => {
        const layer = findDocumentLayer(group.before, layerId);
        return layer ? [layer] : [];
      });
      dependenciesRef.current.getRenderer()?.clearLayerGeometryPreviews?.(sourceLayers);
    }
    groupRef.current = null;
    const mask = maskRef.current;
    if (mask) {
      const sourceLayer = findDocumentLayer(mask.before, mask.layerId);
      if (sourceLayer) {
        if (mask.linked) {
          dependenciesRef.current.getRenderer()?.clearLayerGeometryPreviews?.([sourceLayer]);
        }
        dependenciesRef.current.getRenderer()?.clearLayerMaskGeometryPreview?.(sourceLayer);
      }
    }
    maskRef.current = null;
    controllerRef.current = null;
    controllerDocumentIdRef.current = null;
    controllerDocumentRevisionRef.current = null;
    controllerSelectionIdentityRef.current = null;
    controllerSelectionMaskBeforeRef.current = null;
    controllerSelectionMaskIdentityRef.current = null;
  }, []);

  return {
    state,
    frameOverride,
    begin: () => { void begin(); },
    update,
    updateProjective,
    checkpoint,
    alignFrameToDocument,
    commit: () => { void finish(true); },
    commitPending,
    cancel: () => { void finish(false); },
    reset,
    isActive,
    ownsTemporaryMove: () => temporaryMoveRef.current,
    repeat,
    nudge,
    applyNudge,
    beginTemporaryMove,
    setDuplicate: (duplicate) => {
      if (controllerRef.current?.setDuplicate(duplicate)) {
        const next = controllerRef.current.state;
        if (next) setState(next);
      }
    },
    applyFixed
  };
};
