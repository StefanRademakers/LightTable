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
  addLayerMask,
  addRasterLayerAttachedAdjustment,
  createAdjustmentLayer,
  duplicateLayer as duplicateDocumentLayer,
  createRasterLayer,
  flattenGroup,
  flattenImage,
  getFlattenGroupPlan,
  getFlattenImagePlan,
  getMergeLayersPlan,
  markLayerMaskPixelsChanged,
  markLayerPixelsChanged,
  mergeLayers as mergeDocumentLayers,
  moveLayerRelative,
  rasterizeLayer as rasterizeDocumentLayer,
  rasterizeTextLayer
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
  selectionOperationsBounds,
  selectionOperationsSupportBounds
} from '../../editor/tools/transform/selectionTransform';
import { centerClipboardBounds } from '../clipboard/pastePlacement';
import {
  adjustmentStackForScope,
  createAdjustmentStackFromBasicAdjustments
} from '../../processing/adjustmentStack';
import {
  cloneAdjustments,
  createDefaultAdjustments,
  type BasicAdjustments
} from '../../types';
import type { LightTableImageClipboard } from '../../../platform/LightTableImageClipboard';
import {
  adjustmentLayerDefinition,
  selectAdjustmentLayerModules,
  type AdjustmentInitialSettings,
  type AdjustmentLayerKind
} from '../../processing/adjustmentLayerCatalog';
import { isFilterKind, createFilterStack } from '../../processing/filter';
import { runEditorOperationTransaction } from '../commands/editorOperationTransaction';
import { commitAppliedPixelMutation } from '../commands/pixelMutationTransaction';
import type {
  DocumentMutationController,
  DocumentMutationDescription,
  DocumentMutationTransaction
} from '../documents/useDocumentMutationController';
import type { VectorElementCreationTransaction } from '../vectors/VectorDocumentController';

export type FlattenRequest =
  | { kind: 'group'; groupId: LayerId }
  | { kind: 'image' };

export interface LayerCommandHistoryEntry {
  label?: string;
  type?: string;
  byteSize?: number;
  layerIds?: readonly LayerId[];
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
  dispose?(): void;
}

export interface LayerCommandRendererPort {
  duplicateLayerPixels(sourceId: LayerId, destinationId: LayerId): boolean;
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
  rasterizeText(
    document: ImageDocument,
    source: import('../../editor/document/documentTypes').TextLayer,
    destination: import('../../editor/document/documentTypes').RasterLayer
  ): boolean;
  rasterizeLayer(
    document: ImageDocument,
    sourceId: LayerId,
    destinationId: LayerId
  ): boolean;
  waitForTextSource?(layerId: LayerId): Promise<boolean>;
  invertLayerColors(layerId: LayerId, channel?: PaintChannel): boolean;
  bakeSelectionIntoLayerMask(layerId: LayerId): boolean;
  applyGeneratedLayerMask(
    layerId: LayerId,
    mask: RasterSelectionMask,
    mode: 'replace' | 'intersect'
  ): boolean;
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
  getImageClipboard(): LightTableImageClipboard;
  getDocumentId(): string;
  getActiveChannel?(): PaintChannel;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushDocumentHistory(before: ImageDocument, after: ImageDocument,
    description?: { readonly label: string; readonly type: string }): void;
  pushHistoryEntry(entry: LayerCommandHistoryEntry): void;
  setActiveChannel(channel: PaintChannel): void;
  setSelectionClipboardAvailable(available: boolean): void;
  setStatus(message: string | null): void;
  setError(message: string | null): void;
  getDocumentAdjustments?(): BasicAdjustments;
  getPanelAdjustments?(): BasicAdjustments;
  publishDocumentAdjustments?(adjustments: BasicAdjustments): void;
  publishPanelAdjustments?(adjustments: BasicAdjustments): void;
  getGlobalGradeStrength?(): number;
  publishGlobalGradeStrength?(strength: number): void;
}

export interface LayerDocumentCommands {
  addActiveLayerMask(useSelection: boolean): boolean;
  addLayerMask(layerId: LayerId, useSelection: boolean, present?: boolean): boolean;
  applyBackgroundRemovalMask(
    layerId: LayerId,
    mask: RasterSelectionMask,
    mode: 'replace' | 'intersect' | 'new-layer'
  ): boolean;
  duplicateActiveLayer(): boolean;
  duplicateLayer(layerId: LayerId): LayerId | null;
  createAdjustmentLayer(): boolean;
  createCurvesAdjustmentLayer(): boolean;
  createLensFxLayer(): boolean;
  createAdjustmentLayerOfKind(kind: AdjustmentLayerKind, aboveLayerId?: LayerId,
    settings?: AdjustmentInitialSettings): boolean;
  createAttachedAdjustment(layerId: LayerId, kind: AdjustmentLayerKind,
    settings?: AdjustmentInitialSettings): string | null;
  mergeSelectedLayers(selectedLayerIds: LayerId[]): boolean;
  rasterizeVectorCreation(transaction: VectorElementCreationTransaction): boolean;
  mergeLayersWhenReady(selectedLayerIds: LayerId[]): Promise<boolean>;
  mergeActiveLayerDown(): boolean;
  flatten(request: FlattenRequest): boolean;
  flattenWhenReady(request: FlattenRequest): Promise<boolean>;
  rasterizeTextLayer(layerId: LayerId): boolean;
  rasterizeTextLayerWhenReady(layerId: LayerId): Promise<boolean>;
  rasterizeActiveTextLayer(): boolean;
  rasterizeLayer(layerId: LayerId): boolean;
  rasterizeLayerWhenReady(layerId: LayerId): Promise<boolean>;
  rasterizeActiveLayer(): Promise<boolean>;
  invertLayerColors(layerId: LayerId, channel: PaintChannel): boolean;
  copySelectedContent(selection: readonly SelectionOperation[]): Promise<PixelClipboardCapture | null>;
  copyMergedContent(selection: readonly SelectionOperation[]): Promise<PixelClipboardCapture | null>;
  pasteSelectedContent(selection: readonly SelectionOperation[]): Promise<boolean>;
  pastePixelArtifact(file: File, placement: PixelClipboardPlacement,
    fastPasteToken?: string): Promise<PixelClipboardPasteResult | null>;
  placeImageArtifact(file: File, placement?: {
    readonly name?: string;
    readonly x?: number;
    readonly y?: number;
  }): Promise<{ readonly layerId: LayerId; readonly width: number; readonly height: number } | null>;
  layerViaCopy(layerId: LayerId, selection: readonly SelectionOperation[]): LayerId | null;
}

