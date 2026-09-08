import type { DocumentAddress, LayerId, ResourceId, TransactionRevision } from './identities';

export type DirtyDomain =
  | 'composite'
  | 'document-geometry'
  | 'layer-content'
  | 'layer-structure'
  | 'overlay'
  | 'processing';

export interface RenderInvalidation {
  readonly domains: ReadonlySet<DirtyDomain>;
  readonly layerIds?: readonly LayerId[];
}

export interface RenderProjectionRequest<Payload = unknown> {
  readonly address: DocumentAddress;
  readonly transactionRevision?: TransactionRevision;
  readonly invalidation: RenderInvalidation;
  readonly payload: Payload;
  readonly resourceIds: readonly ResourceId[];
}

export interface RenderProjectionPort<Payload = unknown> {
  project(request: RenderProjectionRequest<Payload>): void;
  clearTransaction(transactionRevision: TransactionRevision): void;
}
