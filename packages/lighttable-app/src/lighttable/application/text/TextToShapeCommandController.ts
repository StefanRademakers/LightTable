import type { VectorPath } from '@lighttable/vector-core';
import { replaceTextLayerWithVectorPaths } from '../../editor/document/documentCommands';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type {
  DocumentMutationController,
  DocumentMutationTransaction
} from '../documents/useDocumentMutationController';

export interface TextToShapeCommandDependencies {
  getDocument(): ImageDocument | null;
  documentMutations: Pick<DocumentMutationController, 'begin'>;
  resolveVectorPaths(layerId: LayerId, signal: AbortSignal): Promise<readonly VectorPath[] | null>;
}

/** Owns the one-shot, one-history-entry boundary for Convert to Shape. */
export class TextToShapeCommandController {
  private operation: {
    controller: AbortController;
    transaction: DocumentMutationTransaction;
  } | null = null;

  constructor(private readonly resolveDependencies: () => TextToShapeCommandDependencies) {}

  get busy() {
    return this.operation !== null;
  }

  async convert(layerId: LayerId): Promise<boolean> {
    if (this.operation) return false;
    const dependencies = this.resolveDependencies();
    const before = dependencies.getDocument();
    const layer = before && findDocumentLayer(before, layerId);
    if (!before || layer?.type !== 'text' || layer.locks.all || layer.locks.pixels) return false;
    const controller = new AbortController();
    const transaction = dependencies.documentMutations.begin(
      'text.convert-to-shape',
      { label: 'Convert to Shape', type: 'text.convert-to-shape', layerIds: [layerId] },
      (reason) => {
        if (reason !== 'commit') controller.abort();
      },
      'cancel'
    );
    if (!transaction) return false;
    const operation = { controller, transaction };
    this.operation = operation;
    try {
      const paths = await dependencies.resolveVectorPaths(layerId, controller.signal);
      if (controller.signal.aborted || this.operation !== operation || !paths?.length) {
        transaction.cancel();
        return false;
      }
      if (!transaction.stage(
        (current) => replaceTextLayerWithVectorPaths(current, layerId, paths)
      )) {
        transaction.cancel();
        return false;
      }
      return transaction.commit();
    } finally {
      transaction.cancel();
      if (this.operation === operation) this.operation = null;
    }
  }

  cancel() {
    if (!this.operation) return false;
    this.operation.controller.abort();
    this.operation.transaction.cancel();
    this.operation = null;
    return true;
  }
}
