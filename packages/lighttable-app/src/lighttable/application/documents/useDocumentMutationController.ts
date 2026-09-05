import { useMemo, useRef } from 'react';
import type {
  ImageDocument,
  LayerId,
  VectorLayer
} from '../../editor/document/documentTypes';
import type { VectorElement, VectorPaint } from '@lighttable/vector-core';
import { walkLayerTree, walkRasterLayers } from '../../editor/document/layerTree';

export interface DocumentMutationHistoryEntry {
  readonly label?: string;
  readonly type?: string;
  readonly layerIds?: readonly LayerId[];
  readonly byteSize?: number;
  undo(): void;
  redo(): void;
}

export interface DocumentMutationDependencies {
  getDocument(): ImageDocument | null;
  applySnapshot(document: ImageDocument): void;
  previewSnapshot(document: ImageDocument): void;
  discardPreview(): void;
  pushHistoryEntry(entry: DocumentMutationHistoryEntry): void;
}

export interface DocumentMutationTransaction {
  readonly documentId: ImageDocument['id'];
  readonly owner: string;
  readonly before: ImageDocument;
  readonly current: ImageDocument;
  get active(): boolean;
  /** Updates the owned document state without asking the document renderer to project it. */
  stage(mutate: (current: ImageDocument) => ImageDocument): boolean;
  change(mutate: (current: ImageDocument) => ImageDocument): boolean;
  commit(description?: DocumentMutationDescription): boolean;
  /** Completes a compound GPU/document operation without creating generic history. */
  commitWith(commit: (before: ImageDocument, after: ImageDocument) => boolean): boolean;
  /**
   * Completes an asynchronous compound operation while retaining the document lease.
   * New document mutations are rejected until the compound publisher has either
   * committed every owned state surface or rolled all of them back.
   */
  commitWithAsync(
    commit: (before: ImageDocument, after: ImageDocument) => Promise<boolean>
  ): Promise<boolean>;
  cancel(): boolean;
}

export interface DocumentMutationController {
  get active(): boolean;
  readonly activeOwner: string | null;
  begin(
    owner: string,
    description?: DocumentMutationDescription,
    onClose?: (reason: DocumentMutationCloseReason) => void,
    interruption?: DocumentMutationInterruption
  ): DocumentMutationTransaction | null;
  commitActive(description?: DocumentMutationDescription): boolean;
  cancelActive(): boolean;
  record(before: ImageDocument, after: ImageDocument, description?: DocumentMutationDescription): boolean;
  change(
    mutate: (current: ImageDocument) => ImageDocument,
    recordHistory?: boolean,
    description?: DocumentMutationDescription
  ): boolean;
}

export type DocumentMutationCloseReason = 'commit' | 'cancel' | 'stale' | 'superseded' | 'failed';
export type DocumentMutationInterruption = 'commit' | 'cancel';

export interface DocumentMutationDescription {
  readonly label: string;
  readonly type: string;
  readonly layerIds?: readonly LayerId[];
  readonly byteSize?: number;
}

