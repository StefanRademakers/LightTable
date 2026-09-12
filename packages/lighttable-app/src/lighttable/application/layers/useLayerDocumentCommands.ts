import { useMemo, useRef } from 'react';
import type {
  ImageDocument,
  LayerId,
  LayerNode,
  RasterLayer,
  Rect
} from '../../editor/document/documentTypes';
import { layerIsLocked } from '../../editor/document/documentTypes';
import {
  duplicateLayer as duplicateDocumentLayer,
  createRasterLayer,
  flattenGroup,
  flattenImage,
  getFlattenGroupPlan,
  getFlattenGroupEligibility,
  getFlattenImagePlan,
  getMergeLayersEligibility,
  markLayerMaskPixelsChanged,
  markLayerPixelsChanged,
  mergeLayers as mergeDocumentLayers,
  moveLayerRelative,
  rasterizeLayer as rasterizeDocumentLayer
} from '../../editor/document/documentCommands';
import { createPlacedRasterLayer } from '../../editor/document/placedRasterLayerCommand';
import {
  findDocumentLayer,
  findRasterLayer,
  siblingLayers
} from '../../editor/document/layerTree';
import type { ReversiblePixelEdit } from '../../editor/history/ReversiblePixelEdit';
import type { DocumentAssetBlob } from '../../editor/persistence/layeredDocumentFormat';
import type { PaintChannel } from '../../editor/session/editorSession';
import type { SelectionOperation } from '../../editor/selection/selectionTypes';
import type { RasterSelectionMask } from '../../editor/selection/selectionTypes';
import {
  cloneAdjustments,
  createDefaultAdjustments,
  type BasicAdjustments
} from '../../types';
import type { LightTableImageClipboard } from '../../../platform/LightTableImageClipboard';
import type {
  AdjustmentInitialSettings,
  AdjustmentLayerKind
} from '../../processing/adjustmentLayerCatalog';
import { runEditorOperationTransaction } from '../commands/editorOperationTransaction';
import {
  reserveAppliedPixelMutation,
  type AppliedPixelMutationReservation
} from '../commands/pixelMutationTransaction';
import type {
  DocumentMutationController,
  DocumentMutationDescription,
  DocumentMutationTransaction
} from '../documents/useDocumentMutationController';
import type { VectorElementCreationTransaction } from '../vectors/VectorDocumentController';
import type { LightTableSelectionReadLease } from '../tools/selection/DocumentSelectionStateStore';
import { createRemoveLayerMaskCommand } from './removeLayerMaskCommand';
import { createApplyLayerMaskCommand } from './applyLayerMaskCommand';
import { createApplyBackgroundRemovalMaskCommand } from './applyBackgroundRemovalMaskCommand';
import { createAddLayerMaskCommand } from './addLayerMaskCommand';
import { commitAdjustmentLayerDuplicate } from '../adjustments/duplicateAdjustmentLayerCommand';
import type { DocumentHistoryReservation } from '../commands/documentCommandHistory';
import {
  commitRasterFinalization,
  publishRasterFinalization,
  type RasterFinalizationMutation,
  type RasterFinalizationHistoryEntry
} from './rasterFinalizationTransaction';
import { createPixelClipboardController } from '../clipboard/pixelClipboardController';
import type {
  PixelClipboardCapture,
  PixelClipboardPasteResult,
  PixelClipboardPlacement
} from '../clipboard/pixelClipboardTypes';
import { createLayerProcessingCreationCommands, type ProcessingCreationFeedback } from './layerProcessingCreationCommands';
import { createLayerFinalizationReadiness, type LayerFinalizationScope } from './LayerFinalizationReadiness';

export type FlattenRequest =
  | { kind: 'group'; groupId: LayerId }
  | { kind: 'image' };

export type LayerCommandHistoryEntry = RasterFinalizationHistoryEntry;

export interface LayerCommandRendererPort {
  duplicateLayerPixels(sourceId: LayerId, destinationId: LayerId): boolean;
  copyLayerMask(sourceId: LayerId, destinationId: LayerId): boolean;
  beginLayerPixelEdit(layerId: LayerId, channel?: PaintChannel): void;
  captureAllPixelEdit(layerId: LayerId, channel?: PaintChannel): number;
  mergeLayers(
    document: ImageDocument,
    layerIds: readonly LayerId[],
    destinationId: LayerId
  ): boolean;
  flattenGroup(document: ImageDocument, groupId: LayerId, destinationId: LayerId): boolean;
  flattenImage(document: ImageDocument, destinationId: LayerId): boolean;
  prepareRasterDestination(destination: import('../../editor/document/documentTypes').RasterLayer): boolean;
  commitRasterDestination(layerId: LayerId): void;
  releaseRasterDestination(layerId: LayerId): boolean;
  rasterizeLayer(
    document: ImageDocument,
    sourceId: LayerId,
    destinationId: LayerId
  ): boolean;
  waitForLayerFinalizationSources(scope: 'layer' | 'document'): Promise<boolean>;
  waitForTextSource(layerId: LayerId): Promise<boolean>;
  invertLayerColors(layerId: LayerId, channel?: PaintChannel): boolean;
  bakeSelectionIntoLayerMask(layerId: LayerId): boolean;
  applyGeneratedLayerMask(
    layerId: LayerId,
    mask: RasterSelectionMask,
    mode: 'replace' | 'intersect'
  ): boolean;
  applyLayerMaskToPixels(document: ImageDocument, layerId: LayerId): boolean;
  copySelectedLayerContent(document: ImageDocument, layerId: LayerId): boolean;
  exportSelectionClipboard(bounds: Rect): Promise<Blob>;
  exportMergedSelection(bounds: Rect): Promise<Blob>;
  pasteClipboardImage(
    layerId: LayerId,
    blob: Blob,
    position: { x: number; y: number } | null,
    channel?: PaintChannel
  ): Promise<boolean>;
  loadLayerAssets(assets: DocumentAssetBlob[]): Promise<void>;
  pasteSelectionClipboard(layerId: LayerId): boolean;
  hasSelectionClipboard(): boolean;
  finishPixelEdit(): ReversiblePixelEdit | null;
  cancelPixelEdit(): void;
  applyPixelHistory(
    edit: ReversiblePixelEdit,
    direction: 'undo' | 'redo'
  ): boolean;
}

