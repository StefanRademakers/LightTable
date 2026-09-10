import type { ImageDocument, Rect } from '../../../editor/document/documentTypes';
import type { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';
import type { DocumentSession } from '../../documents/documentSession';
import {
  DocumentSelectionStateStore,
  type LightTableSelectionReadLease
} from '../selection/DocumentSelectionStateStore';

export interface TransformDocumentSelectionPublication {
  readonly session: DocumentSession;
  readonly document: ImageDocument;
  readonly selection: readonly SelectionOperation[];
  readonly coverage: SelectionMaskSnapshot;
  readonly expectedLease: LightTableSelectionReadLease;
  bindingIsCurrent(): boolean;
  rendererIsAddressable(): boolean;
  getProjectedDocument(): ImageDocument | null;
  applyDocumentSnapshot(document: ImageDocument): void;
  publishEditorProjection(input: {
    readonly selection: readonly SelectionOperation[];
    readonly coverage: SelectionMaskSnapshot;
    readonly selectionRevision: number;
    readonly supportBounds: Rect | null;
  }): void;
}

export class TransformSelectionPublicationError extends Error {
  constructor(
    message: string,
    readonly phase: 'before' | 'indeterminate',
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'TransformSelectionPublicationError';
  }
}

const beforeError = (message: string, cause?: unknown) =>
  new TransformSelectionPublicationError(message, 'before', { cause });

const sameLease = (
  current: LightTableSelectionReadLease,
  expected: LightTableSelectionReadLease
) => current.document.sessionId === expected.document.sessionId
  && current.document.revision === expected.document.revision
  && current.selection.revision === expected.selection.revision
  && current.selection.coverage === expected.selection.coverage;

/**
 * Atomically publishes the canonical transform document/selection and its UI
 * projection. Any rejection after the CAS restores the exact opening value
 * before returning control to the terminal pixel owner.
 */
export const publishTransformDocumentSelection = (
  input: TransformDocumentSelectionPublication
): void => input.session.runPublication(() => {
  const store = new DocumentSelectionStateStore(input.session);
  const snapshot = input.session.getSnapshot();
  const expectedDocument = snapshot.document;
  if (!expectedDocument) throw beforeError('The transform selection document is unavailable.');
  const currentLease = store.acquire(snapshot.documentRevision);
  if (!sameLease(currentLease, input.expectedLease) || !input.bindingIsCurrent()) {
    throw beforeError('The transform selection lease is no longer current.');
  }
  const supportBounds = input.coverage.measureBounds()?.supportBounds ?? null;
  const next = {
    ...currentLease.selection,
    revision: (Number(currentLease.selection.revision) + 1) as typeof currentLease.selection.revision,
    canvas: { width: input.document.width, height: input.document.height },
    active: input.coverage.active,
    coverage: input.coverage,
    supportBounds,
    provenance: [...input.selection]
  };
  if (!store.compareAndSwapForDocument(
    currentLease.selection.revision, expectedDocument, next, input.document
  )) throw beforeError('The transform selection changed during compound publication.');

  try {
    // The opening lease is obsolete by construction after the CAS above. From
    // this point onward, ownership is the exact state written by that CAS plus
    // the still-addressable renderer generation.
    if (!input.rendererIsAddressable()) {
      throw new Error('The transform renderer changed during publication.');
    }
    input.applyDocumentSnapshot(input.document);
    if (!input.rendererIsAddressable()) {
      throw new Error('The transform renderer changed during projection.');
    }
    input.publishEditorProjection({
      selection: input.selection,
      coverage: input.coverage,
      selectionRevision: Number(next.revision),
      supportBounds
    });
  } catch (reason) {
    const rollbackErrors: unknown[] = [reason];
    try {
      const rollbackSnapshot = input.session.getSnapshot();
      const rollbackLease = store.acquire(rollbackSnapshot.documentRevision);
      const restored = {
        ...input.expectedLease.selection,
        revision: (Number(rollbackLease.selection.revision) + 1) as typeof rollbackLease.selection.revision,
        canvas: { width: expectedDocument.width, height: expectedDocument.height }
      };
      if (rollbackSnapshot.document !== input.document
        || rollbackLease.selection.revision !== next.revision
        || rollbackLease.selection.coverage !== input.coverage
        || !store.compareAndSwapForDocument(
          rollbackLease.selection.revision,
          input.document,
          restored,
          expectedDocument
        )) {
        throw new Error('The canonical transform selection rollback was rejected.');
      }
    } catch (rollbackReason) {
      rollbackErrors.push(rollbackReason);
    }
    try {
      if (input.getProjectedDocument() === input.document) {
        input.applyDocumentSnapshot(expectedDocument);
      }
    } catch (rollbackReason) {
      rollbackErrors.push(rollbackReason);
    }
    if (rollbackErrors.length > 1) throw new TransformSelectionPublicationError(
      'Transform selection publication rollback failed.',
      'indeterminate',
      { cause: new AggregateError(rollbackErrors) }
    );
    throw beforeError(reason instanceof Error ? reason.message : String(reason), reason);
  }
});
