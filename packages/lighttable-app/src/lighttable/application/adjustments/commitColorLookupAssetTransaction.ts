import type { EditorHistoryEntry } from '../commands/useDocumentHistoryController';
import type { DocumentMutationTransaction } from '../documents/useDocumentMutationController';
import type {
  DocumentAssetId,
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import type { BasicAdjustments } from '../../types';
import {
  projectAdjustmentSnapshot,
  type AdjustmentProjection
} from './projectAdjustmentSnapshot';

export interface ColorLookupRuntimePort {
  loadColorLookupAsset(
    documentResourceKey: string,
    asset: { readonly lutId: DocumentAssetId; readonly source: Blob }
  ): Promise<void>;
  removeColorLookupAsset(
    documentResourceKey: string,
    assetId: DocumentAssetId
  ): boolean;
}

export interface ColorLookupAssetTransactionInput {
  readonly transaction: DocumentMutationTransaction;
  readonly runtime: ColorLookupRuntimePort;
  readonly source: Blob;
  readonly assetId: DocumentAssetId;
  readonly beforeDocument: ImageDocument;
  readonly beforeEditorAdjustments: BasicAdjustments;
  readonly beforeDocumentAdjustments: BasicAdjustments;
  readonly nextEditorAdjustments: BasicAdjustments;
  readonly targetLayerId: LayerId | null;
  readonly history: {
    readonly type: string;
    readonly label: string;
  };
  originIsCurrent(): boolean;
  documentIsActive(documentId: ImageDocument['id']): boolean;
  applyProjection(projection: AdjustmentProjection): void;
  pushHistoryEntry(entry: EditorHistoryEntry): void;
}

/**
 * Atomically publishes a LUT runtime, document metadata and adjustment state.
 * The document transaction retains ownership across the asynchronous GPU upload;
 * a failed upload or publication rolls every owned surface back together.
 */
export const commitColorLookupAssetTransaction = async ({
  transaction,
  runtime,
  source,
  assetId,
  beforeDocument,
  beforeEditorAdjustments,
  beforeDocumentAdjustments,
  nextEditorAdjustments,
  targetLayerId,
  history,
  originIsCurrent,
  documentIsActive,
  applyProjection,
  pushHistoryEntry
}: ColorLookupAssetTransactionInput): Promise<AdjustmentProjection> => {
  const projection = projectAdjustmentSnapshot({
    snapshot: nextEditorAdjustments,
    targetLayerId,
    document: transaction.current,
    documentAdjustments: beforeDocumentAdjustments
  });
  if (!projection.document) {
    throw new Error('The selected layer cannot own this color lookup.');
  }
  const beforeProjection: AdjustmentProjection = {
    editorAdjustments: beforeEditorAdjustments,
    documentAdjustments: beforeDocumentAdjustments,
    document: beforeDocument,
    scope: projection.scope
  };
  if (projection.document !== transaction.current
    && !transaction.stage(() => projection.document!)) {
    throw new Error('The color lookup operation lost its document ownership.');
  }

  let runtimeLoaded = false;
  let canonicalPublicationStarted = false;
  try {
    const committed = await transaction.commitWithAsync(async (ownedBefore, ownedAfter) => {
      await runtime.loadColorLookupAsset(transaction.documentId, { lutId: assetId, source });
      runtimeLoaded = true;
      if (ownedBefore !== beforeDocument
        || ownedAfter !== projection.document
        || !originIsCurrent()) {
        throw new Error('The color lookup target changed before it could be committed.');
      }
      canonicalPublicationStarted = true;
      applyProjection(projection);
      pushHistoryEntry({
        type: history.type,
        label: history.label,
        documentMutation: true,
        resourceIds: [assetId],
        undo: () => applyProjection(beforeProjection),
        redo: () => applyProjection(projection)
      });
      return true;
    });
    if (!committed) {
      throw new Error('The color lookup operation could not acquire its document.');
    }
    return projection;
  } catch (error) {
    transaction.cancel();
    let rollbackError: unknown;
    if (canonicalPublicationStarted && documentIsActive(beforeDocument.id)) {
      try {
        applyProjection(beforeProjection);
      } catch (reason) {
        rollbackError = reason;
      }
    }
    if (runtimeLoaded) runtime.removeColorLookupAsset(transaction.documentId, assetId);
    if (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'The color lookup failed and its previous document state could not be restored.'
      );
    }
    throw error;
  }
};