export interface LayerDocumentCommandDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): LayerCommandRendererPort | null;
  getRendererGeneration(): number;
  captureFinalizationScope(): LayerFinalizationScope;
  captureProcessingCreationFeedback(): ProcessingCreationFeedback;
  getImageClipboard(): LightTableImageClipboard;
  getDocumentId(): string;
  getSelectionLease(): LightTableSelectionReadLease | null;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushDocumentHistory(before: ImageDocument, after: ImageDocument,
    description?: { readonly label: string; readonly type: string }): void;
  pushHistoryEntry(entry: LayerCommandHistoryEntry): void;
  reserveHistoryEntry(entry: LayerCommandHistoryEntry): DocumentHistoryReservation;
  setActiveChannel(channel: PaintChannel): void;
  setSelectionClipboardAvailable(available: boolean): void;
  setStatus(message: string | null): void;
  setError(message: string | null): void;
  getDocumentAdjustments(): BasicAdjustments;
  getPanelAdjustments(): BasicAdjustments;
  publishDocumentAdjustments(adjustments: BasicAdjustments): void;
  publishPanelAdjustments(adjustments: BasicAdjustments): void;
  getGlobalGradeStrength(): number;
  publishGlobalGradeStrength(strength: number): void;
}

export interface LayerDocumentCommands {
  addActiveLayerMask(useSelection: boolean): boolean;
  addLayerMask(layerId: LayerId, useSelection: boolean, present?: boolean): boolean;
  removeLayerMask(layerId: LayerId, present?: boolean): boolean;
  applyLayerMask(layerId: LayerId, present?: boolean): boolean;
  applyBackgroundRemovalMask(
    layerId: LayerId,
    mask: RasterSelectionMask,
    mode: 'replace' | 'intersect' | 'new-layer'
  ): boolean;
  duplicateActiveLayer(): boolean;
  duplicateLayer(layerId: LayerId): LayerId | null;
  createAdjustmentLayer(): LayerId | null;
  createCurvesAdjustmentLayer(): LayerId | null;
  createLensFxLayer(): LayerId | null;
  createAdjustmentLayerOfKind(kind: AdjustmentLayerKind, aboveLayerId?: LayerId,
    settings?: AdjustmentInitialSettings): LayerId | null;
  createAttachedAdjustment(layerId: LayerId, kind: AdjustmentLayerKind,
    settings?: AdjustmentInitialSettings): string | null;
  rasterizeVectorCreation(
    transaction: VectorElementCreationTransaction,
    rendererGeneration: number
  ): Promise<boolean>;
  mergeLayersWhenReady(selectedLayerIds: LayerId[]): Promise<LayerId>;
  flattenWhenReady(request: FlattenRequest): Promise<LayerId>;
  rasterizeTextLayerWhenReady(layerId: LayerId): Promise<LayerId>;
  rasterizeLayerWhenReady(layerId: LayerId): Promise<LayerId>;
  invertLayerColors(layerId: LayerId, channel: PaintChannel): boolean;
  copySelectedContent(selection: readonly SelectionOperation[]): Promise<PixelClipboardCapture | null>;
  copyMergedContent(selection: readonly SelectionOperation[]): Promise<PixelClipboardCapture | null>;
  pastePixelArtifact(file: File, placement: PixelClipboardPlacement,
    fastPasteToken?: string): Promise<PixelClipboardPasteResult | null>;
  placeImageArtifact(file: File, placement?: {
    readonly name?: string;
    readonly x?: number;
    readonly y?: number;
  }): Promise<{ readonly layerId: LayerId; readonly width: number; readonly height: number } | null>;
  layerViaCopy(layerId: LayerId): {
    readonly layerId: LayerId;
    readonly scope: 'layer' | 'selection';
  } | null;
}

export type { PixelClipboardCapture, PixelClipboardPasteResult, PixelClipboardPlacement };

const fullDocumentBounds = (document: ImageDocument) => ({
  x: 0,
  y: 0,
  width: document.width,
  height: document.height
});

const retainedLayerRuntimeIds = (nodes: readonly LayerNode[]): LayerId[] =>
  nodes.flatMap((node) => [
    node.id,
    ...(node.type === 'group' ? retainedLayerRuntimeIds(node.children) : [])
  ]);

const estimateRetainedLayerRuntimeBytes = (
  document: ImageDocument,
  nodes: readonly LayerNode[],
  includeDestination = true
): number => {
  const canvasPixels = document.width * document.height;
  const visit = (node: LayerNode): number => {
    const maskBytes = node.mask
      ? canvasPixels * 2
      : 0;
    const previewBytes = node.derivedPreview
      ? Math.max(1, node.derivedPreview.width) * Math.max(1, node.derivedPreview.height) * 8
      : 0;
    if (node.type === 'group') {
      return maskBytes + previewBytes
        + node.children.reduce((total, child) => total + visit(child), 0);
    }
    if (node.type === 'adjustment') return maskBytes + previewBytes;
    const colorBytes = node.type === 'raster'
      ? node.width * node.height * 8
      : canvasPixels * 8;
    return colorBytes + maskBytes + previewBytes;
  };
  const sourceBytes = nodes.reduce((total, node) => total + visit(node), 0);
  return sourceBytes + (includeDestination ? canvasPixels * 8 : 0);
};

/**
 * Owns renderer-backed layer mutations as atomic application transactions.
 *
 * React chooses the command and presents errors. This controller alone
 * coordinates document snapshots, GPU pixel edits, undo resources and the
 * active edit channel. Dependencies are resolved at invocation time so an
 * inactive workspace document can never receive a command from a stale render.
 */
