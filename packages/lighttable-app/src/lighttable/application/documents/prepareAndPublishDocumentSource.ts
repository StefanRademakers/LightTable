import {
  prepareDocumentSource,
  type PrepareDocumentSourceRequest
} from './prepareDocumentSource';
import {
  publishPreparedDocument,
  type PreparedDocumentPublicationPorts
} from './publishPreparedDocument';

export interface PrepareAndPublishDocumentSourceRequest
  extends PrepareDocumentSourceRequest {
  readonly sourceIdentity: string;
  readonly publication: PreparedDocumentPublicationPorts;
}

/**
 * Completes import and hydration before publishing one atomic runtime snapshot.
 *
 * The final cancellation check prevents a superseded tab generation from
 * replacing the canonical document owned by a newer open request.
 */
export const prepareAndPublishDocumentSource = async ({
  sourceIdentity,
  publication,
  ...request
}: PrepareAndPublishDocumentSourceRequest): Promise<boolean> => {
  const prepared = await prepareDocumentSource(request);
  const canceled = request.isCanceled?.() ?? false;
  if (!prepared || canceled || request.signal?.aborted) return false;

  publishPreparedDocument(prepared, {
    name: request.name,
    identity: sourceIdentity
  }, publication);
  request.startupTimeline?.mark('document-publish');
  return true;
};
