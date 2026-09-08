import type { DocumentSessionId, ResourceId, TransactionId } from './identities';

export type ResourceOwner =
  | { readonly kind: 'document'; readonly documentSessionId: DocumentSessionId }
  | { readonly kind: 'history'; readonly documentSessionId: DocumentSessionId }
  | { readonly kind: 'transaction'; readonly transactionId: TransactionId };

export interface ResourceDescriptor {
  readonly id: ResourceId;
  readonly owner: ResourceOwner;
  readonly byteSize: number;
  readonly revision: number;
}

export interface ResourceTransfer {
  readonly resourceId: ResourceId;
  readonly from: ResourceOwner;
  readonly to: ResourceOwner;
}

export interface ResourceRepository {
  describe(resourceId: ResourceId): ResourceDescriptor | undefined;
  transfer(transfer: ResourceTransfer): boolean;
  release(resourceId: ResourceId, owner: ResourceOwner): void;
}
