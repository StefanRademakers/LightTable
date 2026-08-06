import type {
  LightTableSaveDurability,
  LightTableSaveRequest,
  LightTableSaveResult
} from '../../../platform/LightTableHost';

export type DocumentSaveTransactionPhase =
  | 'preparing'
  | 'prepared'
  | 'writing'
  | 'committed'
  | 'canceled'
  | 'failed';

export interface DocumentSaveTransactionSnapshot {
  readonly id: string;
  readonly revision: number;
  readonly phase: DocumentSaveTransactionPhase;
  readonly failurePhase: string | null;
  readonly message: string | null;
}

export interface ExecuteDocumentSaveTransactionOptions<TPrepared> {
  readonly id: string;
  readonly documentId: string;
  readonly revision: number;
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly prepare: () => Promise<TPrepared>;
  readonly buildRequest: (prepared: TPrepared) => LightTableSaveRequest;
  readonly write: (request: LightTableSaveRequest) => Promise<LightTableSaveResult>;
  readonly commit: () => void;
  readonly publish?: (snapshot: DocumentSaveTransactionSnapshot) => void;
}

export interface DocumentSaveTransactionOutcome {
  readonly status: 'committed' | 'canceled' | 'failed';
  readonly revision: number;
  /** A committed pinned revision stays dirty when newer edits exist. */
  readonly markedClean: boolean;
  readonly durability?: LightTableSaveDurability;
  readonly phase?: string;
  readonly message?: string;
}

const abortError = () => new DOMException('The save was canceled.', 'AbortError');

/**
 * Runs one revision-pinned save without allowing a late result to clean newer
 * edits. Serialization is canceled before host I/O when the source revision is
 * already stale; once host I/O commits, the artifact remains a valid snapshot
 * but only the exact pinned revision may become clean.
 */
export const executeDocumentSaveTransaction = async <TPrepared>({
  id,
  documentId,
  revision,
  signal,
  isCurrent,
  prepare,
  buildRequest,
  write,
  commit,
  publish = () => undefined
}: ExecuteDocumentSaveTransactionOptions<TPrepared>): Promise<DocumentSaveTransactionOutcome> => {
  const emit = (
    phase: DocumentSaveTransactionPhase,
    failurePhase: string | null = null,
    message: string | null = null
  ) => publish({ id, revision, phase, failurePhase, message });
  const throwIfCanceled = () => {
    if (signal.aborted) throw abortError();
  };

  try {
    emit('preparing');
    throwIfCanceled();
    const prepared = await prepare();
    throwIfCanceled();
    if (!isCurrent()) {
      emit('canceled', null, 'The document changed while the save was being prepared.');
      return { status: 'canceled', revision, markedClean: false };
    }
    emit('prepared');
    emit('writing');
    const result = await write({
      ...buildRequest(prepared),
      transaction: { id, documentId, revision }
    });

    if (result.status === 'canceled') {
      emit('canceled');
      return { status: 'canceled', revision, markedClean: false };
    }
    if (result.status === 'failed') {
      emit('failed', result.phase, result.message);
      return {
        status: 'failed',
        revision,
        markedClean: false,
        phase: result.phase,
        message: result.message
      };
    }

    const markedClean = !signal.aborted && isCurrent();
    if (markedClean) commit();
    emit('committed', null, markedClean
      ? null
      : 'Saved the pinned revision; newer edits remain unsaved.');
    return {
      status: 'committed',
      revision,
      markedClean,
      durability: result.durability
    };
  } catch (reason) {
    if (signal.aborted || (reason instanceof DOMException && reason.name === 'AbortError')) {
      emit('canceled');
      return { status: 'canceled', revision, markedClean: false };
    }
    const message = reason instanceof Error ? reason.message : String(reason);
    emit('failed', 'prepare', message);
    return {
      status: 'failed',
      revision,
      markedClean: false,
      phase: 'prepare',
      message
    };
  }
};
