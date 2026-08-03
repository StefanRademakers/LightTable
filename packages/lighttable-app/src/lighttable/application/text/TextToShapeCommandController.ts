import type { VectorPath } from '@lighttable/vector-core';
import { replaceTextLayerWithVectorPaths } from '../../editor/document/documentCommands';
import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';

export interface TextToShapeCommandDependencies {
  getDocument(): ImageDocument | null;
  applyDocument(document: ImageDocument): void;
  pushDocumentHistory(before: ImageDocument, after: ImageDocument): void;
  resolveVectorPaths(layerId: LayerId, signal: AbortSignal): Promise<readonly VectorPath[] | null>;
}

/** Owns the one-shot, one-history-entry boundary for Convert to Shape. */
export class TextToShapeCommandController {
  private operation: { controller: AbortController; documentId: ImageDocument['id'] } | null = null;

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
    const operation = { controller, documentId: before.id };
    this.operation = operation;
    try {
      const paths = await dependencies.resolveVectorPaths(layerId, controller.signal);
      if (controller.signal.aborted || this.operation !== operation || !paths?.length) return false;
      const current = this.resolveDependencies().getDocument();
      if (current !== before || current?.id !== operation.documentId) return false;
      const after = replaceTextLayerWithVectorPaths(before, layerId, paths);
      if (after === before) return false;
      const latest = this.resolveDependencies();
      if (latest.getDocument() !== before) return false;
      latest.applyDocument(after);
      latest.pushDocumentHistory(before, after);
      return true;
    } finally {
      if (this.operation === operation) this.operation = null;
    }
  }

  cancel() {
    if (!this.operation) return false;
    this.operation.controller.abort();
    this.operation = null;
    return true;
  }
}
