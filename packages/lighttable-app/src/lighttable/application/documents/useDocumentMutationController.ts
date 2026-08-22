import { useMemo, useRef } from 'react';
import type {
  ImageDocument,
  LayerId,
  VectorLayer
} from '../../editor/document/documentTypes';
import type { VectorElement, VectorPaint } from '@lighttable/vector-core';
import { walkLayerTree, walkRasterLayers } from '../../editor/document/layerTree';

export interface DocumentMutationHistoryEntry {
  readonly layerIds?: readonly LayerId[];
  readonly byteSize?: number;
  undo(): void;
  redo(): void;
}

export interface DocumentMutationDependencies {
  getDocument(): ImageDocument | null;
  applySnapshot(document: ImageDocument): void;
  pushHistoryEntry(entry: DocumentMutationHistoryEntry): void;
}

export interface DocumentMutationController {
  get active(): boolean;
  begin(): boolean;
  end(): boolean;
  reset(): void;
  record(before: ImageDocument, after: ImageDocument): boolean;
  change(
    mutate: (current: ImageDocument) => ImageDocument,
    recordHistory?: boolean
  ): boolean;
}

interface ActiveDocumentTransaction {
  readonly documentId: ImageDocument['id'];
  readonly before: ImageDocument;
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
 * A transaction locks to one document identity. Repeated previews can publish
 * immutable document trees, but completion creates one history command.
 * Undo/redo refuses to mutate a different active document instead of silently
 * leaking edits across workspace sessions.
 */
export const createDocumentMutationController = (
  resolveDependencies: () => DocumentMutationDependencies
): DocumentMutationController => {
  let transaction: ActiveDocumentTransaction | null = null;

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

  const record = (before: ImageDocument, after: ImageDocument): boolean => {
    if (before === after) return false;
    if (before.id !== after.id) {
      throw new Error('A document mutation cannot replace the document identity.');
    }
    const documentId = before.id;
    const retained = rasterResourceRetention(before, after);
    const vectorBytes = vectorSnapshotRetentionBytes(before, after);
    resolveDependencies().pushHistoryEntry({
      layerIds: retained.layerIds,
      byteSize: retained.byteSize + vectorBytes,
      undo: () => applyForDocument(documentId, before),
      redo: () => applyForDocument(documentId, after)
    });
    return true;
  };

  return {
    get active() {
      return transaction !== null;
    },
    begin: () => {
      if (transaction) return false;
      const document = resolveDependencies().getDocument();
      if (!document) return false;
      transaction = {
        documentId: document.id,
        before: document
      };
      return true;
    },
    end: () => {
      if (!transaction) return false;
      const completed = transaction;
      transaction = null;
      const after = resolveDependencies().getDocument();
      if (!after || after.id !== completed.documentId) return false;
      return record(completed.before, after);
    },
    reset: () => {
      transaction = null;
    },
    record,
    change: (mutate, recordHistory = true) => {
      const dependencies = resolveDependencies();
      const current = dependencies.getDocument();
      if (!current) return false;
      if (transaction && transaction.documentId !== current.id) {
        transaction = null;
        return false;
      }
      const next = mutate(current);
      if (next === current) return false;
      if (next.id !== current.id) {
        throw new Error('A document mutation cannot replace the document identity.');
      }
      dependencies.applySnapshot(next);
      if (recordHistory && !transaction) record(current, next);
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
