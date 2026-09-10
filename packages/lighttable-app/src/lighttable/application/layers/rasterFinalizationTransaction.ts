import type { ImageDocument, LayerId, RasterLayer } from '../../editor/document/documentTypes';
import { runEditorOperationTransaction } from '../commands/editorOperationTransaction';
import type { DocumentHistoryReservation } from '../commands/documentCommandHistory';
import type { DocumentMutationTransaction } from '../documents/useDocumentMutationController';

export interface RasterFinalizationHistoryEntry {
  label?: string;
  type?: string;
  byteSize?: number;
  layerIds?: readonly LayerId[];
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
  dispose?(): void;
}

interface RasterFinalizationRenderer {
  prepareRasterDestination(destination: RasterLayer): boolean;
  commitRasterDestination(layerId: LayerId): void;
  releaseRasterDestination(layerId: LayerId): boolean;
}

export interface RasterFinalizationMutation {
  readonly operation: string;
  readonly current: ImageDocument;
  readonly next: ImageDocument;
  readonly destination: RasterLayer;
  readonly render: () => boolean;
  readonly historyEntry: RasterFinalizationHistoryEntry;
  readonly processing?: {
    readonly publish: () => void;
    readonly restore: () => void;
  };
  readonly rollbackDocument?: ImageDocument;
  readonly errorMessage: string;
}

interface RasterFinalizationDependencies {
  readonly renderer: RasterFinalizationRenderer;
  readonly reserveHistoryEntry: (
    entry: RasterFinalizationHistoryEntry
  ) => DocumentHistoryReservation;
  readonly applyDocumentSnapshot: (document: ImageDocument) => void;
  readonly reportError: (message: string) => void;
}

export const publishRasterFinalization = (
  dependencies: RasterFinalizationDependencies,
  mutation: RasterFinalizationMutation
) => {
  let historyReservation: DocumentHistoryReservation | null = null;
  runEditorOperationTransaction({ operation: mutation.operation }, (operation) => {
    historyReservation = dependencies.reserveHistoryEntry(mutation.historyEntry);
    operation.adopt('cancel reserved history entry', () => historyReservation?.cancel());
    operation.adopt('release reserved raster destination', () => {
      dependencies.renderer.releaseRasterDestination(mutation.destination.id);
    });
    if (!dependencies.renderer.prepareRasterDestination(mutation.destination)) {
      throw new Error('The raster destination could not be allocated on the GPU.');
    }
    if (!mutation.render()) throw new Error(mutation.errorMessage);
    if (mutation.processing) {
      operation.step(
        'publish document processing state',
        mutation.processing.publish,
        mutation.processing.restore
      );
    }
    operation.step(
      'publish document snapshot',
      () => dependencies.applyDocumentSnapshot(mutation.next),
      () => dependencies.applyDocumentSnapshot(
        mutation.rollbackDocument ?? mutation.current
      )
    );
    if (!historyReservation.commit()) {
      throw new Error('History no longer accepts the raster finalization command.');
    }
    // The history entry now owns both runtimes. Releasing the temporary
    // reservation is administrative and cannot invalidate a durable command.
    try {
      dependencies.renderer.commitRasterDestination(mutation.destination.id);
    } catch (reason) {
      console.error('Raster destination reservation cleanup failed.', reason);
    }
  });
};

/**
 * Commits one prepared GPU raster and its document/history projections as a
 * single fail-closed transaction. This is the sole publication owner for the
 * C02 rasterize, merge, flatten and vector-to-pixels finalization family.
 */
export const commitRasterFinalization = (
  dependencies: RasterFinalizationDependencies,
  transaction: DocumentMutationTransaction,
  mutation: RasterFinalizationMutation
): boolean => {
  if (!transaction.stage(() => mutation.next)) {
    transaction.cancel();
    return false;
  }
  try {
    return transaction.commitWith((ownedBefore, ownedAfter) => {
      publishRasterFinalization(dependencies, {
        ...mutation,
        current: ownedBefore,
        next: ownedAfter,
        rollbackDocument: mutation.rollbackDocument ?? ownedBefore
      });
      return true;
    });
  } catch (reason) {
    dependencies.reportError(
      reason instanceof Error ? reason.message : mutation.errorMessage
    );
    return false;
  }
};