export interface PixelClipboardCapture {
  readonly file: File;
  readonly bounds: Rect;
  readonly fastPasteToken?: string;
}

export interface PixelClipboardPlacement extends Rect {
  readonly name?: string;
  readonly target?: { readonly channel: PaintChannel; readonly layerId?: LayerId };
}
export interface PixelClipboardPasteResult {
  readonly layerId: LayerId;
  readonly width: number;
  readonly height: number;
}

const fullDocumentBounds = (document: ImageDocument) => ({
  x: 0,
  y: 0,
  width: document.width,
  height: document.height
});

const contributingTextLayerIds = (
  nodes: readonly LayerNode[],
  inheritedVisible = true
): LayerId[] => nodes.flatMap((node) => {
  const visible = inheritedVisible && node.visible && node.opacity > 0;
  if (node.type === 'group') return contributingTextLayerIds(node.children, visible);
  return node.type === 'text' && visible ? [node.id] : [];
});

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
  let fastClipboardToken: string | null = null;
  let clipboardGeneration = 0;
  const dependenciesRef = {
    get current() {
      return resolveDependencies();
    }
  };

  const waitForTextTargets = async (layerIds: readonly LayerId[]) => {
    const dependencies = dependenciesRef.current;
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!document || !renderer?.waitForTextSource) return true;
    const targets = layerIds.map((layerId) => findDocumentLayer(document, layerId))
      .filter((layer): layer is LayerNode => Boolean(layer));
    const textLayerIds = [...new Set(contributingTextLayerIds(targets))];
    for (const textLayerId of textLayerIds) {
      if (!await renderer.waitForTextSource(textLayerId)) {
        throw new Error('A contributing text source could not be prepared for compositing.');
      }
    }
    return true;
  };

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

  const publishReservedRasterMutation = ({
    operation,
    current,
    next,
    destination,
    render,
    historyEntry,
    processing,
    rollbackDocument = current,
    errorMessage
  }: {
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
    /**
     * Snapshot restored when publication fails. This differs from `current`
     * for tool previews: the preview is the render source, but the durable
     * operation started from the document that existed before the gesture.
     */
    readonly rollbackDocument?: ImageDocument;
    readonly errorMessage: string;
  }): boolean => {
    const dependencies = dependenciesRef.current;
    const renderer = dependencies.getRenderer();
    if (!renderer) return false;
    try {
      runEditorOperationTransaction({ operation }, (transaction) => {
        transaction.adopt(
          'release reserved raster destination',
          () => { renderer.releaseRasterDestination(destination.id); }
        );
        if (!renderer.prepareRasterDestination(destination)) {
          throw new Error('The raster destination could not be allocated on the GPU.');
        }
        if (!render()) throw new Error(errorMessage);
        if (processing) {
          transaction.step(
            'publish document processing state',
            processing.publish,
            processing.restore
          );
        }
        transaction.step(
          'publish document snapshot',
          () => dependencies.applyDocumentSnapshot(next),
          () => dependencies.applyDocumentSnapshot(rollbackDocument)
        );
        dependencies.pushHistoryEntry(historyEntry);

        // Recording is the ownership hand-off: from here the document and its
        // history retain both source and destination runtimes. The concrete
        // renderer implementation only clears a reservation and cannot fail.
        renderer.commitRasterDestination(destination.id);
      });
      return true;
    } catch (reason) {
      dependencies.setError(
        reason instanceof Error ? reason.message : errorMessage
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
    if (!transaction.stage(() => mutation.next)) {
      transaction.cancel();
      return false;
    }
    try {
      return transaction.commitWith((ownedBefore, ownedAfter) => (
        publishReservedRasterMutation({
          ...mutation,
          current: ownedBefore,
          next: ownedAfter,
          rollbackDocument: mutation.rollbackDocument ?? ownedBefore
        })
      ));
    } catch (reason) {
      dependenciesRef.current.setError(
        reason instanceof Error ? reason.message : mutation.errorMessage
      );
      return false;
    }
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
        runEditorOperationTransaction({ operation }, (publication) => {
          publication.adopt('release reserved raster destination', releaseReservation);
          publication.step(
            'publish document snapshot',
            () => dependencies.applyDocumentSnapshot(ownedAfter),
            () => dependencies.applyDocumentSnapshot(ownedBefore)
          );
          dependencies.pushDocumentHistory(ownedBefore, ownedAfter, description);
          renderer.commitRasterDestination(destination.id);
          ownsReservation = false;
        });
        return true;
      } catch (reason) {
        releaseReservation();
        dependencies.setError(reason instanceof Error ? reason.message : errorMessage);
        return false;
      }
    });
  };

  const addMaskToLayer = (layerId: LayerId, useSelection: boolean, present = false) => {
    const dependencies = dependenciesRef.current;
    const description = { label: 'Add Layer Mask', type: 'layer.mask.add' } as const;
    const transaction = beginDocumentTransaction(`layer.mask.add:${layerId}`, description);
    if (!transaction) return false;
    const current = transaction.before;
    const layer = findDocumentLayer(current, layerId);
    if (!layerId || !layer || layer.mask) {
      transaction.cancel();
      return false;
    }

    const withMask = addLayerMask(current, layerId);
    if (withMask === current) {
      transaction.cancel();
      return false;
    }

    if (!useSelection) {
      try {
        if (!commitDocumentTransition(transaction, withMask, description)) return false;
      } catch (reason) {
        transaction.cancel();
        if (present) dependencies.setError(
          reason instanceof Error ? reason.message : 'The layer mask could not be added.'
        );
        return false;
      }
      if (present) {
        dependencies.setActiveChannel('mask');
        dependencies.setError(null);
        dependencies.setStatus(`Added layer mask to ${layer.name}`);
      }
      return true;
    }

    const renderer = dependencies.getRenderer();
    if (!renderer) {
      transaction.cancel();
      if (present) dependencies.setError('The current selection could not be baked into a layer mask.');
      return false;
    }

    let editOpen = false;
    let pixelEdit: ReversiblePixelEdit | null = null;
    try {
      // Publishing the mask node allocates its document-owned GPU target. It
      // remains an internal transaction state until history accepts the edit.
      if (!transaction.change(() => withMask)) {
        throw new Error('The layer mask preview could not be prepared.');
      }
      renderer.beginLayerPixelEdit(layerId, 'mask');
      editOpen = true;
      if (!renderer.bakeSelectionIntoLayerMask(layerId)) {
        throw new Error('The current selection could not be copied into the layer mask.');
      }
      pixelEdit = renderer.finishPixelEdit();
      editOpen = false;
      if (!pixelEdit) {
        throw new Error('The layer mask could not create a recoverable undo step.');
      }
      const next = markLayerMaskPixelsChanged(
        withMask,
        layerId,
        fullDocumentBounds(current)
      );
      if (!transaction.stage(() => next)) {
        throw new Error('The layer mask transaction could not be staged.');
      }
      const completedEdit = pixelEdit;
      if (!transaction.commitWith((before, after) => {
        // From this point the atomic pixel publisher owns rollback/disposal.
        pixelEdit = null;
        commitAppliedPixelMutation(() => dependenciesRef.current, {
          operation: 'Add Layer Mask',
          label: 'Add Layer Mask', type: 'layer.mask.add',
          layerIds: [layerId],
          before,
          redoBase: withMask,
          after,
          edits: [completedEdit]
        });
        return true;
      })) throw new Error('The layer mask transaction could not be committed.');
      if (present) {
        dependencies.setActiveChannel('mask');
        dependencies.setError(null);
        dependencies.setStatus(`Added selection as a mask to ${layer.name}`);
      }
      return true;
    } catch (reason) {
      if (editOpen) renderer.cancelPixelEdit();
      discardUnpublishedPixelEdit(pixelEdit);
      transaction.cancel();
      if (present) {
        dependencies.setError(
          reason instanceof Error
            ? reason.message
            : 'The current selection could not be baked into a layer mask.'
        );
      }
      return false;
    }
  };

  const addActiveLayerMask = (useSelection: boolean) => {
    const layerId = dependenciesRef.current.getDocument()?.activeLayerId;
    return layerId ? addMaskToLayer(layerId, useSelection, true) : false;
  };

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

  const applyBackgroundRemovalMask = (
    layerId: LayerId,
    mask: RasterSelectionMask,
    mode: 'replace' | 'intersect' | 'new-layer'
  ) => {
    const dependencies = dependenciesRef.current;
    const description = {
      label: 'Remove Background', type: 'layer.background-removal'
    } as const;
    const transaction = beginDocumentTransaction(
      `layer.background-removal:${layerId}`,
      description
    );
    if (!transaction) return false;
    const before = transaction.before;
    const renderer = dependencies.getRenderer();
    const sourceId = layerId;
    const source = before && sourceId ? findRasterLayer(before, sourceId) : null;
    if (!renderer || !sourceId || !source) {
      transaction.cancel();
      return false;
    }
    if (layerIsLocked(source, 'pixels')) {
      transaction.cancel();
      dependencies.setError('Unlock the active raster layer before removing its background.');
      return false;
    }
    if (mask.width !== before.width || mask.height !== before.height) {
      transaction.cancel();
      dependencies.setError('The generated background mask does not match this document.');
      return false;
    }

    let prepared = before;
    let targetId = sourceId;
    if (mode === 'new-layer') {
      prepared = duplicateDocumentLayer(before, sourceId);
      targetId = prepared.activeLayerId ?? sourceId;
      if (prepared === before || targetId === sourceId) {
        transaction.cancel();
        return false;
      }
    }
    const target = findDocumentLayer(prepared, targetId);
    if (!target?.mask) prepared = addLayerMask(prepared, targetId);
    if (!findDocumentLayer(prepared, targetId)?.mask) {
      transaction.cancel();
      return false;
    }

    let reservedDestination: RasterLayer | null = null;
    let editOpen = false;
    let pixelEdit: ReversiblePixelEdit | null = null;
    try {
      if (mode === 'new-layer') {
        reservedDestination = findRasterLayer(prepared, targetId);
        if (!reservedDestination || !renderer.prepareRasterDestination(reservedDestination)) {
          throw new Error('The background-removal layer could not be allocated on the GPU.');
        }
      }
      if (prepared !== before && !transaction.change(() => prepared)) {
        throw new Error('The background-removal preview could not be prepared.');
      }
      if (mode === 'new-layer' && !renderer.duplicateLayerPixels(sourceId, targetId)) {
        throw new Error('The source layer pixels could not be duplicated.');
      }
      renderer.beginLayerPixelEdit(targetId, 'mask');
      editOpen = true;
      if (!renderer.applyGeneratedLayerMask(
        targetId,
        mask,
        mode === 'intersect' && source.mask ? 'intersect' : 'replace'
      )) {
        throw new Error('The generated background mask could not be uploaded to the GPU.');
      }
      pixelEdit = renderer.finishPixelEdit();
      editOpen = false;
      if (!pixelEdit) throw new Error('Background removal could not create a recoverable undo step.');
      const after = markLayerMaskPixelsChanged(prepared, targetId, fullDocumentBounds(before));
      if (!transaction.stage(() => after)) {
        throw new Error('The background-removal transaction could not be staged.');
      }
      const completedEdit = pixelEdit;
      if (!transaction.commitWith((ownedBefore, ownedAfter) => {
        // From this point the atomic pixel publisher owns rollback/disposal.
        pixelEdit = null;
        commitAppliedPixelMutation(() => dependenciesRef.current, {
          operation: 'Remove Background',
          label: 'Remove Background', type: 'layer.background-removal',
          layerIds: [sourceId, targetId],
          before: ownedBefore,
          redoBase: prepared,
          after: ownedAfter,
          edits: [completedEdit]
        });
        if (reservedDestination) renderer.commitRasterDestination(reservedDestination.id);
        return true;
      })) throw new Error('The background-removal transaction could not be committed.');
      dependencies.setActiveChannel('mask');
      dependencies.setError(null);
      dependencies.setStatus(
        mode === 'new-layer'
          ? `Created ${source.name} with a removable background mask`
          : `Removed the background from ${source.name}`
      );
      return true;
    } catch (reason) {
      if (editOpen) renderer.cancelPixelEdit();
      discardUnpublishedPixelEdit(pixelEdit);
      transaction.cancel();
      if (reservedDestination) renderer.releaseRasterDestination(reservedDestination.id);
      dependencies.setError(
        reason instanceof Error ? reason.message : 'The generated background mask could not be applied.'
      );
      return false;
    }
  };

  const applyInitialSettings = (source: BasicAdjustments, settings?: AdjustmentInitialSettings) => {
    if (!settings) return;
    if ('radius' in settings) {
      return;
    } else if ('posterizeLevels' in settings) {
      source.photoshopAdjustment.posterizeLevels = settings.posterizeLevels;
    } else if ('thresholdLevel' in settings) {
      source.photoshopAdjustment.thresholdLevel = settings.thresholdLevel;
    } else if ('colorStops' in settings && source.gradientMap) {
      source.gradientMap = {
        ...source.gradientMap,
        enabled: true,
        colorStops: settings.colorStops.map((stop) => ({
          ...stop, color: { ...stop.color }
        })),
        opacityStops: settings.opacityStops.map((stop) => ({ ...stop })),
        ...(settings.reverse === undefined ? {} : { reverse: settings.reverse }),
        ...(settings.dither === undefined ? {} : { dither: settings.dither }),
        ...(settings.interpolation === undefined ? {} : {
          interpolation: settings.interpolation
        })
      };
    }
  };

  const createProcessingLayer = (kind: AdjustmentLayerKind, aboveLayerId?: LayerId,
    settings?: AdjustmentInitialSettings) => {
    const dependencies = dependenciesRef.current;
    const definition = adjustmentLayerDefinition(kind);
    const description = {
      label: `New ${definition.name} Layer`, type: 'layer.adjustment.create'
    } as const;
    const documentTransaction = beginDocumentTransaction(
      `layer.adjustment.create:${kind}`,
      description
    );
    if (!documentTransaction) return false;
    const current = documentTransaction.before;
    if (isFilterKind(kind)) {
      const stack = createFilterStack(kind, settings ?? {});
      const next = createAdjustmentLayer(
        current,
        stack,
        definition.name,
        aboveLayerId ?? current.activeLayerId ?? undefined,
        kind
      );
      try {
        if (!commitDocumentTransition(documentTransaction, next, description)) return false;
      } catch (reason) {
        documentTransaction.cancel();
        dependencies.setError(
          reason instanceof Error ? reason.message : `The ${definition.name} layer could not be created.`
        );
        return false;
      }
      dependencies.setActiveChannel('pixels');
      dependencies.setError(null);
      return true;
    }
    const previousDocumentGrade = dependencies.getDocumentAdjustments?.();
    const currentPanelGrade = dependencies.getPanelAdjustments?.();
    if (
      !previousDocumentGrade
      || !currentPanelGrade
      || !dependencies.publishDocumentAdjustments
      || !dependencies.publishPanelAdjustments
    ) {
      documentTransaction.cancel();
      return false;
    }

    // A processing layer starts neutral and owns an explicit module inventory.
    const source = createDefaultAdjustments();
    if (definition.photoshopKind) {
      source.photoshopAdjustment.kind = definition.photoshopKind;
    }
    if (kind === 'curves') source.curves.interpolation = 'photoshop-natural';
    if (kind === 'gradient-map' && source.gradientMap) {
      source.gradientMap.enabled = true;
      source.gradientMap.interpolation = 'classic';
      source.gradientMap.photoshopCompatible = true;
    }
    if (kind === 'grain') source.effects.grain.enabled = true;
    applyInitialSettings(source, settings);
    const stack = selectAdjustmentLayerModules(adjustmentStackForScope(
      createAdjustmentStackFromBasicAdjustments(source),
      'adjustment-layer'
    ), kind);
    const beforeDocumentGrade = cloneAdjustments(previousDocumentGrade);
    const beforePanelGrade = cloneAdjustments(currentPanelGrade);
    const clearedDocumentGrade = createDefaultAdjustments();
    const adjustmentPanelGrade = cloneAdjustments(source);
    const next = createAdjustmentLayer(
      current,
      stack,
      definition.name,
      aboveLayerId ?? current.activeLayerId ?? undefined,
      kind
    );

    const applyProcessingState = (
      operation: string,
      documentGrade: BasicAdjustments,
      document: ImageDocument,
      panelGrade: BasicAdjustments,
      rollbackDocumentGrade: BasicAdjustments,
      rollbackDocument: ImageDocument,
      rollbackPanelGrade: BasicAdjustments
    ) => runEditorOperationTransaction({ operation }, (transaction) => {
      const latest = dependenciesRef.current;
      transaction.step(
        'publish document processing state',
        () => latest.publishDocumentAdjustments?.(documentGrade),
        () => latest.publishDocumentAdjustments?.(rollbackDocumentGrade)
      );
      transaction.step(
        'publish document snapshot',
        () => latest.applyDocumentSnapshot(document),
        () => latest.applyDocumentSnapshot(rollbackDocument)
      );
      transaction.step(
        'publish panel processing state',
        () => latest.publishPanelAdjustments?.(panelGrade),
        () => latest.publishPanelAdjustments?.(rollbackPanelGrade)
      );
    });
    try {
      if (!documentTransaction.stage(() => next)
        || !documentTransaction.commitWith((ownedBefore, ownedAfter) => {
          runEditorOperationTransaction({ operation: description.label }, (publication) => {
            publication.step(
              'publish document processing state',
              () => dependencies.publishDocumentAdjustments!(clearedDocumentGrade),
              () => dependencies.publishDocumentAdjustments!(beforeDocumentGrade)
            );
            publication.step(
              'publish document snapshot',
              () => dependencies.applyDocumentSnapshot(ownedAfter),
              () => dependencies.applyDocumentSnapshot(ownedBefore)
            );
            publication.step(
              'publish panel processing state',
              () => dependencies.publishPanelAdjustments!(adjustmentPanelGrade),
              () => dependencies.publishPanelAdjustments!(beforePanelGrade)
            );
            dependencies.pushHistoryEntry({
              label: description.label,
              type: description.type,
              layerIds: ownedAfter.activeLayerId ? [ownedAfter.activeLayerId] : [],
              undo: () => applyProcessingState(
                `Undo ${description.label}`,
                beforeDocumentGrade, ownedBefore, beforePanelGrade,
                clearedDocumentGrade, ownedAfter, adjustmentPanelGrade
              ),
              redo: () => applyProcessingState(
                `Redo ${description.label}`,
                clearedDocumentGrade, ownedAfter, adjustmentPanelGrade,
                beforeDocumentGrade, ownedBefore, beforePanelGrade
              )
            });
          });
          return true;
        })) return false;
    } catch (reason) {
      documentTransaction.cancel();
      dependencies.setError(
        reason instanceof Error ? reason.message : `The ${definition.name} layer could not be created.`
      );
      return false;
    }
    dependencies.setActiveChannel('pixels');
    dependencies.setError(null);
    return true;
  };

  const createGradeAdjustmentLayer = () => createProcessingLayer('grade');
  const createCurvesAdjustmentLayer = () => createProcessingLayer('curves');
  const createLensFxLayer = () => createProcessingLayer('lens-fx');

  const createAttachedAdjustment = (layerId: LayerId, kind: AdjustmentLayerKind,
    settings?: AdjustmentInitialSettings) => {
    const dependencies = dependenciesRef.current;
    const definition = adjustmentLayerDefinition(kind);
    const description = { label: `Add ${definition.name}`, type: 'layer.adjustment.attach' } as const;
    const documentTransaction = beginDocumentTransaction(
      `layer.adjustment.attach:${layerId}:${kind}`,
      description
    );
    if (!documentTransaction) return null;
    const current = documentTransaction.before;
    const layer = findRasterLayer(current, layerId);
    if (!layer || layerIsLocked(layer, 'pixels')) {
      documentTransaction.cancel();
      return null;
    }
    const source = createDefaultAdjustments();
    if (definition.photoshopKind) source.photoshopAdjustment.kind = definition.photoshopKind;
    if (kind === 'curves') source.curves.interpolation = 'photoshop-natural';
    if (kind === 'gradient-map' && source.gradientMap) {
      source.gradientMap.enabled = true;
      source.gradientMap.interpolation = 'classic';
      source.gradientMap.photoshopCompatible = true;
    }
    if (kind === 'grain') source.effects.grain.enabled = true;
    applyInitialSettings(source, settings);
    const adjustmentStack = isFilterKind(kind)
      ? createFilterStack(kind, settings ?? {})
      : selectAdjustmentLayerModules(adjustmentStackForScope(
          createAdjustmentStackFromBasicAdjustments(source),
          'layer'
        ), kind);
    const adjustmentId = `attached-${crypto.randomUUID()}`;
    const next = addRasterLayerAttachedAdjustment(current, layerId, {
      id: adjustmentId,
      adjustmentKind: kind,
      name: definition.name,
      enabled: true,
      revision: 0,
      adjustmentStack
    });
    if (next === current) {
      documentTransaction.cancel();
      return null;
    }
    const previousPanelAdjustments = dependencies.getPanelAdjustments?.();
    try {
      if (!documentTransaction.stage(() => next)
        || !documentTransaction.commitWith((ownedBefore, ownedAfter) => {
          runEditorOperationTransaction({ operation: description.label }, (publication) => {
            publication.step(
              'publish document snapshot',
              () => dependencies.applyDocumentSnapshot(ownedAfter),
              () => dependencies.applyDocumentSnapshot(ownedBefore)
            );
            if (dependencies.publishPanelAdjustments) {
              publication.step(
                'publish panel processing state',
                () => dependencies.publishPanelAdjustments!(source),
                () => {
                  if (previousPanelAdjustments) {
                    dependencies.publishPanelAdjustments!(previousPanelAdjustments);
                  }
                }
              );
            }
            dependencies.pushDocumentHistory(ownedBefore, ownedAfter, description);
          });
          return true;
        })) return null;
    } catch (reason) {
      documentTransaction.cancel();
      dependencies.setError(
        reason instanceof Error ? reason.message : `The ${definition.name} adjustment could not be attached.`
      );
      return null;
    }
    dependencies.setActiveChannel('pixels');
    dependencies.setStatus(`Attached ${definition.name} to ${layer.name}`);
    dependencies.setError(null);
    return adjustmentId;
  };

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
    const plan = getMergeLayersPlan(current, selectedLayerIds);
    if (!plan) {
      transaction.cancel();
      dependenciesRef.current.setError(
        'Merge Selected requires at least two contiguous layers in the same group.'
      );
      return false;
    }

    const next = mergeDocumentLayers(current, plan.layerIds);
    const destination = findRasterLayer(next, next.activeLayerId);
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
        byteSize: current.width * current.height * 8,
        layerIds: [...plan.layerIds, destination.id],
        undo: () => applyDocumentTransition('Undo Merge Layers', next, current),
        redo: () => applyDocumentTransition('Redo Merge Layers', current, next)
      },
      errorMessage: 'The selected layers could not be merged on the GPU.'
    })) return false;
    dependenciesRef.current.setActiveChannel('pixels');
    dependenciesRef.current.setError(null);
    dependenciesRef.current.setStatus('Layers merged');
    return true;
  };

  const mergeSelectedLayers = (selectedLayerIds: LayerId[]) => {
    const description = { label: 'Merge Layers', type: 'layer.merge' } as const;
    const transaction = beginDocumentTransaction('layer.merge', description);
    return transaction
      ? mergeSelectedLayersInTransaction(transaction, selectedLayerIds)
      : false;
  };

  const rasterizeVectorCreation = (transaction: VectorElementCreationTransaction) => {
    const dependencies = dependenciesRef.current;
    const renderer = dependencies.getRenderer();
    const liveDocument = dependencies.getDocument();
    if (!renderer
      || !liveDocument
      || liveDocument.id !== transaction.beforeDocument.id
      || liveDocument.revision !== transaction.beforeDocument.revision) {
      dependencies.setError('The shape preview is no longer the active document state.');
      return false;
    }
    const siblings = siblingLayers(transaction.previewDocument, transaction.layerId);
    const shapeIndex = siblings.findIndex(({ id }) => id === transaction.layerId);
    const destinationSource = shapeIndex > 0 ? siblings[shapeIndex - 1] : null;
    if (destinationSource?.type !== 'raster') {
      dependencies.setError(
        'Pixels mode requires an editable raster layer directly below the new shape.'
      );
      return false;
    }
    const layerIds = [destinationSource.id, transaction.layerId];
    const next = mergeDocumentLayers(transaction.previewDocument, layerIds);
    const destination = findRasterLayer(next, next.activeLayerId);
    if (next === transaction.previewDocument || !destination) {
      dependencies.setError('The GPU raster target for this shape could not be allocated.');
      return false;
    }
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
  };

  const mergeLayersWhenReady = async (selectedLayerIds: LayerId[]) => {
    await waitForTextTargets(selectedLayerIds);
    if (mergeSelectedLayers(selectedLayerIds)) return true;
    throw new Error('The prepared layers could not be merged.');
  };

  const mergeActiveLayerDown = () => {
    const description = { label: 'Merge Layers', type: 'layer.merge' } as const;
    const transaction = beginDocumentTransaction('layer.merge-down', description);
    if (!transaction) return false;
    const current = transaction.before;
    if (!current?.activeLayerId) {
      transaction.cancel();
      dependenciesRef.current.setError('Select a layer with a raster layer directly below it.');
      return false;
    }
    const siblings = siblingLayers(current, current.activeLayerId);
    const index = siblings.findIndex((layer) => layer.id === current.activeLayerId);
    if (index <= 0) {
      transaction.cancel();
      dependenciesRef.current.setError('The active layer has no layer below it to merge with.');
      return false;
    }
    const top = siblings[index];
    const bottom = siblings[index - 1];
    if (!top || !bottom) {
      transaction.cancel();
      dependenciesRef.current.setError('The active layer has no layer below it to merge with.');
      return false;
    }
    return mergeSelectedLayersInTransaction(transaction, [bottom.id, top.id]);
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
      ? cloneAdjustments(dependencies.getDocumentAdjustments?.() ?? createDefaultAdjustments())
      : null;
    const previousPanelAdjustments = resetsDocumentFinalState
      ? cloneAdjustments(dependencies.getPanelAdjustments?.() ?? createDefaultAdjustments())
      : null;
    const previousGlobalGradeStrength = resetsDocumentFinalState
      ? dependencies.getGlobalGradeStrength?.() ?? 100
      : 100;
    const neutralAdjustments = createDefaultAdjustments();
    const plan = request.kind === 'group'
      ? getFlattenGroupPlan(current, request.groupId)
      : getFlattenImagePlan(current);
    if (!plan) {
      documentTransaction.cancel();
      dependencies.setError(
        request.kind === 'group'
          ? 'This group has no layers to flatten.'
          : 'This image has no layers to flatten.'
      );
      return false;
    }

    const next = request.kind === 'group'
      ? flattenGroup(current, request.groupId)
      : flattenImage(current);
    const destination = findRasterLayer(next, next.activeLayerId);
    if (next === current || !destination) {
      documentTransaction.cancel();
      dependenciesRef.current.setError('The full-canvas flatten destination could not be allocated.');
      return false;
    }
    const publishNeutralProcessing = () => {
      const latest = dependenciesRef.current;
      latest.publishDocumentAdjustments?.(neutralAdjustments);
      latest.publishPanelAdjustments?.(neutralAdjustments);
      latest.publishGlobalGradeStrength?.(100);
    };
    const restorePreviousProcessing = () => {
      if (!previousDocumentAdjustments || !previousPanelAdjustments) return;
      const latest = dependenciesRef.current;
      latest.publishDocumentAdjustments?.(previousDocumentAdjustments);
      latest.publishPanelAdjustments?.(previousPanelAdjustments);
      latest.publishGlobalGradeStrength?.(previousGlobalGradeStrength);
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
        byteSize: current.width * current.height * 8,
        layerIds: [...plan.layerIds, destination.id],
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
    return true;
  };

  const flattenWhenReady = async (request: FlattenRequest) => {
    const current = dependenciesRef.current.getDocument();
    const plan = current && (request.kind === 'group'
      ? getFlattenGroupPlan(current, request.groupId)
      : getFlattenImagePlan(current));
    if (!plan) throw new Error('The flatten target is unavailable.');
    await waitForTextTargets(plan.layerIds);
    if (flatten(request)) return true;
    throw new Error('The prepared layer stack could not be flattened.');
  };

  const rasterizeTextLayerById = (layerId: LayerId) => {
    const dependencies = dependenciesRef.current;
    const description = { label: 'Rasterize Type', type: 'layer.rasterize-type' } as const;
    const documentTransaction = beginDocumentTransaction(
      `layer.rasterize-type:${layerId}`,
      description
    );
    if (!documentTransaction) return false;
    const current = documentTransaction.before;
    const renderer = dependencies.getRenderer();
    const source = findDocumentLayer(current, layerId);
    if (source?.type !== 'text' || !renderer) {
      documentTransaction.cancel();
      dependencies.setError('Select a text layer to rasterize.');
      return false;
    }
    const next = rasterizeTextLayer(current, source.id);
    const destination = findRasterLayer(next, source.id);
    if (next === current || !destination) {
      documentTransaction.cancel();
      dependencies.setError('The text layer is locked or cannot be rasterized.');
      return false;
    }

    let editOpen = false;
    let pixelEdit: ReversiblePixelEdit | null = null;
    try {
      if (!renderer.prepareRasterDestination(destination)) {
        documentTransaction.cancel();
        dependencies.setError('The raster destination could not be allocated on the GPU.');
        return false;
      }
      renderer.beginLayerPixelEdit(destination.id);
      editOpen = true;
      if (renderer.captureAllPixelEdit(destination.id) === 0) {
        renderer.cancelPixelEdit();
        editOpen = false;
        renderer.releaseRasterDestination(destination.id);
        documentTransaction.cancel();
        dependencies.setError('Rasterize Type could not capture a recoverable pre-edit snapshot.');
        return false;
      }
      if (!renderer.rasterizeText(current, source, destination)) {
        renderer.cancelPixelEdit();
        editOpen = false;
        renderer.releaseRasterDestination(destination.id);
        documentTransaction.cancel();
        dependencies.setError('The text layer could not be rasterized on the GPU.');
        return false;
      }
      pixelEdit = renderer.finishPixelEdit();
      editOpen = false;
      if (!pixelEdit) {
        renderer.releaseRasterDestination(destination.id);
        documentTransaction.cancel();
        dependencies.setError('Rasterize Type could not create a recoverable undo step.');
        return false;
      }
      const completedEdit = pixelEdit;
      const applyTextRasterState = (rasterized: boolean) => runEditorOperationTransaction({
        operation: rasterized ? 'Redo Rasterize Type' : 'Undo Rasterize Type'
      }, (transaction) => {
        transaction.step(
          'apply raster pixel history',
          () => {
            if (!dependenciesRef.current.getRenderer()?.applyPixelHistory(
              completedEdit,
              rasterized ? 'redo' : 'undo'
            )) {
              throw new Error(
                `Rasterize Type ${rasterized ? 'redo' : 'undo'} is no longer available.`
              );
            }
          },
          () => {
            if (!dependenciesRef.current.getRenderer()?.applyPixelHistory(
              completedEdit,
              rasterized ? 'undo' : 'redo'
            )) {
              throw new Error('Rasterize Type pixel rollback is no longer available.');
            }
          }
        );
        transaction.step(
          'publish document snapshot',
          () => dependenciesRef.current.applyDocumentSnapshot(rasterized ? next : current),
          () => dependenciesRef.current.applyDocumentSnapshot(rasterized ? current : next)
        );
      });
      if (!documentTransaction.stage(() => next)) {
        throw new Error('Rasterize Type could not stage its document state.');
      }
      if (!documentTransaction.commitWith((ownedBefore, ownedAfter) => {
          runEditorOperationTransaction({ operation: description.label }, (publication) => {
            publication.adopt('restore raster pixels', () => {
              completedEdit.undo();
              completedEdit.destroy();
            });
            // Publication or history owns the snapshot after rollback is registered.
            pixelEdit = null;
            publication.step(
              'publish document snapshot',
              () => dependencies.applyDocumentSnapshot(ownedAfter),
              () => dependencies.applyDocumentSnapshot(ownedBefore)
            );
            dependencies.pushHistoryEntry({
              label: description.label,
              type: description.type,
              byteSize: completedEdit.byteSize,
              layerIds: [source.id],
              undo: () => applyTextRasterState(false),
              redo: () => applyTextRasterState(true),
              dispose: completedEdit.destroy
            });
            renderer.commitRasterDestination(destination.id);
          });
          return true;
        })) throw new Error('Rasterize Type could not commit its document state.');
      dependencies.setActiveChannel('pixels');
      dependencies.setError(null);
      dependencies.setStatus('Text layer rasterized');
      return true;
    } catch (reason) {
      if (editOpen) renderer.cancelPixelEdit();
      discardUnpublishedPixelEdit(pixelEdit);
      if (dependencies.getDocument() === next) {
        dependencies.applyDocumentSnapshot(current);
      }
      documentTransaction.cancel();
      renderer.releaseRasterDestination(destination.id);
      dependencies.setError(
        reason instanceof Error ? reason.message : 'The text layer could not be rasterized.'
      );
      return false;
    }
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
        byteSize: current.width * current.height * 8,
        layerIds: [source.id, destination.id],
        undo: () => applyDocumentTransition('Undo Rasterize Layer', next, current),
        redo: () => applyDocumentTransition('Redo Rasterize Layer', current, next)
      },
      errorMessage: 'The layer could not be rasterized on the GPU.'
    })) return false;
    dependencies.setActiveChannel('pixels');
    dependencies.setError(null);
    dependencies.setStatus(`${source.name} rasterized`);
    return true;
  };

  const rasterizeLayerWhenReady = async (layerId: LayerId) => {
    await waitForTextTargets([layerId]);
    if (rasterizeLayerById(layerId)) return true;
    throw new Error('The prepared layer could not be rasterized.');
  };

  const rasterizeActiveLayer = async () => {
    const activeLayerId = dependenciesRef.current.getDocument()?.activeLayerId;
    if (!activeLayerId) {
      const message = 'Select a layer to rasterize.';
      dependenciesRef.current.setError(message);
      return false;
    }
    try {
      return await rasterizeLayerWhenReady(activeLayerId);
    } catch (reason) {
      dependenciesRef.current.setError(
        reason instanceof Error ? reason.message : 'The layer could not be rasterized.'
      );
      return false;
    }
  };

  const rasterizeActiveTextLayer = () => {
    const activeLayerId = dependenciesRef.current.getDocument()?.activeLayerId;
    if (!activeLayerId) {
      dependenciesRef.current.setError('Select a text layer to rasterize.');
      return false;
    }
    return rasterizeTextLayerById(activeLayerId);
  };

  const rasterizeTextLayerWhenReady = async (layerId: LayerId) => {
    const renderer = dependenciesRef.current.getRenderer();
    if (renderer?.waitForTextSource && !await renderer.waitForTextSource(layerId)) {
      const message = 'The text source could not be prepared for rasterization.';
      dependenciesRef.current.setError(message);
      throw new Error(message);
    }
    if (rasterizeTextLayerById(layerId)) return true;
    throw new Error('The text source was ready, but the GPU raster transaction could not be completed.');
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
    try {
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
      const next = channel === 'mask'
        ? markLayerMaskPixelsChanged(current, layerId, fullDocumentBounds(current))
        : markLayerPixelsChanged(current, layerId, fullDocumentBounds(current));
      if (!transaction.stage(() => next)) {
        throw new Error(`${description.label} could not stage its document state.`);
      }
      const completedEdit = pixelEdit;
      if (!transaction.commitWith((before, after) => {
        pixelEdit = null;
        commitAppliedPixelMutation(() => dependenciesRef.current, {
          operation: description.label,
          label: description.label,
          type: description.type,
          layerIds: [layerId],
          before,
          after,
          edits: [completedEdit]
        });
        return true;
      })) throw new Error(`${description.label} could not commit its document state.`);
      dependenciesRef.current.setError(null);
      dependenciesRef.current.setStatus(
        `Inverted ${channel === 'mask' ? 'mask' : 'colors'} on ${activeLayer.name}`
      );
      return true;
    } catch (reason) {
      if (editOpen) renderer.cancelPixelEdit();
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

  const clipboardBounds = (
    document: ImageDocument,
    selection: readonly SelectionOperation[]
  ) => selectionOperationsSupportBounds([...selection], fullDocumentBounds(document));

  const writeClipboard = async (
    blob: Blob,
    document: ImageDocument,
    bounds: Rect
  ) => dependenciesRef.current.getImageClipboard().writeImage(blob, {
    sourceDocumentId: dependenciesRef.current.getDocumentId(),
    ...bounds
  });

  const copySelectedContent = async (selection: readonly SelectionOperation[]) => {
    const dependencies = dependenciesRef.current;
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    const activeLayer = document
      ? findRasterLayer(document, document.activeLayerId)
      : null;
    if (!document || !renderer || !activeLayer || !selection.length) return null;
    const bounds = clipboardBounds(document, selection);
    if (!renderer.copySelectedLayerContent(document, activeLayer.id)) {
      dependencies.setError(
        'The selected pixels could not be copied from the active layer.'
      );
      return null;
    }
    dependencies.setSelectionClipboardAvailable(true);
    try {
      const blob = await renderer.exportSelectionClipboard(bounds);
      await writeClipboard(blob, document, bounds);
      fastClipboardToken = `${dependencies.getDocumentId()}:${++clipboardGeneration}`;
      dependencies.setStatus('Selected pixels copied to the system clipboard');
      dependencies.setError(null);
      return { file: new File([blob], 'Selected pixels.png', {
        type: blob.type || 'image/png'
      }), bounds, fastPasteToken: fastClipboardToken };
    } catch (reason) {
      dependencies.setError(
        reason instanceof Error
          ? reason.message
          : 'The selected pixels could not be written to the system clipboard.'
      );
      return null;
    }
  };

  const copyMergedContent = async (selection: readonly SelectionOperation[]) => {
    const dependencies = dependenciesRef.current;
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!document || !renderer || !selection.length) return null;
    const bounds = clipboardBounds(document, selection);
    fastClipboardToken = null;
    try {
      const blob = await renderer.exportMergedSelection(bounds);
      await writeClipboard(blob, document, bounds);
      dependencies.setSelectionClipboardAvailable(true);
      dependencies.setStatus('Merged selection copied to the system clipboard');
      dependencies.setError(null);
      return { file: new File([blob], 'Merged pixels.png', {
        type: blob.type || 'image/png'
      }), bounds };
    } catch (reason) {
      dependencies.setError(
        reason instanceof Error
          ? reason.message
          : 'The merged selection could not be copied.'
      );
      return null;
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
      try {
        const committed = await documentTransaction.commitWithAsync(async (
          ownedBefore,
          ownedAfter
        ) => {
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
          pixelEdit = renderer.finishPixelEdit();
          editOpen = false;
          if (!pixelEdit) throw new Error('Mask paste could not create a recoverable undo step.');
          const completedEdit = pixelEdit;
          pixelEdit = null;
          commitAppliedPixelMutation(() => dependenciesRef.current, {
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
    const fastPaste = placement.target === undefined && Boolean(requestedFastPasteToken)
      && requestedFastPasteToken === fastClipboardToken
      && renderer.hasSelectionClipboard();
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

  const pasteSelectedContent = async (selection: readonly SelectionOperation[]) => {
    const dependencies = dependenciesRef.current;
    if (!dependencies.getDocument()) return false;
    let clipboardImage;
    try {
      clipboardImage = await dependencies.getImageClipboard().readImage();
    } catch (reason) {
      dependencies.setError(
        reason instanceof Error
          ? reason.message
          : 'The system clipboard could not be read.'
      );
      return false;
    }
    if (!clipboardImage) {
      dependencies.setError('The system clipboard does not contain an image.');
      return false;
    }
    const file = new File(
      [clipboardImage.blob], 'Clipboard image.png',
      { type: clipboardImage.blob.type || 'image/png' }
    );
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    // Clipboard access is asynchronous. Resolve the document only after it
    // completes so placement cannot be calculated from a document that was
    // switched or replaced while the browser/native clipboard was responding.
    const current = dependencies.getDocument();
    if (!current) return false;
    const targetBounds = selection.length
      ? selectionOperationsBounds([...selection], fullDocumentBounds(current))
      : fullDocumentBounds(current);
    const requestedPlacement = centerClipboardBounds(size, targetBounds);
    const target = dependencies.getActiveChannel?.() === 'mask'
      ? { channel: 'mask' as const, layerId: current.activeLayerId ?? undefined }
      : { channel: 'pixels' as const };
    const result = await pastePixelArtifact(file, {
      name: 'Pasted Selection',
      ...requestedPlacement,
      target
    });
    return Boolean(result);
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

  const layerViaCopy = (sourceId: LayerId, selection: readonly SelectionOperation[]) => {
    if (!sourceId) return null;
    if (!selection.length) {
      const duplicatedId = duplicateLayer(sourceId);
      if (duplicatedId) dependenciesRef.current.setStatus('Layer copied');
      return duplicatedId;
    }

    const description = { label: 'Layer Via Copy', type: 'layer.via-copy' } as const;
    const documentTransaction = beginDocumentTransaction(description.type, description);
    if (!documentTransaction) return null;
    const before = documentTransaction.before;
    const renderer = dependenciesRef.current.getRenderer();
    const sourceLayer = findRasterLayer(before, sourceId);
    if (!renderer || !sourceLayer || !renderer.copySelectedLayerContent(before, sourceId)) {
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
    const dirtyBounds = selectionOperationsSupportBounds(
      [...selection],
      fullDocumentBounds(before)
    );
    after = markLayerPixelsChanged(after, copiedLayerId, dirtyBounds);
    const destination = findRasterLayer(after, copiedLayerId);
    if (!destination || !commitReservedRasterMutation({
      transaction: documentTransaction,
      operation: 'Layer Via Copy',
      current: before,
      next: after,
      destination,
      render: () => renderer.pasteSelectionClipboard(copiedLayerId),
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
    dependenciesRef.current.setSelectionClipboardAvailable(true);
    dependenciesRef.current.setActiveChannel('pixels');
    dependenciesRef.current.setStatus('Selection copied to a new layer');
    dependenciesRef.current.setError(null);
    return copiedLayerId;
  };

  return {
    addActiveLayerMask,
    addLayerMask: addMaskToLayer,
    applyBackgroundRemovalMask,
    duplicateActiveLayer,
    duplicateLayer,
    createAdjustmentLayer: createGradeAdjustmentLayer,
    createCurvesAdjustmentLayer,
    createLensFxLayer,
    createAdjustmentLayerOfKind: createProcessingLayer,
    createAttachedAdjustment,
    mergeSelectedLayers,
    rasterizeVectorCreation,
    mergeLayersWhenReady,
    mergeActiveLayerDown,
    flatten,
    flattenWhenReady,
    rasterizeTextLayer: rasterizeTextLayerById,
    rasterizeTextLayerWhenReady,
    rasterizeActiveTextLayer,
    rasterizeLayer: rasterizeLayerById,
    rasterizeLayerWhenReady,
    rasterizeActiveLayer,
    invertLayerColors,
    copySelectedContent,
    copyMergedContent,
    pasteSelectedContent,
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
