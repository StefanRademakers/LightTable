import { useMemo, useRef } from 'react';
import type {
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { walkLayerTree, walkRasterLayers } from '../../editor/document/layerTree';
import type { DocumentSessionId } from '../documents/documentSession';
import type { DocumentCommandHistory } from './documentCommandHistory';

export interface EditorHistoryEntry {
  readonly label?: string;
  readonly type?: string;
  readonly byteSize?: number;
  readonly layerIds?: readonly LayerId[];
  /** Raster runtime IDs retained for GPU undo/redo; independent of affected layers. */
  readonly resourceIds?: readonly LayerId[];
  readonly documentMutation?: boolean;
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
  dispose?(): void;
}

export interface HistoryRuntimePruner {
  pruneLayerRuntimes(
    documentResourceKey: string,
    keepRasterLayerIds: ReadonlySet<LayerId>,
    keepMaskLayerIds: ReadonlySet<LayerId>
  ): void;
}

export interface DocumentHistoryDependencies {
  readonly documentId: DocumentSessionId;
  readonly history: DocumentCommandHistory;
  getDocument(): ImageDocument | null;
  getRenderer(): HistoryRuntimePruner | null;
  finishOpenTransactions(): void;
  setError(message: string): void;
}

export interface DocumentHistoryController {
  record(entry: EditorHistoryEntry): void;
  clear(): void;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  navigateTo(position: number): Promise<boolean>;
  deleteFrom(position: number): Promise<boolean>;
  purge(): void;
  pruneResources(): void;
}

/**
 * Adapts feature-level reversible edits to one document's command history.
 *
 * Command IDs, retained raster resources, open transaction finalization and
 * undo/redo error publication belong to the document session rather than the
 * editor view. This controller is therefore safe to keep alive while another
 * workspace document is active.
 */
export const createDocumentHistoryController = (
  resolveDependencies: () => DocumentHistoryDependencies
): DocumentHistoryController => {
  let commandSequence = 0;

  const pruneResources = () => {
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const keepRasterLayers = new Set<LayerId>(
      document
        ? walkRasterLayers(document.layers).map(({ layer }) => layer.id)
        : []
    );
    const keepMasks = new Set<LayerId>(
      document ? walkLayerTree(document.layers).map(({ node }) => node.id) : []
    );
    dependencies.history.getRetainedResourceIds().forEach((id) => {
      keepRasterLayers.add(id as LayerId);
      keepMasks.add(id as LayerId);
    });
    if (document) {
      dependencies.getRenderer()?.pruneLayerRuntimes(
        document.id,
        keepRasterLayers,
        keepMasks
      );
    }
  };

  const runHistoryOperation = async (
    operation: 'undo' | 'redo' | 'navigate' | 'delete',
    position?: number
  ): Promise<boolean> => {
    const dependencies = resolveDependencies();
    dependencies.finishOpenTransactions();
    try {
      const changed = operation === 'navigate'
        ? await dependencies.history.goToPosition(position!)
        : operation === 'delete'
          ? await dependencies.history.deleteFromPosition(position!)
          : await dependencies.history[operation]();
      pruneResources();
      return changed;
    } catch (reason) {
      dependencies.setError(
        reason instanceof Error
          ? reason.message
          : `LightTable ${operation} failed.`
      );
      return false;
    }
  };

  return {
    record: (entry) => {
      const dependencies = resolveDependencies();
      commandSequence += 1;
      dependencies.history.record({
        id: `${dependencies.documentId}:editor:${commandSequence}`,
        type: entry.type ?? 'editor.mutation',
        label: entry.label ?? 'Document Change',
        documentId: dependencies.documentId,
        affectsDocument: entry.documentMutation !== false,
        byteSize: entry.byteSize,
        resourceIds: entry.resourceIds ?? entry.layerIds,
        undo: entry.undo,
        redo: entry.redo,
        dispose: entry.dispose
      });
      pruneResources();
    },
    clear: () => {
      const dependencies = resolveDependencies();
      dependencies.finishOpenTransactions();
      dependencies.history.clear();
      pruneResources();
    },
    undo: () => runHistoryOperation('undo'),
    redo: () => runHistoryOperation('redo'),
    navigateTo: (position) => runHistoryOperation('navigate', position),
    deleteFrom: (position) => runHistoryOperation('delete', position),
    purge: () => {
      const dependencies = resolveDependencies();
      dependencies.finishOpenTransactions();
      dependencies.history.clear({ preserveDirtyState: true });
      pruneResources();
    },
    pruneResources
  };
};

export const useDocumentHistoryController = (
  dependencies: DocumentHistoryDependencies
): DocumentHistoryController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  return useMemo(
    () => createDocumentHistoryController(() => dependenciesRef.current),
    []
  );
};
