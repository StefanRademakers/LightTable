type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type DocumentSessionId = Brand<string, 'DocumentSessionId'>;
export type DocumentRevision = Brand<number, 'DocumentRevision'>;
export type HistoryStateId = Brand<string, 'HistoryStateId'>;
export type LayerId = Brand<string, 'LayerId'>;
export type ResourceId = Brand<string, 'ResourceId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
export type TransactionRevision = Brand<number, 'TransactionRevision'>;

export interface DocumentAddress {
  readonly sessionId: DocumentSessionId;
  readonly revision: DocumentRevision;
}