export const createLayerDocumentCommands = (
  resolveDependencies: () => LayerDocumentCommandDependencies
): LayerDocumentCommands => {
  const dependenciesRef = {
    get current() {
      return resolveDependencies();
    }
  };
  const pixelClipboard = createPixelClipboardController(() => dependenciesRef.current);

  const waitForTextTargets = createLayerFinalizationReadiness(() => dependenciesRef.current);

  const applyDocumentTransition = (
    operation: string,
    before: ImageDocument,
    after: ImageDocument
  ) => runEditorOperationTransaction({ operation }, (transaction) => {
    transaction.step(
      'publish document snapshot',
      () => dependenciesRef.current.applyDocumentSnapshot(after),
      () => dependenciesRef.current.applyDocumentSnapshot(before)
    );
  });

  const beginDocumentTransaction = (
    owner: string,
    description: DocumentMutationDescription
  ) => {
    const transaction = dependenciesRef.current.documentMutations.begin(owner, description);
    if (!transaction) {
      dependenciesRef.current.setError(
        `${description.label} cannot start while another document operation is completing.`
      );
    }
    return transaction;
  };

  const commitDocumentTransition = (
    transaction: DocumentMutationTransaction,
    after: ImageDocument,
    description: { readonly label: string; readonly type: string }
  ) => {
    if (!transaction.stage(() => after)) {
      transaction.cancel();
      return false;
    }
    return transaction.commit(description);
  };

  const discardUnpublishedPixelEdit = (edit: ReversiblePixelEdit | null) => {
    if (!edit) return;
    try {
      edit.undo();
    } finally {
      edit.destroy();
    }
  };

  const publishReservedRasterMutation = (mutation: RasterFinalizationMutation) => {
    const dependencies = dependenciesRef.current;
    const renderer = dependencies.getRenderer();
    if (!renderer) return false;
    try {
      publishRasterFinalization({
        renderer,
        reserveHistoryEntry: dependencies.reserveHistoryEntry,
        applyDocumentSnapshot: dependencies.applyDocumentSnapshot,
        reportError: dependencies.setError
      }, mutation);
      return true;
    } catch (reason) {
      dependencies.setError(
        reason instanceof Error ? reason.message : mutation.errorMessage
      );
      return false;
    }
  };

  const commitReservedRasterMutation = ({
    transaction,
    ...mutation
  }: {
    readonly transaction: DocumentMutationTransaction;
    readonly operation: string;
    readonly current: ImageDocument;
    readonly next: ImageDocument;
    readonly destination: RasterLayer;
    readonly render: () => boolean;
    readonly historyEntry: LayerCommandHistoryEntry;
    readonly processing?: {
      readonly publish: () => void;
      readonly restore: () => void;
    };
    readonly rollbackDocument?: ImageDocument;
    readonly errorMessage: string;
  }): boolean => {
    const dependencies = dependenciesRef.current;
    const renderer = dependencies.getRenderer();
    if (!renderer) {
      transaction.cancel();
      return false;
    }
    return commitRasterFinalization({
      renderer,
      reserveHistoryEntry: dependencies.reserveHistoryEntry,
      applyDocumentSnapshot: dependencies.applyDocumentSnapshot,
      reportError: dependencies.setError
    }, transaction, mutation);
  };

  const commitLoadedRasterLayer = async ({
    transaction,
    operation,
    next,
    destination,
    assets,
    description,
    errorMessage
  }: {
    readonly transaction: DocumentMutationTransaction;
    readonly operation: string;
    readonly next: ImageDocument;
    readonly destination: RasterLayer;
    readonly assets: DocumentAssetBlob[];
    readonly description: { readonly label: string; readonly type: string };
    readonly errorMessage: string;
  }): Promise<boolean> => {
    if (!transaction.stage(() => next)) {
      transaction.cancel();
      return false;
    }
    return transaction.commitWithAsync(async (ownedBefore, ownedAfter) => {
      const dependencies = dependenciesRef.current;
      const renderer = dependencies.getRenderer();
      if (!renderer) return false;
      const rendererGeneration = dependencies.getRendererGeneration();
      const historyReservation = dependencies.reserveHistoryEntry({
        label: description.label,
        type: description.type,
        byteSize: Math.max(1, destination.width) * Math.max(1, destination.height) * 8,
        layerIds: [destination.id],
        undo: () => applyDocumentTransition(`Undo ${description.label}`, ownedAfter, ownedBefore),
        redo: () => applyDocumentTransition(`Redo ${description.label}`, ownedBefore, ownedAfter)
      });
      let ownsReservation = false;
      const releaseReservation = () => {
        if (!ownsReservation) return;
        renderer.releaseRasterDestination(destination.id);
        ownsReservation = false;
      };
      try {
        if (!renderer.prepareRasterDestination(destination)) {
          throw new Error('The raster destination could not be allocated on the GPU.');
        }
        ownsReservation = true;
        await renderer.loadLayerAssets(assets);
        const current = dependenciesRef.current;
        if (current.getRenderer() !== renderer
          || current.getRendererGeneration() !== rendererGeneration
          || current.getDocument() !== ownedBefore) {
          throw new Error(`${description.label} was cancelled because its document renderer changed.`);
        }
        runEditorOperationTransaction({ operation }, (publication) => {
          publication.adopt('release reserved raster destination', releaseReservation);
          publication.step(
            'publish document snapshot',
            () => dependencies.applyDocumentSnapshot(ownedAfter),
            () => dependencies.applyDocumentSnapshot(ownedBefore)
          );
          if (!historyReservation.commit()) {
            throw new Error(`${description.label} history admission expired.`);
          }
          // Durable history now retains the destination runtime. Releasing the
          // temporary allocation marker is administrative and cannot invalidate
          // an accepted command.
          try {
            renderer.commitRasterDestination(destination.id);
          } catch (reason) {
            console.error('Raster destination reservation cleanup failed.', reason);
          }
          ownsReservation = false;
        });
        return true;
      } catch (reason) {
        historyReservation.cancel();
        releaseReservation();
        dependencies.setError(reason instanceof Error ? reason.message : errorMessage);
        return false;
      }
    });
  };

  const addMaskCommands = createAddLayerMaskCommand(() => {
    const dependencies = dependenciesRef.current;
    return {
      getDocument: dependencies.getDocument,
      getRenderer: dependencies.getRenderer,
      applyDocumentSnapshot: dependencies.applyDocumentSnapshot,
      reserveHistoryEntry: (entry) => dependencies.reserveHistoryEntry(entry),
      setActiveChannel: dependencies.setActiveChannel,
      setStatus: dependencies.setStatus,
      setError: dependencies.setError
    };
  }, beginDocumentTransaction);

  const removeMaskFromLayer = createRemoveLayerMaskCommand(() => {
    const dependencies = dependenciesRef.current;
    return {
      getRenderer: dependencies.getRenderer,
      applyDocumentSnapshot: dependencies.applyDocumentSnapshot,
      reserveHistoryEntry: (entry) => dependencies.reserveHistoryEntry(entry),
      setActiveChannel: dependencies.setActiveChannel,
      setStatus: dependencies.setStatus,
      setError: dependencies.setError
    };
  }, beginDocumentTransaction);

  const applyMaskToLayer = createApplyLayerMaskCommand(() => {
    const dependencies = dependenciesRef.current;
    return {
      getRenderer: dependencies.getRenderer,
      applyDocumentSnapshot: dependencies.applyDocumentSnapshot,
      reserveHistoryEntry: (entry) => dependencies.reserveHistoryEntry(entry),
      setActiveChannel: dependencies.setActiveChannel,
      setStatus: dependencies.setStatus,
      setError: dependencies.setError
    };
  }, beginDocumentTransaction);

  const duplicateLayer = (sourceId: LayerId): LayerId | null => {
    const dependencies = dependenciesRef.current;
    const description = { label: 'Duplicate Layer', type: 'layer.duplicate' } as const;
    const transaction = beginDocumentTransaction(`layer.duplicate:${sourceId}`, description);
    if (!transaction) return null;
    const current = transaction.before;
    const source = findDocumentLayer(current, sourceId);
    const next = duplicateDocumentLayer(current, sourceId);
    if (next === current || !next.activeLayerId) {
      transaction.cancel();
      return null;
    }
    const destinationId = next.activeLayerId;

    try {
      if (source?.type === 'raster') {
        const destination = findRasterLayer(next, destinationId);
        const renderer = dependencies.getRenderer();
        if (!destination || !renderer || !commitReservedRasterMutation({
          transaction,
          operation: 'Duplicate Layer',
          current,
          next,
          destination,
          render: () => renderer.duplicateLayerPixels(sourceId, destinationId),
          historyEntry: {
            label: 'Duplicate Layer',
            type: 'layer.duplicate',
            layerIds: [sourceId, destinationId],
            undo: () => applyDocumentTransition('Undo Duplicate Layer', next, current),
            redo: () => applyDocumentTransition('Redo Duplicate Layer', current, next)
          },
          errorMessage: 'The layer pixels could not be duplicated.'
        })) return null;
      } else if (source?.type === 'adjustment' && source.mask) {
        const renderer = dependencies.getRenderer();
        if (!renderer) {
          transaction.cancel();
          return null;
        }
        const committed = commitAdjustmentLayerDuplicate({
          transaction,
          next,
          sourceId,
          destinationId,
          renderer,
          resolveDependencies: () => dependenciesRef.current
        });
        if (!committed) return null;
      } else {
        if (!commitDocumentTransition(transaction, next, description)) return null;
      }
    } catch (reason) {
      transaction.cancel();
      dependencies.setError(
        reason instanceof Error ? reason.message : 'The layer could not be duplicated.'
      );
      return null;
    }
    dependencies.setActiveChannel('pixels');
    dependencies.setError(null);
    return destinationId;
  };

  const duplicateActiveLayer = () => {
    const activeLayerId = dependenciesRef.current.getDocument()?.activeLayerId;
    return activeLayerId ? duplicateLayer(activeLayerId) !== null : false;
  };

  const applyBackgroundRemovalMask = createApplyBackgroundRemovalMaskCommand(() => {
    const dependencies = dependenciesRef.current;
    return {
      getRenderer: dependencies.getRenderer,
      applyDocumentSnapshot: dependencies.applyDocumentSnapshot,
      reserveHistoryEntry: (entry) => dependencies.reserveHistoryEntry(entry),
      setActiveChannel: dependencies.setActiveChannel,
      setStatus: dependencies.setStatus,
      setError: dependencies.setError
    };
  }, beginDocumentTransaction);

  const processingCreationCommands = createLayerProcessingCreationCommands({
    beginTransaction: beginDocumentTransaction,
    commitTransaction: commitDocumentTransition,
    captureFeedback: () => dependenciesRef.current.captureProcessingCreationFeedback()
  });
  const createProcessingLayer = processingCreationCommands.create;
  const createGradeAdjustmentLayer = () => createProcessingLayer('grade');
  const createCurvesAdjustmentLayer = () => createProcessingLayer('curves');
  const createLensFxLayer = () => createProcessingLayer('lens-fx');
  const createAttachedAdjustment = processingCreationCommands.attach;

  const mergeSelectedLayersInTransaction = (
    transaction: DocumentMutationTransaction,
    selectedLayerIds: readonly LayerId[]
  ) => {
    const current = transaction.before;
    const renderer = dependenciesRef.current.getRenderer();
    if (!renderer) {
      transaction.cancel();
      return false;
    }
    const eligibility = getMergeLayersEligibility(current, selectedLayerIds);
    if (!eligibility.ok) {
      transaction.cancel();
      dependenciesRef.current.setError(eligibility.message);
      return false;
    }
    const plan = eligibility.plan;

    const next = mergeDocumentLayers(current, plan.layerIds);
    const destination = findRasterLayer(next, next.activeLayerId);
    const retainedSources = plan.layerIds.map((layerId) => findDocumentLayer(current, layerId))
      .filter((layer): layer is LayerNode => Boolean(layer));
    if (next === current || !destination) {
      transaction.cancel();
      dependenciesRef.current.setError('The full-canvas merge destination could not be allocated.');
      return false;
    }
    if (!commitReservedRasterMutation({
      transaction,
      operation: 'Merge Layers',
      current,
      next,
      destination,
      render: () => renderer.mergeLayers(current, plan.layerIds, destination.id),
      historyEntry: {
        label: 'Merge Layers',
        type: 'layer.merge',
        byteSize: estimateRetainedLayerRuntimeBytes(current, retainedSources),
        layerIds: [...new Set([
          ...retainedLayerRuntimeIds(retainedSources), destination.id
        ])],
        undo: () => applyDocumentTransition('Undo Merge Layers', next, current),
        redo: () => applyDocumentTransition('Redo Merge Layers', current, next)
      },
      errorMessage: 'The selected layers could not be merged on the GPU.'
    })) return false;
    dependenciesRef.current.setActiveChannel('pixels');
    dependenciesRef.current.setError(null);
    dependenciesRef.current.setStatus('Layers merged');
    return destination.id;
  };

  const mergeSelectedLayers = (selectedLayerIds: LayerId[]) => {
    const description = { label: 'Merge Layers', type: 'layer.merge' } as const;
    const transaction = beginDocumentTransaction('layer.merge', description);
    return transaction
      ? mergeSelectedLayersInTransaction(transaction, selectedLayerIds)
      : false;
  };

  const rasterizeVectorCreation = async (
    transaction: VectorElementCreationTransaction,
    rendererGeneration: number
  ) => {
    const rejectCreation = (message: string) => {
      dependenciesRef.current.setError(message);
      return transaction.commitWith(() => false);
    };
    const dependencies = dependenciesRef.current;
    const renderer = dependencies.getRenderer();
    const liveDocument = dependencies.getDocument();
    if (!renderer
      || !liveDocument
      || liveDocument.id !== transaction.beforeDocument.id
      || liveDocument.revision !== transaction.beforeDocument.revision
      || dependencies.getRendererGeneration() !== rendererGeneration) {
      return rejectCreation('The shape preview is no longer the active document state.');
    }
    try {
      const readiness = await waitForTextTargets([], false, 'layer');
      readiness.assertCurrent();
    } catch (reason) {
      return rejectCreation(
        reason instanceof Error ? reason.message : 'The shape render source could not be prepared.'
      );
    }
    if (dependenciesRef.current.getRendererGeneration() !== rendererGeneration) {
      return rejectCreation('The shape renderer changed before its pixels could be committed.');
    }
    const siblings = siblingLayers(transaction.previewDocument, transaction.layerId);
    const shapeIndex = siblings.findIndex(({ id }) => id === transaction.layerId);
    const destinationSource = shapeIndex > 0 ? siblings[shapeIndex - 1] : null;
    if (destinationSource?.type !== 'raster') {
      return rejectCreation(
        'Pixels mode requires an editable raster layer directly below the new shape.'
      );
    }
    const layerIds = [destinationSource.id, transaction.layerId];
    const next = mergeDocumentLayers(transaction.previewDocument, layerIds);
    const destination = findRasterLayer(next, next.activeLayerId);
    if (next === transaction.previewDocument || !destination) {
      return rejectCreation('The GPU raster target for this shape could not be allocated.');
    }
    return transaction.commitWith(() => {
      if (!publishReservedRasterMutation({
      operation: 'Apply Shape to Pixels',
      current: transaction.previewDocument,
      rollbackDocument: transaction.beforeDocument,
      next,
      destination,
      render: () => renderer.mergeLayers(
        transaction.previewDocument,
        layerIds,
        destination.id
      ),
      historyEntry: {
        label: 'Apply Shape to Pixels',
        type: 'vector.shape.rasterize',
        byteSize: transaction.beforeDocument.width * transaction.beforeDocument.height * 8,
        layerIds: [...layerIds, destination.id],
        undo: () => applyDocumentTransition(
          'Undo Apply Shape to Pixels',
          next,
          transaction.beforeDocument
        ),
        redo: () => applyDocumentTransition(
          'Redo Apply Shape to Pixels',
          transaction.beforeDocument,
          next
        )
      },
      errorMessage: 'The shape could not be baked into the active raster layer.'
      })) return false;
      dependencies.setActiveChannel('pixels');
      dependencies.setError(null);
      dependencies.setStatus('Shape applied to pixels');
      return true;
    });
  };

  const mergeLayersWhenReady = async (selectedLayerIds: LayerId[]) => {
    const readiness = await waitForTextTargets(selectedLayerIds);
    readiness.assertCurrent();
    const destinationId = mergeSelectedLayers(selectedLayerIds);
    if (destinationId) return destinationId;
    throw new Error('The prepared layers could not be merged.');
  };

  const flatten = (request: FlattenRequest) => {
    const dependencies = dependenciesRef.current;
    const description = {
      label: request.kind === 'group' ? 'Flatten Group' : 'Flatten Image',
      type: request.kind === 'group' ? 'layer.flatten-group' : 'document.flatten'
    } as const;
    const documentTransaction = beginDocumentTransaction(description.type, description);
    if (!documentTransaction) return false;
    const current = documentTransaction.before;
    const renderer = dependencies.getRenderer();
    if (!renderer) {
      documentTransaction.cancel();
      return false;
    }
    const resetsDocumentFinalState = request.kind === 'image';
    const previousDocumentAdjustments = resetsDocumentFinalState
      ? cloneAdjustments(dependencies.getDocumentAdjustments())
      : null;
    const previousPanelAdjustments = resetsDocumentFinalState
      ? cloneAdjustments(dependencies.getPanelAdjustments())
      : null;
    const previousGlobalGradeStrength = resetsDocumentFinalState
      ? dependencies.getGlobalGradeStrength()
      : 100;
    const neutralAdjustments = createDefaultAdjustments();
    const groupEligibility = request.kind === 'group'
      ? getFlattenGroupEligibility(current, request.groupId)
      : null;
    const plan = request.kind === 'group'
      ? groupEligibility?.ok ? groupEligibility.plan : null
      : getFlattenImagePlan(current);
    if (!plan) {
      documentTransaction.cancel();
      dependencies.setError(
        request.kind === 'group'
          ? groupEligibility && !groupEligibility.ok
            ? groupEligibility.message
            : 'The target must be a non-empty group.'
          : 'This image has no layers to flatten.'
      );
      return false;
    }

    const next = request.kind === 'group'
      ? flattenGroup(current, request.groupId)
      : flattenImage(current);
    const destination = findRasterLayer(next, next.activeLayerId);
    const retainedSources = request.kind === 'group'
      ? [findDocumentLayer(current, request.groupId)].filter(
        (layer): layer is LayerNode => Boolean(layer)
      )
      : current.layers;
    if (next === current || !destination) {
      documentTransaction.cancel();
      dependenciesRef.current.setError('The full-canvas flatten destination could not be allocated.');
      return false;
    }
    const publishNeutralProcessing = () => {
      const latest = dependenciesRef.current;
      latest.publishDocumentAdjustments(neutralAdjustments);
      latest.publishPanelAdjustments(neutralAdjustments);
      latest.publishGlobalGradeStrength(100);
    };
    const restorePreviousProcessing = () => {
      if (!previousDocumentAdjustments || !previousPanelAdjustments) return;
      const latest = dependenciesRef.current;
      latest.publishDocumentAdjustments(previousDocumentAdjustments);
      latest.publishPanelAdjustments(previousPanelAdjustments);
      latest.publishGlobalGradeStrength(previousGlobalGradeStrength);
    };
    const applyFlattenState = (flattened: boolean) => runEditorOperationTransaction(
      { operation: flattened ? 'Redo Flatten Image' : 'Undo Flatten Image' },
      (transaction) => {
        if (resetsDocumentFinalState) {
          transaction.step(
            'publish document processing state',
            flattened ? publishNeutralProcessing : restorePreviousProcessing,
            flattened ? restorePreviousProcessing : publishNeutralProcessing
          );
        }
        transaction.step(
          'publish document snapshot',
          () => dependenciesRef.current.applyDocumentSnapshot(flattened ? next : current),
          () => dependenciesRef.current.applyDocumentSnapshot(flattened ? current : next)
        );
      }
    );
    if (!commitReservedRasterMutation({
      transaction: documentTransaction,
      operation: request.kind === 'group' ? 'Flatten Group' : 'Flatten Image',
      current,
      next,
      destination,
      render: () => request.kind === 'group'
        ? renderer.flattenGroup(current, request.groupId, destination.id)
        : renderer.flattenImage(current, destination.id),
      processing: resetsDocumentFinalState ? {
        publish: publishNeutralProcessing,
        restore: restorePreviousProcessing
      } : undefined,
      historyEntry: {
        label: description.label,
        type: description.type,
        byteSize: estimateRetainedLayerRuntimeBytes(current, retainedSources),
        layerIds: [...new Set([
          ...retainedLayerRuntimeIds(retainedSources), destination.id
        ])],
        undo: () => request.kind === 'group'
          ? applyDocumentTransition('Undo Flatten Group', next, current)
          : applyFlattenState(false),
        redo: () => request.kind === 'group'
          ? applyDocumentTransition('Redo Flatten Group', current, next)
          : applyFlattenState(true)
      },
      errorMessage: 'The layer stack could not be flattened on the GPU.'
    })) return false;
    dependencies.setActiveChannel('pixels');
    dependencies.setError(null);
    dependencies.setStatus(
      request.kind === 'group' ? 'Group flattened' : 'Image flattened'
    );
    return destination.id;
  };

  const flattenWhenReady = async (request: FlattenRequest) => {
    const current = dependenciesRef.current.getDocument();
    const plan = current && (request.kind === 'group'
      ? getFlattenGroupPlan(current, request.groupId)
      : getFlattenImagePlan(current));
    if (!plan) throw new Error('The flatten target is unavailable.');
    const readiness = await waitForTextTargets(
      request.kind === 'group'
        ? [request.groupId]
        : current.layers.map(({ id }) => id),
      request.kind === 'group',
      request.kind === 'image' ? 'document' : 'layer'
    );
    readiness.assertCurrent();
    const destinationId = flatten(request);
    if (destinationId) return destinationId;
    throw new Error('The prepared layer stack could not be flattened.');
  };

  const rasterizeLayerById = (layerId: LayerId) => {
    const dependencies = dependenciesRef.current;
    const description = { label: 'Rasterize Layer', type: 'layer.rasterize' } as const;
    const documentTransaction = beginDocumentTransaction(
      `layer.rasterize:${layerId}`,
      description
    );
    if (!documentTransaction) return false;
    const current = documentTransaction.before;
    const renderer = dependencies.getRenderer();
    const source = findDocumentLayer(current, layerId);
    if (!source || !renderer) {
      documentTransaction.cancel();
      dependencies.setError('Select a layer to rasterize.');
      return false;
    }
    const next = rasterizeDocumentLayer(current, source.id);
    const destination = findRasterLayer(next, next.activeLayerId);
    if (next === current || !destination) {
      documentTransaction.cancel();
      dependencies.setError('The layer is locked or cannot be rasterized.');
      return false;
    }
    if (!commitReservedRasterMutation({
      transaction: documentTransaction,
      operation: 'Rasterize Layer',
      current,
      next,
      destination,
      render: () => renderer.rasterizeLayer(current, source.id, destination.id),
      historyEntry: {
        label: 'Rasterize Layer',
        type: 'layer.rasterize',
        byteSize: estimateRetainedLayerRuntimeBytes(current, [source]),
        layerIds: [...new Set([
          ...retainedLayerRuntimeIds([source]), destination.id
        ])],
        undo: () => applyDocumentTransition('Undo Rasterize Layer', next, current),
        redo: () => applyDocumentTransition('Redo Rasterize Layer', current, next)
      },
      errorMessage: 'The layer could not be rasterized on the GPU.'
    })) return false;
    dependencies.setActiveChannel('pixels');
    dependencies.setError(null);
    dependencies.setStatus(`${source.name} rasterized`);
    return destination.id;
  };

  const rasterizeLayerWhenReady = async (layerId: LayerId) => {
    const readiness = await waitForTextTargets([layerId], true);
    readiness.assertCurrent();
    const destinationId = rasterizeLayerById(layerId);
    if (destinationId) return destinationId;
    throw new Error('The prepared layer could not be rasterized.');
  };

  const rasterizeTextLayerWhenReady = async (layerId: LayerId) => {
    const current = dependenciesRef.current.getDocument();
    const layer = current ? findDocumentLayer(current, layerId) : null;
    if (layer?.type !== 'text') {
      const message = 'Select a text layer to rasterize.';
      dependenciesRef.current.setError(message);
      throw new Error(message);
    }
    return rasterizeLayerWhenReady(layerId);
  };

  const invertLayerColors = (layerId: LayerId, channel: PaintChannel) => {
    const description = channel === 'mask'
      ? { label: 'Invert Layer Mask', type: 'layer.mask.invert' } as const
      : { label: 'Invert', type: 'layer.invert' } as const;
    const transaction = beginDocumentTransaction(
      `${description.type}:${layerId}`,
      description
    );
    if (!transaction) return false;
    const current = transaction.before;
    const activeLayer = current
      ? (
          channel === 'mask'
            ? findDocumentLayer(current, layerId ?? null)
            : findRasterLayer(current, layerId ?? null)
        )
      : null;
    const renderer = dependenciesRef.current.getRenderer();
    if (!activeLayer || !renderer) {
      transaction.cancel();
      return false;
    }
    if (layerIsLocked(activeLayer, 'pixels')) {
      transaction.cancel();
      dependenciesRef.current.setError(
        `Unlock the target layer before inverting its ${channel === 'mask' ? 'mask' : 'colors'}.`
      );
      return false;
    }
    if (channel === 'mask' && !activeLayer.mask) {
      transaction.cancel();
      dependenciesRef.current.setError('Add or select a layer mask before inverting it.');
      return false;
    }

    let editOpen = false;
    let pixelEdit: ReversiblePixelEdit | null = null;
    let historyPublication: AppliedPixelMutationReservation | null = null;
    try {
      const next = channel === 'mask'
        ? markLayerMaskPixelsChanged(current, layerId, fullDocumentBounds(current))
        : markLayerPixelsChanged(current, layerId, fullDocumentBounds(current));
      if (!transaction.stage(() => next)) {
        throw new Error(`${description.label} could not stage its document state.`);
      }
      if (!transaction.commitWith((before, after) => {
        historyPublication = reserveAppliedPixelMutation(() => dependenciesRef.current, {
          label: description.label, type: description.type, layerIds: [layerId]
        });
        renderer.beginLayerPixelEdit(layerId, channel);
        editOpen = true;
        if (!renderer.invertLayerColors(layerId, channel)) {
          throw new Error(
            `The active ${channel === 'mask' ? 'mask' : 'layer pixels'} are not available on the GPU.`
          );
        }
        pixelEdit = renderer.finishPixelEdit();
        editOpen = false;
        if (!pixelEdit) throw new Error('The invert operation could not create an undo snapshot.');
        const completedEdit = pixelEdit;
        pixelEdit = null;
        const mutation = {
          operation: description.label,
          label: description.label,
          type: description.type,
          layerIds: [layerId],
          before,
          after,
          edits: [completedEdit]
        };
        historyPublication.commit(mutation);
        return true;
      })) throw new Error(`${description.label} could not commit its document state.`);
      dependenciesRef.current.setError(null);
      dependenciesRef.current.setStatus(
        `Inverted ${channel === 'mask' ? 'mask' : 'colors'} on ${activeLayer.name}`
      );
      return true;
    } catch (reason) {
      if (editOpen) renderer.cancelPixelEdit();
      (historyPublication as AppliedPixelMutationReservation | null)?.cancel();
      discardUnpublishedPixelEdit(pixelEdit);
      transaction.cancel();
      dependenciesRef.current.setError(
        reason instanceof Error
          ? reason.message
          : `The active ${channel === 'mask' ? 'mask' : 'layer colors'} could not be inverted.`
      );
      return false;
    }
  };

  const pastePixelArtifact = async (
    file: File,
    placement: PixelClipboardPlacement,
    requestedFastPasteToken?: string
  ): Promise<PixelClipboardPasteResult | null> => {
    const dependencies = dependenciesRef.current;
    const description = placement.target?.channel === 'mask'
      ? { label: 'Paste Into Layer Mask', type: 'layer.mask.paste' } as const
      : { label: 'Paste', type: 'layer.paste' } as const;
    const documentTransaction = beginDocumentTransaction(description.type, description);
    if (!documentTransaction) return null;
    const before = documentTransaction.before;
    const renderer = dependencies.getRenderer();
    const rendererGeneration = dependencies.getRendererGeneration();
    if (!renderer) {
      documentTransaction.cancel();
      return null;
    }
    if (placement.target?.channel === 'mask') {
      const targetId = placement.target.layerId ?? before.activeLayerId;
      const target = targetId ? findDocumentLayer(before, targetId) : null;
      if (!targetId || !target?.mask) {
        documentTransaction.cancel();
        dependencies.setError('Select a layer mask before pasting into a mask.');
        return null;
      }
      if (layerIsLocked(target, 'pixels')) {
        documentTransaction.cancel();
        dependencies.setError(`Unlock ${target.name} before pasting into its mask.`);
        return null;
      }
      const after = markLayerMaskPixelsChanged(before, targetId, placement);
      if (!documentTransaction.stage(() => after)) {
        documentTransaction.cancel();
        return null;
      }
      let editOpen = false;
      let pixelEdit: ReversiblePixelEdit | null = null;
      let historyPublication: AppliedPixelMutationReservation | null = null;
      try {
        const committed = await documentTransaction.commitWithAsync(async (
          ownedBefore,
          ownedAfter
        ) => {
          historyPublication = reserveAppliedPixelMutation(() => dependenciesRef.current, {
            label: description.label,
            type: description.type,
            layerIds: [targetId]
          });
          renderer.beginLayerPixelEdit(targetId, 'mask');
          editOpen = true;
          // Clipboard paste replaces mask pixels through a full texture upload.
          // Capture the current mask before that upload so finishPixelEdit can
          // publish one real undo step. The document lease remains held during
          // the upload, so no other command can publish against stale pixels.
          if (renderer.captureAllPixelEdit(targetId, 'mask') < 1) {
            throw new Error('Mask paste could not capture its recoverable undo state.');
          }
          if (!await renderer.pasteClipboardImage(targetId, file, {
            x: placement.x, y: placement.y
          }, 'mask')) {
            throw new Error('The copied pixels could not be pasted into the active mask.');
          }
          const current = dependenciesRef.current;
          if (current.getRenderer() !== renderer
            || current.getRendererGeneration() !== rendererGeneration
            || current.getDocument() !== ownedBefore) {
            throw new Error('Mask paste was cancelled because its document renderer changed.');
          }
          pixelEdit = renderer.finishPixelEdit();
          editOpen = false;
          if (!pixelEdit) throw new Error('Mask paste could not create a recoverable undo step.');
          const completedEdit = pixelEdit;
          pixelEdit = null;
          historyPublication.commit({
            operation: description.label,
            label: description.label,
            type: description.type,
            layerIds: [targetId],
            before: ownedBefore,
            after: ownedAfter,
            edits: [completedEdit]
          });
          return true;
        });
        if (!committed) return null;
        dependencies.setActiveChannel('mask');
        dependencies.setSelectionClipboardAvailable(true);
        dependencies.setStatus(`Pasted clipboard pixels into the mask of ${target.name}`);
        dependencies.setError(null);
        return { layerId: targetId, width: placement.width, height: placement.height };
      } catch (reason) {
        if (editOpen) renderer.cancelPixelEdit();
        (historyPublication as AppliedPixelMutationReservation | null)?.cancel();
        discardUnpublishedPixelEdit(pixelEdit);
        documentTransaction.cancel();
        dependencies.setError(reason instanceof Error ? reason.message : 'Mask paste failed.');
        return null;
      }
    }
    const insertionTarget = before.activeLayerId ?? undefined;
    // The retained full-document clipboard is an exact Paste in Place fast
    // path. Normal Paste carries an explicit target and must use the cropped
    // artifact so its newly resolved center is honored.
    const fastPaste = placement.target === undefined
      && pixelClipboard.canUseFastPaste(requestedFastPasteToken);
    if (!fastPaste) {
      const after = createPlacedRasterLayer(before, {
        name: placement.name?.trim() || 'Pasted Selection',
        width: placement.width,
        height: placement.height,
        x: placement.x,
        y: placement.y,
        transformCommitMode: 'pixels'
      });
      const pastedLayerId = after === before ? null : after.activeLayerId;
      const pastedLayer = pastedLayerId ? findRasterLayer(after, pastedLayerId) : null;
      if (!pastedLayerId || !pastedLayer) {
        documentTransaction.cancel();
        dependencies.setError('The clipboard image dimensions could not be prepared.');
        return null;
      }
      if (!await commitLoadedRasterLayer({
        transaction: documentTransaction,
        operation: 'Paste',
        next: after,
        destination: pastedLayer,
        assets: [{ layerId: pastedLayerId, pixels: file, mask: null }],
        description: { label: 'Paste', type: 'layer.paste' },
        errorMessage: 'The copied pixels could not be pasted into a new layer.'
      })) {
        return null;
      }
      dependencies.setActiveChannel('pixels');
      dependencies.setSelectionClipboardAvailable(true);
      dependencies.setStatus('Pasted system clipboard image into a new layer');
      dependencies.setError(null);
      return { layerId: pastedLayerId, width: placement.width, height: placement.height };
    }

    let after = createRasterLayer(before, placement.name?.trim() || 'Pasted Selection', insertionTarget);
    const pastedLayerId = after.activeLayerId;
    if (!pastedLayerId) {
      documentTransaction.cancel();
      return null;
    }
    const pastedLayer = findRasterLayer(after, pastedLayerId);
    if (pastedLayer) pastedLayer.transformCommitMode = 'pixels';
    const dirtyBounds = {
      x: placement.x, y: placement.y, width: placement.width, height: placement.height
    };
    after = markLayerPixelsChanged(after, pastedLayerId, dirtyBounds);
    const destination = findRasterLayer(after, pastedLayerId);
    if (!destination || !commitReservedRasterMutation({
      transaction: documentTransaction,
      operation: 'Paste',
      current: before,
      next: after,
      destination,
      render: () => renderer.pasteSelectionClipboard(pastedLayerId),
      historyEntry: {
        label: 'Paste',
        type: 'layer.paste',
        layerIds: [pastedLayerId],
        undo: () => applyDocumentTransition('Undo Paste', after, before),
        redo: () => applyDocumentTransition('Redo Paste', before, after)
      },
      errorMessage: 'The copied pixels could not be pasted into a new layer.'
    })) {
      documentTransaction.cancel();
      return null;
    }
    dependencies.setActiveChannel('pixels');
    dependencies.setSelectionClipboardAvailable(true);
    dependencies.setStatus('Pasted selection into a new layer');
    dependencies.setError(null);
    return { layerId: pastedLayerId, width: placement.width, height: placement.height };
  };

  const placeImageArtifact: LayerDocumentCommands['placeImageArtifact'] = async (file, placement = {}) => {
    const dependencies = dependenciesRef.current;
    if (!dependencies.getDocument() || !dependencies.getRenderer()) return null;
    let documentTransaction: DocumentMutationTransaction | null = null;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      const width = bitmap.width;
      const height = bitmap.height;
      if (width < 1 || height < 1 || width > 32_768 || height > 32_768
        || width * height > 268_435_456) {
        throw new Error('Placed image dimensions exceed the supported resource bounds.');
      }
      const description = { label: 'Place Embedded', type: 'layer.place' } as const;
      documentTransaction = beginDocumentTransaction(description.type, description);
      if (!documentTransaction) return null;
      const before = documentTransaction.before;
      const x = Number.isFinite(placement.x)
        ? Math.round(placement.x!)
        : Math.round((before.width - width) / 2);
      const y = Number.isFinite(placement.y)
        ? Math.round(placement.y!)
        : Math.round((before.height - height) / 2);
      const name = placement.name?.trim() || file.name.replace(/\.[^.]+$/, '') || 'Placed image';
      const after = createPlacedRasterLayer(before, { name, width, height, x, y });
      const layerId = after.activeLayerId;
      if (!layerId) {
        documentTransaction.cancel();
        return null;
      }
      const layer = findRasterLayer(after, layerId);
      if (!layer || !await commitLoadedRasterLayer({
        transaction: documentTransaction,
        operation: 'Place Embedded',
        next: after,
        destination: layer,
        assets: [{ layerId, pixels: file, mask: null }],
        description,
        errorMessage: 'The image could not be placed.'
      })) {
        documentTransaction.cancel();
        return null;
      }
      dependencies.setActiveChannel('pixels');
      dependencies.setStatus(`Placed ${name}`);
      dependencies.setError(null);
      return { layerId, width, height };
    } catch (reason) {
      documentTransaction?.cancel();
      dependencies.setError(reason instanceof Error ? reason.message : 'The image could not be placed.');
      return null;
    } finally {
      bitmap?.close();
    }
  };

  const layerViaCopy = (sourceId: LayerId) => {
    if (!sourceId) return null;
    const current = dependenciesRef.current.getDocument();
    if (!current) return null;
    const committedSelection = pixelClipboard.readCommittedSelection(current);
    if (!committedSelection) return null;
    if (!committedSelection.active) {
      const duplicatedId = duplicateLayer(sourceId);
      if (duplicatedId) dependenciesRef.current.setStatus('Layer copied');
      return duplicatedId ? { layerId: duplicatedId, scope: 'layer' as const } : null;
    }
    const dirtyBounds = committedSelection.bounds;
    if (!dirtyBounds) {
      dependenciesRef.current.setError('The committed selection has no pixel support.');
      return null;
    }

    const description = { label: 'Layer Via Copy', type: 'layer.via-copy' } as const;
    const documentTransaction = beginDocumentTransaction(description.type, description);
    if (!documentTransaction) return null;
    const before = documentTransaction.before;
    const renderer = dependenciesRef.current.getRenderer();
    const sourceLayer = findRasterLayer(before, sourceId);
    if (!renderer || !sourceLayer) {
      documentTransaction.cancel();
      dependenciesRef.current.setError(
        'The selected pixels could not be copied from the source layer.'
      );
      return null;
    }

    let after = createRasterLayer(before, `${sourceLayer.name} copy`, sourceId);
    const copiedLayerId = after.activeLayerId;
    if (!copiedLayerId) {
      documentTransaction.cancel();
      return null;
    }
    after = markLayerPixelsChanged(after, copiedLayerId, dirtyBounds);
    const destination = findRasterLayer(after, copiedLayerId);
    if (!destination || !commitReservedRasterMutation({
      transaction: documentTransaction,
      operation: 'Layer Via Copy',
      current: before,
      next: after,
      destination,
      render: () => {
        pixelClipboard.invalidateRendererScratch();
        return renderer.copySelectedLayerContent(before, sourceId)
          && renderer.pasteSelectionClipboard(copiedLayerId);
      },
      historyEntry: {
        label: 'Layer Via Copy',
        type: 'layer.via-copy',
        layerIds: [sourceId, copiedLayerId],
        undo: () => applyDocumentTransition('Undo Layer Via Copy', after, before),
        redo: () => applyDocumentTransition('Redo Layer Via Copy', before, after)
      },
      errorMessage: 'The selected pixels could not be placed on a new layer.'
    })) {
      documentTransaction.cancel();
      return null;
    }
    dependenciesRef.current.setActiveChannel('pixels');
    dependenciesRef.current.setStatus('Selection copied to a new layer');
    dependenciesRef.current.setError(null);
    return { layerId: copiedLayerId, scope: 'selection' as const };
  };

  return {
    addActiveLayerMask: addMaskCommands.addActive,
    addLayerMask: addMaskCommands.add,
    removeLayerMask: removeMaskFromLayer,
    applyLayerMask: applyMaskToLayer,
    applyBackgroundRemovalMask,
    duplicateActiveLayer,
    duplicateLayer,
    createAdjustmentLayer: createGradeAdjustmentLayer,
    createCurvesAdjustmentLayer,
    createLensFxLayer,
    createAdjustmentLayerOfKind: createProcessingLayer,
    createAttachedAdjustment,
    rasterizeVectorCreation,
    mergeLayersWhenReady,
    flattenWhenReady,
    rasterizeTextLayerWhenReady,
    rasterizeLayerWhenReady,
    invertLayerColors,
    copySelectedContent: pixelClipboard.copySelected,
    copyMergedContent: pixelClipboard.copyMerged,
    pastePixelArtifact,
    placeImageArtifact,
    layerViaCopy
  };
};

export const useLayerDocumentCommands = (
  dependencies: LayerDocumentCommandDependencies
): LayerDocumentCommands => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  return useMemo(
    () => createLayerDocumentCommands(() => dependenciesRef.current),
    []
  );
};