const inferDocumentMutationDescription = (
  before: ImageDocument,
  after: ImageDocument
): DocumentMutationDescription => {
  const previous = new Map(walkLayerTree(before.layers).map(({ node }) => [node.id, node]));
  const next = new Map(walkLayerTree(after.layers).map(({ node }) => [node.id, node]));
  const added = [...next.values()].find(({ id }) => !previous.has(id));
  const removed = [...previous.values()].find(({ id }) => !next.has(id));
  if (added) {
    const label = added.type === 'text' ? 'New Type Layer'
      : added.type === 'group' ? 'New Layer Group'
        : added.type === 'adjustment' ? `New ${added.name} Layer`
          : added.type === 'vector' && added.role === 'gradient-fill' ? 'New Gradient Fill Layer'
            : added.type === 'vector' ? 'New Shape Layer'
              : 'New Pixel Layer';
    return { label, type: `layer.create.${added.type}` };
  }
  if (removed) return { label: 'Delete Layer', type: 'layer.delete' };
  const previousOrder = [...previous.keys()].join('\u0000');
  const nextOrder = [...next.keys()].join('\u0000');
  if (previousOrder !== nextOrder) return { label: 'Move Layer', type: 'layer.move' };
  for (const [id, previousNode] of previous) {
    const nextNode = next.get(id);
    if (!nextNode || previousNode === nextNode) continue;
    if (previousNode.name !== nextNode.name) return { label: 'Rename Layer', type: 'layer.rename' };
    if (previousNode.visible !== nextNode.visible) return {
      label: nextNode.visible ? 'Show Layer' : 'Hide Layer', type: 'layer.visibility'
    };
    if (previousNode.opacity !== nextNode.opacity) return { label: 'Layer Opacity', type: 'layer.opacity' };
    if (previousNode.fillOpacity !== nextNode.fillOpacity) return { label: 'Layer Fill', type: 'layer.fill-opacity' };
    if (previousNode.blendMode !== nextNode.blendMode) return { label: 'Blending Change', type: 'layer.blend-mode' };
    if (previousNode.clipping !== nextNode.clipping) return {
      label: nextNode.clipping ? 'Create Clipping Mask' : 'Release Clipping Mask', type: 'layer.clipping'
    };
    if (previousNode.locks !== nextNode.locks) return { label: 'Lock Layers', type: 'layer.locks' };
    if (previousNode.styleStack !== nextNode.styleStack) return { label: 'Layer Style', type: 'layer.style' };
    if (previousNode.transform !== nextNode.transform) return { label: 'Free Transform', type: 'layer.transform' };
    if (previousNode.mask !== nextNode.mask) return { label: 'Edit Layer Mask', type: 'layer.mask.edit' };
    if (previousNode.type === 'text' && nextNode.type === 'text'
      && previousNode.text !== nextNode.text) return { label: 'Edit Type', type: 'text.edit' };
    if (previousNode.type === 'vector' && nextNode.type === 'vector'
      && previousNode.elements !== nextNode.elements) return {
      label: nextNode.role === 'gradient-fill' ? 'Edit Gradient Fill' : 'Edit Shape',
      type: nextNode.role === 'gradient-fill' ? 'gradient.edit' : 'vector.edit'
    };
    if (previousNode.type === 'raster' && nextNode.type === 'raster'
      && (previousNode.adjustmentStack !== nextNode.adjustmentStack
        || previousNode.attachedAdjustments !== nextNode.attachedAdjustments)) {
      return { label: 'Edit Layer Adjustment', type: 'layer.adjustment.edit' };
    }
  }
  if (before.guides !== after.guides) return {
    label: after.guides.length < before.guides.length ? 'Clear Guides' : 'New Guide',
    type: 'document.guides'
  };
  if (before.activeLayerId !== after.activeLayerId) return { label: 'Select Layer', type: 'layer.select' };
  if (before.colorSettings !== after.colorSettings) return { label: 'Color Profile', type: 'document.color-profile' };
  if (before.name !== after.name) return { label: 'Rename Document', type: 'document.rename' };
  return { label: 'Document Change', type: 'document.change' };
};

interface ActiveDocumentTransaction {
  readonly token: symbol;
  readonly documentId: ImageDocument['id'];
  readonly owner: string;
  readonly before: ImageDocument;
  readonly description?: DocumentMutationDescription;
  readonly onClose?: (reason: DocumentMutationCloseReason) => void;
  readonly interruption: DocumentMutationInterruption;
  phase: 'previewing' | 'committing';
  latest: ImageDocument;
}

interface RasterResourceRetention {
  readonly layerIds: readonly LayerId[];
  readonly byteSize: number;
}

