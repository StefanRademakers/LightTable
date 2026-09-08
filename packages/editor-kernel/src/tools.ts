import type { DocumentAddress, TransactionId, TransactionRevision } from './identities';

export interface ToolSessionStart<Baseline = unknown, Options = unknown> {
  readonly transactionId: TransactionId;
  readonly document: DocumentAddress;
  readonly baseline: Baseline;
  readonly options: Options;
}

export interface ToolPreview<Preview = unknown> {
  readonly transactionId: TransactionId;
  readonly revision: TransactionRevision;
  readonly value: Preview;
}

export type ToolSessionTerminal<Commit = unknown> =
  | { readonly kind: 'commit'; readonly transactionId: TransactionId; readonly value: Commit }
  | { readonly kind: 'cancel'; readonly transactionId: TransactionId; readonly reason: string };
