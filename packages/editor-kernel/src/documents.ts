import type { DocumentAddress, DocumentRevision, DocumentSessionId } from './identities';

export interface CanonicalDocumentSnapshot<State = unknown> {
  readonly address: DocumentAddress;
  readonly state: State;
}

export interface PreparedDocumentChange<Patch = unknown> {
  readonly sessionId: DocumentSessionId;
  readonly expectedRevision: DocumentRevision;
  readonly patch: Patch;
}

export type DocumentCommitResult<State = unknown> =
  | { readonly ok: true; readonly snapshot: CanonicalDocumentSnapshot<State> }
  | { readonly ok: false; readonly reason: 'closed' | 'conflict' | 'invalid' };

export interface CanonicalDocumentStore<State = unknown, Patch = unknown> {
  read(address: DocumentAddress): CanonicalDocumentSnapshot<State> | undefined;
  commit(change: PreparedDocumentChange<Patch>): Promise<DocumentCommitResult<State>>;
}