const rasterResourceRetention = (
  before: ImageDocument,
  after: ImageDocument
): RasterResourceRetention => {
  const beforeRasters = new Map(
    walkRasterLayers(before.layers).map(({ layer }) => [layer.id, layer] as const)
  );
  const afterRasters = new Map(
    walkRasterLayers(after.layers).map(({ layer }) => [layer.id, layer] as const)
  );
  const candidateIds = new Set([...beforeRasters.keys(), ...afterRasters.keys()]);
  const layerIds: LayerId[] = [];
  let byteSize = 0;
  candidateIds.forEach((id) => {
    const previous = beforeRasters.get(id);
    const next = afterRasters.get(id);
    const rasterAppearedOrDisappeared = !previous || !next;
    const maskIdentityChanged = previous?.mask?.id !== next?.mask?.id;
    if (!rasterAppearedOrDisappeared && !maskIdentityChanged) return;
    layerIds.push(id);
    const representative = previous ?? next;
    if (representative) {
      byteSize += Math.max(1, representative.width)
        * Math.max(1, representative.height)
        * 8;
    }
    if (maskIdentityChanged && (previous?.mask || next?.mask)) {
      byteSize += Math.max(1, before.width) * Math.max(1, before.height) * 8;
    }
  });
  return { layerIds, byteSize };
};

const stringBytes = (value: string) => value.length * 2;

const vectorPaintBytes = (paint: VectorPaint | null): number => {
  if (!paint) return 0;
  if ('type' in paint) return 64;
  return 256
    + stringBytes(paint.asset.id)
    + stringBytes(paint.asset.name)
    + paint.asset.colorStops.reduce((bytes, stop) => bytes + 96 + stringBytes(stop.id), 0)
    + paint.asset.opacityStops.reduce((bytes, stop) => bytes + 64 + stringBytes(stop.id), 0);
};

/** Approximate retained canonical JS data, excluding backend-derived resources. */
const vectorElementBytes = (element: VectorElement | undefined): number => {
  if (!element) return 0;
  const styleBytes = 160
    + vectorPaintBytes(element.style.fill)
    + (element.style.stroke
      ? 192 + vectorPaintBytes(element.style.stroke.paint) + element.style.stroke.dash.length * 8
      : 0);
  const common = 256 + stringBytes(element.id) + stringBytes(element.name) + styleBytes;
  if (element.type === 'live-shape') return common + 256;
  return common + element.subpaths.reduce((bytes, subpath) => (
    bytes + 96 + stringBytes(subpath.id) + subpath.anchors.reduce(
      (anchorBytes, anchor) => anchorBytes + 192 + stringBytes(anchor.id),
      0
    )
  ), 0);
};

const vectorSnapshotRetentionBytes = (before: ImageDocument, after: ImageDocument): number => {
  const vectors = (document: ImageDocument) => {
    const entries: Array<readonly [LayerId, VectorLayer]> = [];
    for (const { node } of walkLayerTree(document.layers)) {
      if (node.type === 'vector') entries.push([node.id, node]);
    }
    return new Map(entries);
  };
  const beforeLayers = vectors(before);
  const afterLayers = vectors(after);
  let bytes = 0;
  for (const layerId of new Set([...beforeLayers.keys(), ...afterLayers.keys()])) {
    const previous = beforeLayers.get(layerId);
    const next = afterLayers.get(layerId);
    if (previous === next) continue;
    const previousElements = new Map(previous?.elements.map((element) => [element.id, element]));
    const nextElements = new Map(next?.elements.map((element) => [element.id, element]));
    bytes += 256;
    for (const elementId of new Set([...previousElements.keys(), ...nextElements.keys()])) {
      const beforeElement = previousElements.get(elementId);
      const afterElement = nextElements.get(elementId);
      if (beforeElement === afterElement) continue;
      bytes += Math.max(vectorElementBytes(beforeElement), vectorElementBytes(afterElement));
    }
  }
  return bytes;
};

/**
 * Owns canonical document mutations and their reversible transaction boundary.
 *
 * A transaction locks to one canonical document snapshot. Pointer-rate changes
 * remain staged and are projected only to the renderer. Completion publishes
 * the final immutable tree once and creates one history command.
 * Undo/redo refuses to mutate a different active document instead of silently
 * leaking edits across workspace sessions.
 */
