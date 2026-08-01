import {
  PathMutationSession,
  type VectorPath
} from '@lighttable/vector-core';
import {
  appendVectorPath,
  createVectorLayer,
  deleteVectorPaths,
  replaceVectorPath
} from '../../editor/document/documentCommands';
import type {
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';

export interface VectorDocumentControllerDependencies {
  getDocument(): ImageDocument | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  pushDocumentHistory(before: ImageDocument, after: ImageDocument): void;
}

interface ActivePathMutation {
  documentId: ImageDocument['id'];
  layerId: LayerId;
  pathId: string;
  beforeDocument: ImageDocument;
  session: PathMutationSession;
}

/**
 * Application boundary for native vector mutations.
 *
 * Pure document commands remain unaware of interaction lifetime. This
 * controller turns arbitrarily many pointer-move previews into one history
 * entry and refuses to leak an edit into a newly activated document.
 */
export class VectorDocumentController {
  private active: ActivePathMutation | null = null;

  constructor(
    private readonly resolveDependencies: () => VectorDocumentControllerDependencies
  ) {}

  createLayer(paths: readonly VectorPath[] = [], name = 'Shape') {
    return this.applyAtomic((document) => createVectorLayer(document, paths, name));
  }

  appendPath(layerId: LayerId, path: VectorPath) {
    return this.applyAtomic((document) => appendVectorPath(document, layerId, path));
  }

  deletePaths(layerId: LayerId, pathIds: readonly string[]) {
    return this.applyAtomic((document) => deleteVectorPaths(document, layerId, pathIds));
  }

  beginPathMutation(layerId: LayerId, pathId: string) {
    if (this.active) this.cancelPathMutation();
    const document = this.resolveDependencies().getDocument();
    const layer = document ? findDocumentLayer(document, layerId) : null;
    const path = layer?.type === 'vector'
      ? layer.paths.find(({ id }) => id === pathId)
      : null;
    if (!document || !path) return false;
    this.active = {
      documentId: document.id,
      layerId,
      pathId,
      beforeDocument: document,
      session: new PathMutationSession(path)
    };
    return true;
  }

  previewPathMutation(mutate: (openingSnapshot: VectorPath) => VectorPath) {
    const active = this.active;
    const dependencies = this.resolveDependencies();
    const document = dependencies.getDocument();
    if (!active || document?.id !== active.documentId) {
      this.active = null;
      return false;
    }
    const layer = findDocumentLayer(document, active.layerId);
    if (layer?.type !== 'vector' || !layer.paths.some(({ id }) => id === active.pathId)) {
      this.active = null;
      return false;
    }
    const preview = active.session.update(mutate);
    const next = replaceVectorPath(document, active.layerId, preview);
    if (next === document) return false;
    dependencies.applyDocumentSnapshot(next);
    return true;
  }

  commitPathMutation() {
    const active = this.active;
    if (!active) return false;
    this.active = null;
    const dependencies = this.resolveDependencies();
    const document = dependencies.getDocument();
    if (document?.id !== active.documentId) return false;
    const commit = active.session.commit();
    if (!commit) {
      dependencies.applyDocumentSnapshot(active.beforeDocument);
      return false;
    }
    dependencies.pushDocumentHistory(active.beforeDocument, document);
    return true;
  }

  cancelPathMutation() {
    const active = this.active;
    if (!active) return false;
    this.active = null;
    active.session.cancel();
    const dependencies = this.resolveDependencies();
    if (dependencies.getDocument()?.id !== active.documentId) return false;
    dependencies.applyDocumentSnapshot(active.beforeDocument);
    return true;
  }

  dispose() {
    this.cancelPathMutation();
  }

  private applyAtomic(change: (document: ImageDocument) => ImageDocument) {
    if (this.active) return false;
    const dependencies = this.resolveDependencies();
    const before = dependencies.getDocument();
    if (!before) return false;
    const after = change(before);
    if (after === before) return false;
    dependencies.applyDocumentSnapshot(after);
    dependencies.pushDocumentHistory(before, after);
    return true;
  }
}
