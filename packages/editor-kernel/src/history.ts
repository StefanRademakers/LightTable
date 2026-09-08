import type {
  DocumentRevision,
  DocumentSessionId,
  HistoryStateId,
  ResourceId,
  TransactionId,
} from './identities';

export interface HistoryEntry<Payload = unknown> {
  readonly transactionId: TransactionId;
  readonly documentSessionId: DocumentSessionId;
  readonly beforeRevision: DocumentRevision;
  readonly afterRevision: DocumentRevision;
  readonly label: string;
  readonly payload: Payload;
  readonly retainedResources: readonly ResourceId[];
}

export interface HistoryCommitResult {
  readonly stateId: HistoryStateId;
  readonly evictedResources: readonly ResourceId[];
}

export interface DocumentHistoryStore<Payload = unknown> {
  append(entry: HistoryEntry<Payload>): HistoryCommitResult;
  currentState(documentSessionId: DocumentSessionId): HistoryStateId;
}
