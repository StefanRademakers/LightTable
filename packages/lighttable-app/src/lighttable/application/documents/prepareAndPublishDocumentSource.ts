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

  // Pixel-difference diagnostics are useful import telemetry, not a
  // prerequisite for showing or editing the PSD. Run them only after the
  // canonical first frame has had a paint opportunity and never let a stale
  // generation publish late results into a newer document.
  if (prepared.loaded.psdImport) {
    const inventory = prepared.loaded.psdImport.inventory;
    void request.renderer.waitForPresentation().then(async () => {
      if (request.signal?.aborted || request.isCanceled?.()) return;
      try {
        const metrics = await request.renderer.measureReferenceDifference();
        if (request.signal?.aborted || request.isCanceled?.()) return;
        const publish = () => {
          publication.publishPsdDifference(metrics);
          publication.publishStatus(
            `PSD reconstruction loaded · ${inventory.layers} layers · `
            + `${metrics.differingPixelPercentage.toFixed(2)}% differs`
          );
        };
        if (publication.commitPublication) publication.commitPublication(publish);
        else publish();
      } catch (error) {
        if (request.signal?.aborted || request.isCanceled?.()) return;
        publication.reportDifferenceFailure(error);
      }
    }).catch((error) => {
      if (request.signal?.aborted || request.isCanceled?.()) return;
      publication.reportDifferenceFailure(error);
    });
  }
  return true;
};
