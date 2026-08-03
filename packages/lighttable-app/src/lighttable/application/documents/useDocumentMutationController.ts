import { useMemo, useRef } from 'react';
import type {
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { walkRasterLayers } from '../../editor/document/layerTree';

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
    resolveDependencies().pushHistoryEntry({
      layerIds: retained.layerIds,
      byteSize: retained.byteSize,
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