export const createDocumentMutationController = (
  resolveDependencies: () => DocumentMutationDependencies
): DocumentMutationController => {
  let transaction: ActiveDocumentTransaction | null = null;

  const canonicalOriginIsCurrent = (active: ActiveDocumentTransaction): boolean => {
    const current = resolveDependencies().getDocument();
    return current === active.before
      && current.id === active.documentId
      && current.revision === active.before.revision;
  };

  const applyForDocument = (
    documentId: ImageDocument['id'],
    snapshot: ImageDocument
  ) => {
    const dependencies = resolveDependencies();
    if (dependencies.getDocument()?.id !== documentId) {
      throw new Error('The document mutation belongs to a different document.');
    }
    dependencies.applySnapshot(snapshot);
  };

  const record = (before: ImageDocument, after: ImageDocument,
    description?: DocumentMutationDescription): boolean => {
    if (before === after) return false;
    if (before.id !== after.id) {
      throw new Error('A document mutation cannot replace the document identity.');
    }
    const documentId = before.id;
    const retained = rasterResourceRetention(before, after);
    const vectorBytes = vectorSnapshotRetentionBytes(before, after);
    const resolvedDescription = description ?? inferDocumentMutationDescription(before, after);
    resolveDependencies().pushHistoryEntry({
      label: resolvedDescription.label,
      type: resolvedDescription.type,
      layerIds: [...new Set([
        ...retained.layerIds,
        ...(description?.layerIds ?? [])
      ])],
      byteSize: retained.byteSize + vectorBytes + (description?.byteSize ?? 0),
      undo: () => applyForDocument(documentId, before),
      redo: () => applyForDocument(documentId, after)
    });
    return true;
  };

  const cancelTransaction = (
    token: symbol,
    reason: DocumentMutationCloseReason = 'cancel'
  ): boolean => {
    if (!transaction || transaction.token !== token || transaction.phase === 'committing') {
      return false;
    }
    const active = transaction;
    transaction = null;
    active.onClose?.(reason);
    resolveDependencies().discardPreview();
    return true;
  };

  const commitTransaction = (
    token: symbol,
    description?: DocumentMutationDescription
  ): boolean => {
    const active = transaction;
    if (!active || active.token !== token || active.phase === 'committing') return false;
    if (!canonicalOriginIsCurrent(active)) {
      transaction = null;
      active.onClose?.('stale');
      resolveDependencies().discardPreview();
      return false;
    }
    transaction = null;
    if (active.latest === active.before) {
      active.onClose?.('commit');
      resolveDependencies().discardPreview();
      return false;
    }
    const dependencies = resolveDependencies();
    try {
      dependencies.applySnapshot(active.latest);
      record(active.before, active.latest, description ?? active.description);
      active.onClose?.('commit');
      return true;
    } catch (error) {
      try {
        dependencies.applySnapshot(active.before);
      } finally {
        dependencies.discardPreview();
      }
      active.onClose?.('failed');
      throw error;
    }
  };

  const commitTransactionWith = (
    token: symbol,
    commit: (before: ImageDocument, after: ImageDocument) => boolean
  ): boolean => {
    const active = transaction;
    if (!active || active.token !== token || active.phase === 'committing') return false;
    if (!canonicalOriginIsCurrent(active)) {
      transaction = null;
      active.onClose?.('stale');
      resolveDependencies().discardPreview();
      return false;
    }
    transaction = null;
    if (active.latest === active.before) {
      active.onClose?.('commit');
      resolveDependencies().discardPreview();
      return false;
    }
    try {
      const committed = commit(active.before, active.latest);
      active.onClose?.(committed ? 'commit' : 'failed');
      if (!committed) resolveDependencies().discardPreview();
      return committed;
    } catch (error) {
      active.onClose?.('failed');
      resolveDependencies().discardPreview();
      throw error;
    }
  };

  const commitTransactionWithAsync = async (
    token: symbol,
    commit: (before: ImageDocument, after: ImageDocument) => Promise<boolean>
  ): Promise<boolean> => {
    const active = transaction;
    if (!active || active.token !== token || active.phase === 'committing') return false;
    if (!canonicalOriginIsCurrent(active)) {
      transaction = null;
      active.onClose?.('stale');
      resolveDependencies().discardPreview();
      return false;
    }
    if (active.latest === active.before) {
      transaction = null;
      active.onClose?.('commit');
      resolveDependencies().discardPreview();
      return false;
    }
    // Keep the lease visible while the specialized publisher coordinates GPU,
    // document and auxiliary state. A second command cannot supersede a
    // half-published compound edit.
    active.phase = 'committing';
    try {
      const committed = await commit(active.before, active.latest);
      if (transaction?.token === token) transaction = null;
      active.onClose?.(committed ? 'commit' : 'failed');
      if (!committed) resolveDependencies().discardPreview();
      return committed;
    } catch (error) {
      if (transaction?.token === token) transaction = null;
      active.onClose?.('failed');
      resolveDependencies().discardPreview();
      throw error;
    }
  };

  const updateTransaction = (
    active: ActiveDocumentTransaction,
    mutate: (current: ImageDocument) => ImageDocument,
    project: boolean
  ): boolean => {
    if (transaction?.token !== active.token || active.phase === 'committing') return false;
    if (!canonicalOriginIsCurrent(active)) {
      cancelTransaction(active.token);
      return false;
    }
    const current = active.latest;
    const next = mutate(current);
    if (next === current) return false;
    if (next.id !== active.documentId) {
      throw new Error('A document mutation cannot replace the document identity.');
    }
    active.latest = next;
    if (!project) return true;
    try {
      resolveDependencies().previewSnapshot(next);
    } catch (error) {
      active.latest = current;
      cancelTransaction(active.token);
      throw error;
    }
    return true;
  };

  return {
    get active() {
      return transaction !== null;
    },
    get activeOwner() {
      return transaction?.owner ?? null;
    },
    begin: (owner, description, onClose, interruption = 'commit') => {
      if (!owner.trim()) throw new Error('A document transaction requires an owner.');
      // A newly-started interaction is the document-level boundary between
      // gestures. Finish the previous authored change before granting the new
      // lease. Its old handle becomes stale and cannot preview, commit or
      // discard the new owner's state.
      if (transaction) {
        if (transaction.phase === 'committing') return null;
        if (transaction.interruption === 'cancel') {
          cancelTransaction(transaction.token, 'superseded');
        } else {
          commitTransaction(transaction.token);
        }
      }
      const document = resolveDependencies().getDocument();
      if (!document) return null;
      const active: ActiveDocumentTransaction = {
        token: Symbol('document-transaction'),
        documentId: document.id,
        owner,
        before: document,
        description,
        onClose,
        interruption,
        phase: 'previewing',
        latest: document
      };
      transaction = active;
      return {
        documentId: active.documentId,
        owner: active.owner,
        before: active.before,
        get current() {
          return active.latest;
        },
        get active() {
          return transaction?.token === active.token;
        },
        stage: (mutate) => updateTransaction(active, mutate, false),
        change: (mutate) => updateTransaction(active, mutate, true),
        commit: (description) => commitTransaction(active.token, description),
        commitWith: (commit) => commitTransactionWith(active.token, commit),
        commitWithAsync: (commit) => commitTransactionWithAsync(active.token, commit),
        cancel: () => cancelTransaction(active.token)
      };
    },
    commitActive: (description) => transaction
      ? commitTransaction(transaction.token, description)
      : false,
    cancelActive: () => transaction ? cancelTransaction(transaction.token) : false,
    record,
    change: (mutate, recordHistory = true, description) => {
      // Discrete commands form a new document operation. If a control failed
      // to deliver blur/pointer-up, preserve its visible result as its own
      // history item before executing the command. Late callbacks are rejected
      // by the transaction token.
      if (transaction) {
        if (transaction.phase === 'committing') return false;
        if (transaction.interruption === 'cancel') {
          cancelTransaction(transaction.token, 'superseded');
        } else {
          commitTransaction(transaction.token);
        }
      }
      const dependencies = resolveDependencies();
      const current = dependencies.getDocument();
      if (!current) return false;
      const next = mutate(current);
      if (next === current) return false;
      if (next.id !== current.id) {
        throw new Error('A document mutation cannot replace the document identity.');
      }
      dependencies.applySnapshot(next);
      if (recordHistory) record(current, next, description);
      return true;
    }
  };
};

export const useDocumentMutationController = (
  dependencies: DocumentMutationDependencies
): DocumentMutationController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  return useMemo(
    () => createDocumentMutationController(() => dependenciesRef.current),
    []
  );
};
