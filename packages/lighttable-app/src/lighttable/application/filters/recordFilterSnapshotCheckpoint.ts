import type { DocumentSessionId } from '../documents/documentSession';
import type { LightTableCommandService } from '../commands/lightTableCommandService';
import type { ImageDocument } from '../../editor/document/documentTypes';
import { resolveFilterSnapshotOwner, type FilterSnapshotTarget } from './filterSnapshotOwner';

/** Records the exact terminal filter value without exposing renderer/UI state. */
export const recordFilterSnapshotCheckpoint = (
  commandService: Pick<LightTableCommandService, 'recordObservedCommand'> | null | undefined,
  documentId: DocumentSessionId,
  document: ImageDocument,
  target: FilterSnapshotTarget
) => {
  const owner = resolveFilterSnapshotOwner(document, target);
  if (!owner) return;
  commandService?.recordObservedCommand(
    'filter.setSnapshot', documentId,
    { target, snapshot: owner.snapshot },
    { target, changed: true }
  );
};
