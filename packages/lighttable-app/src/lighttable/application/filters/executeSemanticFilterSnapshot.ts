import type { ImageDocument } from '../../editor/document/documentTypes';
import type { FilterSnapshot } from './completeFilterSnapshot';
import {
  applyFilterSnapshot,
  resolveFilterSnapshotOwner,
  type FilterSnapshotTarget
} from './filterSnapshotOwner';

export interface SemanticFilterSnapshotDependencies {
  changeDocument(change: (document: ImageDocument) => ImageDocument): boolean;
}

/** Replaces one typed filter owner atomically through document mutation/history. */
export const executeSemanticFilterSnapshot = (
  command: { readonly target: FilterSnapshotTarget; readonly snapshot: FilterSnapshot },
  dependencies: SemanticFilterSnapshotDependencies
): { readonly target: FilterSnapshotTarget; readonly changed: boolean } => {
  let resolved = false;
  const changed = dependencies.changeDocument((document) => {
    const owner = resolveFilterSnapshotOwner(document, command.target);
    if (!owner) throw new Error('The filter owner does not exist or is locked.');
    resolved = true;
    return applyFilterSnapshot(document, command.target, command.snapshot);
  });
  if (!resolved) throw new Error('The filter owner could not be resolved.');
  return { target: command.target, changed };
};
