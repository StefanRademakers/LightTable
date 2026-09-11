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
import type { LightTableSelectionReadLease } from '../selection/DocumentSelectionStateStore';
import type {
  AffineMatrix,
  TransformQuad,
  TransformSessionState
} from '../../../editor/tools/transform/transformTypes';
import {
  TransformController,
  type TransformRendererPort
} from './transformController';
import { findDocumentLayer } from '../../../editor/document/layerTree';
import {
  matrixApproximatelyEqual,
  multiplyMatrices,
  identityMatrix,
  transformedBounds
} from '../../../editor/tools/transform/affine';
import {
  measureTransformGroupBounds,
  topLevelTransformLayerIds
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
import type { DocumentHistoryReservation } from '../../commands/documentCommandHistory';
import {
  TransformPublicationOwner,
  type TransformSelectionPublicationBinding
} from './TransformPublicationOwner';
import { AuxiliaryTransformSessionOwner } from './AuxiliaryTransformSessionOwner';
import {
  fixedTransformDelta,
  repeatLayerTransform,
  type FixedTransformOperation
} from './fixedTransformCommands';

export type { FixedTransformOperation } from './fixedTransformCommands';

export interface TransformEditorRendererPort extends TransformRendererPort {
  setDocument(document: ImageDocument): void;
  applyPixelHistory(edit: ReversiblePixelEdit, direction: 'undo' | 'redo'): boolean;
  captureSelectionSnapshot(): Promise<SelectionMaskSnapshot>;
  restoreSelectionSnapshot(snapshot: SelectionMaskSnapshot): Promise<boolean>;
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
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
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
  selectionRevision: number;
  getSelectionLease(): LightTableSelectionReadLease | null;
  getDocument(): ImageDocument | null;
  getRenderer(): TransformEditorRendererPort | null;
  getRendererGeneration(): number;
  rendererGeneration: number;
  documentMutations: Pick<DocumentMutationController, 'begin' | 'change'>;
  applyDocumentSnapshot(document: ImageDocument): void;
  applyDocumentAndSelection(
    document: ImageDocument,
    selection: SelectionOperation[],
    selectionMaskSnapshot: SelectionMaskSnapshot,
    binding: TransformSelectionPublicationBinding
  ): Promise<void>;
  reserveHistoryEntry(entry: TransformHistoryEntry): DocumentHistoryReservation;
  setError(message: string | null): void;
  setStatus(message: string): void;
  transformFrameMode?: TransformFrameMode;
  onLayerTransformCommitted?(layerId: LayerId, transform: AffineMatrix): void;
  /** Publishes a destructive raster transform to document-level revision observers. */
  onRasterTransformCommitted?(layerId: LayerId, kind: 'layer' | 'selection'): void;
  onAuxiliaryTransformCommitted?(kind: 'group' | 'mask', layerIds: readonly LayerId[]): void;
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

export type FixedTransformTarget = 'selection' | 'mask' | 'layer' | 'layer-group';

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
  const controllerRendererRef = useRef<TransformEditorRendererPort | null>(null);
  const controllerRendererGenerationRef = useRef<number | null>(null);
  const controllerDocumentIdRef = useRef<ImageDocument['id'] | null>(null);
  const controllerDocumentRevisionRef = useRef<number | null>(null);
  const controllerSelectionLeaseRef = useRef<LightTableSelectionReadLease | null>(null);
  const finishPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const launchPromiseRef = useRef<Promise<void>>(Promise.resolve());
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
  const auxiliaryOwnerRef = useRef<AuxiliaryTransformSessionOwner | null>(null);
  auxiliaryOwnerRef.current ??= new AuxiliaryTransformSessionOwner(() => ({
    renderer: dependenciesRef.current.getRenderer(),
    rendererGeneration: dependenciesRef.current.getRendererGeneration()
  }));
  const documentTransactionRef = useRef<DocumentMutationTransaction | null>(null);
  const publicationOwnerRef = useRef<TransformPublicationOwner | null>(null);
  publicationOwnerRef.current ??= new TransformPublicationOwner(() => dependenciesRef.current);

  const discardControllerPreview = useCallback(() => {
    const controller = controllerRef.current;
    const currentGeneration = dependenciesRef.current.getRendererGeneration();
    controller?.invalidatePendingLaunch();
    if (controller?.state) {
      if (controllerRendererGenerationRef.current === currentGeneration) {
        controller.finish(null, { active: false, provenance: [] }, false);
      } else controller.abandonRendererGeneration();
    }
    controllerDocumentIdRef.current = null;
    controllerDocumentRevisionRef.current = null;
    controllerRendererRef.current = null;
    controllerRendererGenerationRef.current = null;
    controllerSelectionLeaseRef.current = null;
  }, []);

  const discardOwnedTransformPreview = useCallback(() => {
    temporaryMoveRef.current = false;
    temporaryMoveOwnerToolRef.current = null;
    auxiliaryOwnerRef.current?.discard();
    discardControllerPreview();
    setFrameOverride(null);
    setState(null);
  }, [discardControllerPreview, setFrameOverride]);

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
    () => Boolean(controllerRef.current?.state || auxiliaryOwnerRef.current?.active),
    []
  );

  const applyFinishedTransform = useCallback((
       result: ReturnType<TransformController['finish']>,
    beforeSelectionMask: SelectionMaskSnapshot | null,
    transaction: DocumentMutationTransaction | null,
    renderer: TransformEditorRendererPort | null,
    rendererGeneration: number | null,
    openingSelectionLease: LightTableSelectionReadLease | null
  ) => publicationOwnerRef.current!.apply({
    result,
    beforeSelectionMask,
    transaction,
    renderer,
    rendererGeneration,
    openingSelectionLease
  }), []);

  const finish = useCallback((commit: boolean): Promise<void> => {
    temporaryMoveRef.current = false;
    temporaryMoveOwnerToolRef.current = null;
    setFrameOverride(null);
    if (auxiliaryOwnerRef.current?.active) {
      const transaction = documentTransactionRef.current;
      const current = dependenciesRef.current;
      const result = auxiliaryOwnerRef.current.finish(commit, current.getDocument());
      setState(null);
      if (result.kind === 'none' || result.kind === 'cancelled' || result.kind === 'unchanged') {
        transaction?.cancel();
        return finishPromiseRef.current;
      }
      if (result.kind === 'error') {
        transaction?.cancel();
        current.setError(result.message);
        return finishPromiseRef.current;
      }
      if (!transaction?.stage(() => result.after) || !transaction.commit()) {
        current.setError(`The layer ${result.target} transform could not be committed.`);
      } else {
        try {
          current.onAuxiliaryTransformCommitted?.(result.target, result.layerIds);
        } catch {
          current.setError(
            `The layer ${result.target} transform was committed, but its notification failed.`
          );
        }
      }
      return finishPromiseRef.current;
    }
    const controller = controllerRef.current;
    if (!controller?.state) return finishPromiseRef.current;
    const current = dependenciesRef.current;
    const transaction = documentTransactionRef.current;
    const document = current.getDocument();
    const openingSelectionLease = controllerSelectionLeaseRef.current;
    const currentSelectionLease = current.getSelectionLease();
    const belongsToActiveDocument = Boolean(
      document
      && document.id === controllerDocumentIdRef.current
      && document.revision === controllerDocumentRevisionRef.current
      && current.getRenderer() === controllerRendererRef.current
      && current.getRendererGeneration() === controllerRendererGenerationRef.current
      && openingSelectionLease
      && currentSelectionLease
      && currentSelectionLease.document.sessionId === openingSelectionLease.document.sessionId
      && currentSelectionLease.document.revision === openingSelectionLease.document.revision
      && currentSelectionLease.selection.revision === openingSelectionLease.selection.revision
      && currentSelectionLease.selection.coverage === openingSelectionLease.selection.coverage
    );
    const transformDelta = controller.state?.matrix ?? null;
    const rendererGenerationCurrent = current.getRendererGeneration()
      === controllerRendererGenerationRef.current;
    const result = rendererGenerationCurrent
      ? controller.finish(
          belongsToActiveDocument ? document : null,
          belongsToActiveDocument && currentSelectionLease
            ? {
                active: currentSelectionLease.selection.active,
                provenance: currentSelectionLease.selection.provenance
              }
            : { active: false, provenance: [] },
          commit && belongsToActiveDocument
        )
      : (controller.abandonRendererGeneration(), { kind: 'cancelled' as const });
    controllerDocumentIdRef.current = null;
    controllerDocumentRevisionRef.current = null;
    const openingRenderer = controllerRendererRef.current;
    const openingRendererGeneration = controllerRendererGenerationRef.current;
    controllerRendererRef.current = null;
    controllerRendererGenerationRef.current = null;
    controllerSelectionLeaseRef.current = null;
    const beforeSelectionMask = openingSelectionLease?.selection.coverage ?? null;
    setState(null);
    if (commit && result.kind === 'layer' && transformDelta
      && !matrixApproximatelyEqual(transformDelta, identityMatrix())) {
      lastLayerTransformRef.current = { ...transformDelta };
    }
    if (commit && !belongsToActiveDocument) {
      transaction?.cancel();
      current.setError('The document or selection changed during the transform; the preview was discarded.');
      return finishPromiseRef.current;
    }
    const pending = applyFinishedTransform(
      result,
      beforeSelectionMask,
      transaction,
      openingRenderer,
      openingRendererGeneration,
      openingSelectionLease
    )
      .catch((reason) => {
        dependenciesRef.current.setError(
          reason instanceof Error ? reason.message : 'The transform could not be finished.'
        );
      })
      .finally(() => { controllerSelectionLeaseRef.current = null; });
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

  const beginNow = useCallback(async (reportEmptyLayer = true, allowInactiveTool = false) => {
    if (isActive()) await finish(true);
    await finishPromiseRef.current;
    const current = dependenciesRef.current;
    if (!await publicationOwnerRef.current!.recover()) {
      current.setError(
        'Transform is blocked until the previous GPU/document rollback can be recovered.'
      );
      return;
    }
    const document = current.getDocument();
    const renderer = current.getRenderer();
    const rendererGeneration = current.getRendererGeneration();
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
        && latest.getRenderer() === renderer
        && latest.getRendererGeneration() === rendererGeneration
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
      discardControllerPreview();
      auxiliaryOwnerRef.current!.admitMask({
        before: document,
        renderer,
        rendererGeneration,
        layerId: activeLayer.id,
        layerTransform: { ...activeLayer.transform },
        maskTransform: { ...activeLayer.mask.transform },
        linked: activeLayer.mask.linked,
        bounds: transformedBounds(activeLayer.mask.transform, measured.coreBounds)
      });
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
      discardControllerPreview();
      auxiliaryOwnerRef.current!.admitGroup({
        before: document,
        renderer,
        rendererGeneration,
        layerIds: groupIds,
        requestedSelectionKey,
        bounds
      });
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
    const controller = controllerRef.current && controllerRendererRef.current === renderer
      && controllerRendererGenerationRef.current === rendererGeneration
      ? controllerRef.current
      : new TransformController(renderer);
    controllerRef.current = controller;
    controllerRendererRef.current = renderer;
    controllerRendererGenerationRef.current = rendererGeneration;
    controllerDocumentIdRef.current = document.id;
    controllerDocumentRevisionRef.current = document.revision;
    let selectionLease: LightTableSelectionReadLease | null = null;
    try {
      selectionLease = current.getSelectionLease();
    } catch (reason) {
      transaction.cancel();
      current.setError(reason instanceof Error
        ? reason.message : 'The committed selection is unavailable.');
      return;
    }
    if (!selectionLease) {
      transaction.cancel();
      current.setError('The committed selection is unavailable.');
      return;
    }
    controllerSelectionLeaseRef.current = selectionLease;
    const result = await controller.begin(document, {
      active: selectionLease.selection.active,
      provenance: selectionLease.selection.provenance
    });
    if (!launchIsCurrent() || !transaction.active) {
      if (result.ok) controller.finish(null, { active: false, provenance: [] }, false);
      transaction.cancel();
      if (controllerRef.current === controller) {
        controllerDocumentIdRef.current = null;
        controllerDocumentRevisionRef.current = null;
        controllerSelectionLeaseRef.current = null;
        setState(null);
      }
      return;
    }
    const latestLease = dependenciesRef.current.getSelectionLease();
    if (!latestLease
      || latestLease.document.sessionId !== selectionLease.document.sessionId
      || latestLease.document.revision !== selectionLease.document.revision
      || latestLease.selection.revision !== selectionLease.selection.revision
      || latestLease.selection.coverage !== selectionLease.selection.coverage) {
      if (result.ok) controller.finish(null, { active: false, provenance: [] }, false);
      transaction.cancel();
      controllerSelectionLeaseRef.current = null;
      return;
    }
    if (result.ok) {
      setState(result.state);
      current.setError(null);
      if (result.notice) current.setStatus(result.notice);
      return;
    }
    controllerSelectionLeaseRef.current = null;
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
  }, [beginDocumentTransaction, discardControllerPreview, finish, isActive, setFrameOverride]);

  const begin = useCallback((reportEmptyLayer = true, allowInactiveTool = false) => {
    const launch = launchPromiseRef.current.then(() => beginNow(
      reportEmptyLayer, allowInactiveTool
    ));
    launchPromiseRef.current = launch.catch((reason) => {
      dependenciesRef.current.setError(
        reason instanceof Error ? reason.message : 'The transform could not be opened.'
      );
    });
    return launch;
  }, [beginNow]);

  const checkpoint = useCallback(() => {
    const active = controllerRef.current?.state ?? (state ? {
      ...state,
      matrix: auxiliaryOwnerRef.current?.matrix ?? state.matrix
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
      matrix: auxiliaryOwnerRef.current?.matrix ?? state.matrix
    } : null);
    if (!active || active.projectiveQuad) return;
    const frame = frameOverrideRef.current
      ?? transformSessionFrame(active, dependenciesRef.current.transformFrameMode ?? 'local');
    const aligned = alignTransformFrameToDocument(active, frame);
    if (aligned) setFrameOverride(aligned);
  }, [setFrameOverride, state]);

  const update = useCallback((matrix: AffineMatrix) => {
    if (auxiliaryOwnerRef.current?.active) {
      if (!auxiliaryOwnerRef.current.update(matrix)) return null;
      const next = state ? { ...state, matrix: { ...matrix } } : null;
      if (auxiliaryOwnerRef.current.kind === 'mask' && next) setState(next);
      return next;
    }
    // Single-layer pointer previews are renderer-owned transient state. React
    // receives the durable checkpoint once, after pointer-up.
    if (dependenciesRef.current.getRendererGeneration()
      !== controllerRendererGenerationRef.current) return null;
    return controllerRef.current?.update(matrix) ?? null;
  }, [state]);

  const updateProjective = useCallback((quad: TransformQuad) => {
    if (auxiliaryOwnerRef.current?.kind === 'mask') return null;
    if (dependenciesRef.current.getRendererGeneration()
      !== controllerRendererGenerationRef.current) return null;
    return controllerRef.current?.updateProjective(quad) ?? null;
  }, []);

  const applyFixed = useCallback(async (operation: FixedTransformOperation) => {
    if (isActive()) await finish(true);
    // Menu and command-layer fixed transforms are one-shot operations. They
    // use the same selection-aware transform transaction without requiring
    // the interactive Transform tool or its gizmo to be active first.
    await begin(true, true);
    const active = controllerRef.current?.state;
    const bounds = active?.sourceBounds ?? auxiliaryOwnerRef.current?.bounds;
    if (!bounds) return null;
    const target: FixedTransformTarget = auxiliaryOwnerRef.current?.kind === 'mask'
      ? 'mask'
      : auxiliaryOwnerRef.current?.kind === 'group' ? 'layer-group' : active?.sourceKind ?? 'layer';
    update(fixedTransformDelta(operation, bounds));
    await finish(true);
    dependenciesRef.current.setStatus(operation.startsWith('rotate') ? 'Layer rotated' : 'Layer flipped');
    return target;
  }, [begin, finish, isActive, update]);

  const nudge = useCallback((x: number, y: number) => {
    if (auxiliaryOwnerRef.current?.active) {
      const currentMatrix = auxiliaryOwnerRef.current.matrix ?? identityMatrix();
      const matrix = multiplyMatrices(
        { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y },
        currentMatrix
      );
      if (update(matrix)) setState((current) => current ? { ...current, matrix } : current);
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
      (before) => repeatLayerTransform(before, delta, duplicate),
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
    await launchPromiseRef.current;
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
    publicationOwnerRef.current?.retireStaleScope();
    const documentTransaction = documentTransactionRef.current;
    const generationChanged = (
      controllerRendererGenerationRef.current !== null
      && controllerRendererGenerationRef.current !== dependencies.rendererGeneration
    ) || (
      auxiliaryOwnerRef.current?.rendererGeneration !== null
      && auxiliaryOwnerRef.current?.rendererGeneration !== dependencies.rendererGeneration
    );
    if (generationChanged) {
      documentTransaction?.cancel();
      discardOwnedTransformPreview();
      return;
    }
    if (
      documentTransaction?.active
      && documentTransaction.documentId !== dependencies.activeDocument?.id
    ) {
      documentTransaction.cancel();
      return;
    }
    const controller = controllerRef.current;
    if (
      controllerDocumentIdRef.current
      && controllerDocumentIdRef.current !== dependencies.activeDocument?.id
    ) {
      controller?.invalidatePendingLaunch();
      if (controller?.state) {
        controller.finish(null, { active: false, provenance: [] }, false);
      }
      controllerRef.current = null;
      controllerDocumentIdRef.current = null;
      controllerDocumentRevisionRef.current = null;
      controllerRendererRef.current = null;
      controllerSelectionLeaseRef.current = null;
      setState(null);
    }
    const activeController = controllerRef.current;
    const temporaryMoveStillOwned = temporaryMoveRef.current
      && dependencies.activeTool === temporaryMoveOwnerToolRef.current;
    if (dependencies.activeTool !== 'transform' && !temporaryMoveStillOwned) {
      automaticLaunchKeyRef.current = null;
      activeController?.invalidatePendingLaunch();
      if (activeController?.state || auxiliaryOwnerRef.current?.active) void finish(true);
      return;
    }
    const activeGroupKey = auxiliaryOwnerRef.current?.requestedSelectionKey ?? null;
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
      ?? auxiliaryOwnerRef.current?.layerId
      ?? null;
    if (activeSessionLayerId && activeSessionLayerId !== dependencies.activeLayerId) {
      void finish(true);
      return;
    }
    if (auxiliaryOwnerRef.current?.kind === 'mask' && dependencies.activeChannel !== 'mask') {
      void finish(true);
      return;
    }
    if (activeController?.state || auxiliaryOwnerRef.current?.active) return;
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
    dependencies.rendererGeneration,
    dependencies.selectionRevision,
    discardOwnedTransformPreview,
    finish,
    selectedLayerKey,
    transformTargetLayerIds.length
  ]);

  useEffect(() => () => {
    const currentGeneration = dependenciesRef.current.getRendererGeneration();
    const documentTransaction = documentTransactionRef.current;
    documentTransactionRef.current = null;
    documentTransaction?.cancel();
    const controller = controllerRef.current;
    controller?.invalidatePendingLaunch();
    if (controller?.state) {
      if (controllerRendererGenerationRef.current === currentGeneration) {
        controller.finish(null, { active: false, provenance: [] }, false);
      } else controller.abandonRendererGeneration();
    }
    auxiliaryOwnerRef.current?.discard();
    publicationOwnerRef.current?.dispose();
    controllerRef.current = null;
    controllerDocumentIdRef.current = null;
    controllerDocumentRevisionRef.current = null;
    controllerRendererRef.current = null;
    controllerRendererGenerationRef.current = null;
    controllerSelectionLeaseRef.current = null;
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
